import { checkApprovalBinding } from './approval-binding.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DomainError, type ProjectDatabase } from '../database.js'
import { entitySchema } from '../../../src/shared/domain.js'
import { aiTaskSchema } from '../../../src/shared/intelligence.js'
import { assetVersionSchema } from '../../../src/shared/visual.js'
import { provenanceTables, persistedRecordSchema, generationOutputSchema, type ProvenanceTable, type ProvenanceRecord, type GenerationOutput } from '../../../src/shared/provenance.js'
import { immutable } from '../tools/registry.js'
import { requestFingerprint } from '../tools/fingerprint.js'

type Item<T extends ProvenanceTable> = z.infer<(typeof provenanceTables)[T]>
export class GenerationRepository {
  readonly database: ProjectDatabase
  constructor(database: ProjectDatabase) { this.database = database }
  atomic<T>(action: () => T): T {
    try { return this.database.transaction(action) }
    catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('CONFLICT', '来源记录冲突或引用不完整') }
  }
  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw)
    if (!result.success) throw new DomainError('INVALID_INPUT', '来源快照格式无效')
    return result.data
  }
  private decode<T>(schema: z.ZodType<T>, data: unknown): T {
    try { return this.parse(schema, JSON.parse(String(data))) }
    catch { throw new DomainError('INVALID_INPUT', '持久化快照损坏') }
  }
  private scope<T extends { id: string; projectId: string }>(table: 'entities' | 'asset_versions' | 'ai_tasks', projectId: string, id: string, schema: z.ZodType<T>): T {
    const row = this.database.connection.prepare(`SELECT data FROM ${table} WHERE project_id=? AND id=?`).get(projectId, id)
    if (!row) throw new DomainError('NOT_FOUND', '来源引用不存在或不属于当前项目')
    const value = this.decode(schema, row.data)
    if (value.id !== id || value.projectId !== projectId) throw new DomainError('INVALID_INPUT', '来源引用的持久化身份不一致')
    return value
  }
  entity(projectId: string, id: string) { return this.scope('entities', projectId, id, entitySchema) }
  version(projectId: string, id: string) { return this.scope('asset_versions', projectId, id, assetVersionSchema) }
  task(projectId: string, id: string) { return this.scope('ai_tasks', projectId, id, aiTaskSchema) }
  get<T extends ProvenanceTable>(table: T, projectId: string, id: string): Item<T> {
    const row = this.database.connection.prepare(`SELECT data FROM ${table} WHERE project_id=? AND id=?`).get(projectId, id)
    if (!row) throw new DomainError('NOT_FOUND', '来源记录不存在')
    const value = this.decode(provenanceTables[table] as unknown as z.ZodType<Item<T>>, row.data)
    if (value.id !== id || value.projectId !== projectId) throw new DomainError('INVALID_INPUT', '来源记录身份不一致')
    return immutable(value)
  }
  list<T extends ProvenanceTable>(table: T, projectId: string): Item<T>[] {
    this.database.get(projectId)
    return this.database.connection.prepare(`SELECT id FROM ${table} WHERE project_id=? ORDER BY rowid`).all(projectId).map(row => this.get(table, projectId, String(row.id)))
  }
  create<T extends ProvenanceTable>(table: T, raw: unknown): Item<T> {
    return this.atomic(() => {
      const item = this.parse(provenanceTables[table] as unknown as z.ZodType<Item<T>>, raw)
      this.database.get(item.projectId)
      this.check(table, item)
      if (table === 'generation_records') checkApprovalBinding(this.database, persistedRecordSchema.parse({ ...provenanceTables.generation_records.parse(item), outputAssetVersionIds: [] }), true)
      this.database.connection.prepare(`INSERT INTO ${table}(id,project_id,data) VALUES (?,?,?)`).run(item.id, item.projectId, JSON.stringify(item))
      return immutable(item)
    })
  }
  private check(table: ProvenanceTable, raw: unknown): void {
    if (table === 'generation_estimates') {
      const value = provenanceTables.generation_estimates.parse(raw)
      this.get('routing_decisions', value.projectId, value.routingDecisionId)
    }
    if (table === 'prompt_packages') {
      const value = provenanceTables.prompt_packages.parse(raw)
      const target = this.entity(value.projectId, value.targetObjectId)
      if (target.kind !== value.targetObjectType || value.semanticInputSnapshot.target.id !== target.id) throw new DomainError('CONFLICT', '提示词目标不一致')
      for (const entity of [value.semanticInputSnapshot.target, ...value.semanticInputSnapshot.context]) {
        if (entity.projectId !== value.projectId || this.entity(value.projectId, entity.id).kind !== entity.kind) throw new DomainError('FORBIDDEN', '提示词来源跨项目')
      }
      for (const id of ('referenceAssetIds' in value.compiledPrompt ? value.compiledPrompt.referenceAssetIds : [])) {
        if (this.entity(value.projectId, id).kind !== 'asset') throw new DomainError('CONFLICT', '提示词参考素材无效')
      }
    }
    if (table === 'generation_records') this.checkRecord(persistedRecordSchema.parse({ ...provenanceTables.generation_records.parse(raw), outputAssetVersionIds: [] }))
    if (table === 'task_generation_links') {
      const value = provenanceTables.task_generation_links.parse(raw)
      const record = this.get('generation_records', value.projectId, value.generationRecordId)
      if (record.taskId !== value.taskId) throw new DomainError('CONFLICT', '任务与执行尝试不匹配')
      this.task(value.projectId, value.taskId)
    }
    if (table === 'generation_outputs') {
      const value = generationOutputSchema.parse(raw)
      const record = this.get('generation_records', value.projectId, value.generationRecordId)
      const version = this.version(value.projectId, value.assetVersionId)
      if (version.sourceType === 'imported' || (version.generationTaskId !== null && version.generationTaskId !== record.taskId)) throw new DomainError('CONFLICT', '素材不属于本次生成尝试')
      if (this.database.connection.prepare('SELECT id FROM import_provenance WHERE version_id=?').get(value.assetVersionId)) throw new DomainError('CONFLICT', '导入素材不能标记为生成输出')
    }
    if (table === 'import_provenance') {
      const value = provenanceTables.import_provenance.parse(raw)
      const version = this.version(value.projectId, value.outputAssetVersionIds[0])
      if (version.sourceType !== 'imported') throw new DomainError('CONFLICT', '只有导入版本可以登记导入来源')
      if (value.originalMime !== version.mimeType || (value.contentHash !== null && value.contentHash !== `sha256:${version.hash}`)) throw new DomainError('CONFLICT', '导入来源与素材不一致')
      if (this.database.connection.prepare('SELECT id FROM generation_outputs WHERE version_id=?').get(version.id)) throw new DomainError('CONFLICT', '生成输出不能标记为导入')
    }
  }
  checkRecord(record: ProvenanceRecord): void {
    checkApprovalBinding(this.database, record, false)
    const p = record.projectId
    const target = this.entity(p, record.targetObjectId), task = this.task(p, record.taskId)
    if (target.kind !== record.targetObjectType) throw new DomainError('CONFLICT', '生成目标类型不匹配')
    if ('targetId' in task.input && task.input.targetId !== target.id) throw new DomainError('CONFLICT', '任务目标不匹配')
    const decision = this.get('routing_decisions', p, record.routingDecisionId), estimate = this.get('generation_estimates', p, record.estimateId)
    if (decision.selectedToolId !== record.toolId || decision.selectedToolVersion !== record.toolVersion || decision.selectedModel !== record.modelId || decision.requestedCapability !== record.generationType || estimate.routingDecisionId !== decision.id || estimate.requestFingerprint !== record.requestFingerprint || JSON.stringify(estimate.cost) !== JSON.stringify(record.estimatedCost)) throw new DomainError('CONFLICT', '执行尝试与预检快照不一致')
    for (const id of record.inputAssetVersionIds) this.version(p, id)
    const input = record.parameters.input
    const refs = 'references' in input ? input.references.map(v => v.assetVersionId) : 'firstFrameAssetVersionId' in input ? [input.firstFrameAssetVersionId, ...(input.lastFrameAssetVersionId ? [input.lastFrameAssetVersionId] : [])] : []
    if (refs.some(id => !record.inputAssetVersionIds.includes(id))) throw new DomainError('CONFLICT', '输入版本快照不完整')
    for (const id of Object.keys(record.sourceRevisions)) this.entity(p, id)
    if (record.promptPackageId) {
      const prompt = this.get('prompt_packages', p, record.promptPackageId)
      if (prompt.targetObjectId !== target.id || prompt.targetCapability !== record.generationType || (prompt.targetToolId !== null && prompt.targetToolId !== record.toolId) || (prompt.targetModel !== null && prompt.targetModel !== record.modelId)) throw new DomainError('CONFLICT', '提示词快照与执行不匹配')
      if ('prompt' in input && 'positivePrompt' in prompt.compiledPrompt && input.prompt !== prompt.compiledPrompt.positivePrompt) throw new DomainError('CONFLICT', '编译提示词已改变')
    }
    if (record.parentGenerationRecordId) {
      const parent = this.get('generation_records', p, record.parentGenerationRecordId)
      if (parent.targetObjectId !== target.id) throw new DomainError('CONFLICT', '重试父记录目标不匹配')
    }
  }
  getRecord(projectId: string, id: string): ProvenanceRecord {
    const record = this.get('generation_records', projectId, id)
    return immutable(this.parse(persistedRecordSchema, { ...record, outputAssetVersionIds: this.outputs(projectId, id).map(v => v.assetVersionId) }))
  }
  outputs(projectId: string, id: string): GenerationOutput[] {
    return this.database.connection.prepare('SELECT id FROM generation_outputs WHERE project_id=? AND record_id=? ORDER BY output_index').all(projectId, id).map(row => this.get('generation_outputs', projectId, String(row.id)))
  }
  findByTask(projectId: string, taskId: string): ProvenanceRecord | null {
    const row = this.database.connection.prepare('SELECT record_id FROM task_generation_links WHERE project_id=? AND task_id=?').get(projectId, taskId)
    return row ? this.getRecord(projectId, String(row.record_id)) : null
  }
  history(projectId: string, targetId: string): ProvenanceRecord[] {
    return this.database.connection.prepare('SELECT id FROM generation_records WHERE project_id=? AND target_id=? ORDER BY rowid').all(projectId, targetId).map(row => this.getRecord(projectId, String(row.id)))
  }
  recordAttempt(raw: unknown): ProvenanceRecord {
    return this.atomic(() => {
      const value = this.parse(persistedRecordSchema, raw)
      if (value.outcome !== 'pending' || value.outputAssetVersionIds.length || value.completedAt !== null) throw new DomainError('CONFLICT', '新尝试必须尚未完成')
      const material = { fingerprintVersion: '1', snapshot: value.parameters, toolId: value.toolId, toolVersion: value.toolVersion, model: value.modelId, sourceRevisions: {}, routing: null }
      // Accept the 07-03 fingerprint convention and the source-aware convention.
      if (![requestFingerprint(material), requestFingerprint({ ...material, sourceRevisions: value.sourceRevisions })].includes(value.requestFingerprint)) throw new DomainError('CONFLICT', '输入与预检指纹不匹配')
      this.create('generation_records', value)
      this.create('task_generation_links', { id: randomUUID(), projectId: value.projectId, taskId: value.taskId, generationRecordId: value.id, createdAt: value.createdAt })
      return this.getRecord(value.projectId, value.id)
    })
  }
  attachOutputs(projectId: string, recordId: string, outputs: GenerationOutput[]): void {
    this.atomic(() => {
      const record = this.getRecord(projectId, recordId)
      if (record.outcome !== 'succeeded') throw new DomainError('CONFLICT', '只有成功尝试可以追加输出')
      for (const output of outputs) {
        if (output.projectId !== projectId || output.generationRecordId !== recordId) throw new DomainError('FORBIDDEN', '输出不属于当前尝试')
        this.create('generation_outputs', output)
      }
      const task = this.task(projectId, record.taskId)
      const next = aiTaskSchema.parse({ ...task, resultIds: this.outputs(projectId, recordId).map(output => output.assetVersionId) })
      this.database.connection.prepare('UPDATE ai_tasks SET data=? WHERE project_id=? AND id=?').run(JSON.stringify(next), projectId, task.id)
    })
  }
  finish(projectId: string, recordId: string, raw: unknown, outputs: GenerationOutput[] = []): ProvenanceRecord {
    return this.atomic(() => {
      const shape = persistedRecordSchema.shape
      const patch = this.parse(z.strictObject({ startedAt: shape.startedAt, completedAt: shape.completedAt, actualDuration: shape.actualDuration, actualCost: shape.actualCost, currency: shape.currency, costStatus: shape.costStatus, outcome: shape.outcome, updatedAt: shape.updatedAt }), raw)
      const before = this.getRecord(projectId, recordId)
      if (!['pending', 'unknown', 'unknown-submission'].includes(before.outcome) || patch.outcome === 'pending') throw new DomainError('CONFLICT', '尝试已经归档，重新生成必须建立新记录')
      if (patch.outcome !== 'succeeded' && outputs.length) throw new DomainError('CONFLICT', '失败尝试不能登记成功输出')
      const next = this.parse(persistedRecordSchema, { ...before, ...patch })
      if (!next.completedAt || (before.startedAt !== null && next.startedAt !== before.startedAt)) throw new DomainError('CONFLICT', '执行时间只能补齐，不能重写开始时间')
      checkApprovalBinding(this.database, next, false)
      const stored = provenanceTables.generation_records.parse(next)
      this.database.connection.prepare('UPDATE generation_records SET data=? WHERE project_id=? AND id=?').run(JSON.stringify(stored), projectId, recordId)
      if (outputs.length) this.attachOutputs(projectId, recordId, outputs)
      const task = this.task(projectId, before.taskId)
      const status = next.outcome === 'succeeded' ? 'succeeded' : next.outcome === 'cancelled' ? 'cancelled' : 'failed'
      const updated = aiTaskSchema.parse({ ...task, status, resultIds: this.outputs(projectId, recordId).map(v => v.assetVersionId), updatedAt: next.updatedAt, error: status === 'failed' ? { code: next.outcome, message: '生成尝试已归档；不会自动重新提交' } : null })
      this.database.connection.prepare('UPDATE ai_tasks SET data=? WHERE project_id=? AND id=?').run(JSON.stringify(updated), projectId, task.id)
      return this.getRecord(projectId, recordId)
    })
  }
  validateProject(projectId: string): void {
    for (const table of Object.keys(provenanceTables) as ProvenanceTable[]) for (const item of this.list(table, projectId)) this.check(table, item)
  }
  supplement(projectId: string, recordId: string, raw: unknown): ProvenanceRecord {
    return this.atomic(() => {
      const shape = persistedRecordSchema.shape
      const patch = this.parse(z.strictObject({ startedAt: shape.startedAt.optional(), actualCost: shape.actualCost.optional() }).refine(v => Object.keys(v).length > 0), raw)
      const before = this.getRecord(projectId, recordId)
      if (patch.startedAt !== undefined && (before.startedAt !== null || before.outcome !== 'pending')) throw new DomainError('CONFLICT', '开始时间已经确定')
      if (patch.actualCost !== undefined && (patch.actualCost === null || before.actualCost !== null)) throw new DomainError('CONFLICT', '实际费用只能首次补齐')
      const next = this.parse(persistedRecordSchema, { ...before, ...patch, updatedAt: new Date().toISOString(), ...(patch.actualCost ? { actualCost: patch.actualCost, currency: patch.actualCost.currency, costStatus: 'known' } : {}) })
      checkApprovalBinding(this.database, next, false)
      this.database.connection.prepare('UPDATE generation_records SET data=? WHERE project_id=? AND id=?').run(JSON.stringify(provenanceTables.generation_records.parse(next)), projectId, recordId)
      return this.getRecord(projectId, recordId)
    })
  }
}
