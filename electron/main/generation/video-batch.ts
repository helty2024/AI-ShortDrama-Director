import { configurationHash } from './execution-binding.js'
import type { VideoApiPreviewInput } from '../../../src/shared/video-api.js'
import { videoProductionEvidence } from './video-production-gate.js'
import { createHash } from 'node:crypto'
import { DomainError, metadata } from '../database.js'
import { batchSchema, type BatchGenerationGroup } from '../../../src/shared/video.js'
import type { NativeVideoBatch, VideoBatchItem, VideoTimelineClip } from '../../../src/shared/video-batch.js'
import type { Shot } from '../../../src/shared/domain.js'
import type { VideoApiGenerationService } from './video-api-service.js'
import { exportVideoSequence, validateTimeline } from '../video/sequence-export.js'

const fail = (message: string): never => { throw new DomainError('CONFLICT', message) }
export class VideoBatchService {
  private busy = false
  private readonly database
  readonly video: VideoApiGenerationService
  constructor(video: VideoApiGenerationService) {
    this.video = video
    this.database = video.visual.repo.database
    // Restart never starts another paid call. Known remote jobs can only be queried.
    for (const project of this.database.list()) for (const batch of this.list(project.id)) {
      const native = batch.nativeVideo!
      let changed = false
      if (native.state === 'active') { native.state = 'paused'; changed = true }
      for (const item of native.items) if (item.status === 'dispatching' && !item.taskId) {
        item.status = 'failed'; item.error = '本地准备中断，未自动重发；可人工创建返工批次'
        changed = true
      }
      if (changed) this.save(batch)
    }
  }
  list(projectId: string): BatchGenerationGroup[] {
    this.database.get(projectId)
    return this.database.connection.prepare('SELECT data FROM production_batches WHERE project_id=? ORDER BY rowid DESC')
      .all(projectId).map(row => batchSchema.parse(JSON.parse(String(row.data)))).filter(batch => batch.nativeVideo).map(batch => {
        if (batch.projectId !== projectId || batch.kind !== 'video' || batch.nativeVideo!.items.some(i => i.input.projectId !== projectId)) fail('批次项目范围不一致')
        return batch
      })
  }
  get(projectId: string, id: string) {
    return this.list(projectId).find(batch => batch.id === id) ?? fail('视频批次不存在')
  }
  private save(batch: BatchGenerationGroup) {
    batch.updatedAt = new Date().toISOString()
    const native = batch.nativeVideo!
    native.revision++
    batch.status = native.state === 'active' ? 'active' : 'paused'
    batch.entries = native.items.map(item => ({ shotId: item.shotId, taskId: item.taskId, error: item.error }))
    const parsed = batchSchema.parse(batch)
    this.database.connection.prepare('UPDATE production_batches SET data=? WHERE project_id=? AND id=?')
      .run(JSON.stringify(parsed), batch.projectId, batch.id)
    return parsed
  }
  private shot(projectId: string, id: string): Shot {
    const entity = this.video.generation.entity(projectId, id)
    if (entity.kind !== 'shot' || !entity.plan) return fail('批量生产只接受已有正式分镜')
    return entity
  }
  async prepare(projectId: string, ids: string[], referenceVersionId: string | null = null, purpose: 'narrative-production' | 'technical-test' = 'narrative-production') {
    if (new Set(ids).size !== ids.length) fail('选择了重复镜头')
    const entities = this.database.workspace(projectId).entities
    const shots = ids.map(id => this.shot(projectId, id)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    if (new Set(shots.map(s => s.sceneId)).size !== 1 || new Set(shots.map(s => s.plan!.shotNumber)).size !== shots.length)
      fail('请选择同一场次、镜号不重复的正式分镜')
    const reference = referenceVersionId ? this.video.visual.version(projectId, referenceVersionId) : null
    if (reference && (reference.status !== 'approved' || !reference.mimeType.startsWith('image/'))) fail('只能复用人工批准的图片版本')
    const requirements: Omit<VideoApiPreviewInput, 'toolId' | 'fps' | 'resolution'>[] = shots.map(shot => {
      const linked = entities.filter(e => [shot.sceneId, shot.locationId, ...shot.characterIds, ...shot.propIds].includes(e.id))
      const frameId = shot.approvedKeyframeVersionId
      if (reference && !shot.characterIds.some(id => { const c = entities.find(e => e.id === id); return c?.kind === 'character' && c.visualReferences.some(r => r.primary && r.assetId === reference.assetId) })) fail('所选参考未作为本镜头角色主参考采用；人物图不能冒充分镜首帧')
      if (frameId && this.video.visual.version(projectId, frameId).status !== 'approved') fail('所选首帧尚未审核')
      const aspectRatio = this.database.get(projectId).aspectRatio
      const prompt = [
        `连续叙事视频，单一镜头，镜号 ${shot.plan!.shotNumber}。`,
        `动作：${shot.direction.action || shot.plan!.action}。景别/构图：${shot.plan!.framing}。运镜：${shot.direction.cameraMovement || shot.plan!.cameraMovement}。`,
        `表演：${shot.direction.performance}。连续性：${shot.direction.continuityNotes || shot.plan!.continuityNotes}。`,
        shot.videoPrompt,
        ...linked.map(e => JSON.stringify({ kind: e.kind, name: e.name, description: e.description, ...('bible' in e ? { bible: e.bible } : {}), ...('appearance' in e ? { appearance: e.appearance } : {}) })),
        `遵守上述正式人物、场景、道具设定；项目风格：${this.database.get(projectId).style}。空镜不出现人物。不添加未经剧本确认的人物、台词、字幕、水印或奇幻元素，不推断道具未说明的状态。`,
      ].filter(Boolean).join('\n')
      return { purpose, projectId, targetId: shot.id, mode: frameId ? 'image-to-video' : 'text-to-video', prompt,
        durationSeconds: shot.durationSeconds, aspectRatio, seed: null,
        firstFrameAssetVersionId: frameId ?? null, lastFrameAssetVersionId: null, allowAssetUpload: true, localOnly: false }
    })
    // Read-only adapter validation and Broker selection. No generate/submit calls.
    const plan = await this.video.planBatch(requirements)
    const items: VideoBatchItem[] = shots.map((shot, index) => {
      const input = plan.inputs[index]
      const linked = entities.filter(e => [shot.sceneId, shot.locationId, ...shot.characterIds, ...shot.propIds].includes(e.id))
      return { shotId: shot.id, shotNumber: shot.plan!.shotNumber, name: shot.name, input,
        sourceRevisions: Object.fromEntries([shot, ...linked].map(e => [e.id, e.revision])),
        productionEvidenceDigest: videoProductionEvidence(this.video.visual, input).digest,
        // points is a legacy storage name for budget units, not a price formula.
        // Unknown quotes stay explicit null; no actual fee is inferred here.
        estimatedReservationMicro: plan.quotes[index].amountMicro,
        points: (plan.quotes[index].amountMicro ?? 0) / 1e6,
        ceilingMicro: 0, status: 'queued', taskId: null, recordId: null, error: null }
    })
    const native: NativeVideoBatch = { revision: 1, executionAllowed: true, state: 'awaiting-budget', toolId: plan.toolId, model: plan.model,
      configurationIdentity: configurationHash(plan.configuration), executionConfiguration: plan.configuration,
      concurrency: plan.policy.maxConcurrent, budgetCurrency: plan.policy.budgetCurrency, quoteKnown: plan.quotes.every(q => q.amountMicro !== null),
      quoteBasis: [...new Set(plan.quotes.map(q => q.basis))].join('; ').slice(0, 500),
      maxCalls: items.length, maxPoints: 0, maxCostMicro: null, allowUnknownCost: false, authorizedAt: null, expiresAt: null, items, exportVersionIds: [] }
    const now = new Date().toISOString()
    const batch = batchSchema.parse({ id: metadata().id, createdAt: now, updatedAt: now, projectId, name: `${purpose === 'technical-test' ? '独立技术测试' : '叙事生产'} · ${shots.length} 镜头`, kind: 'video', status: 'paused', entries: [], nativeVideo: native })
    this.database.connection.prepare('INSERT INTO production_batches(id,project_id,data) VALUES (?,?,?)').run(batch.id, projectId, JSON.stringify(batch))
    return batch
  }
  authorize(projectId: string, id: string, revision: number, maxPoints: number, maxCostMicro: number | null) {
    return this.database.transaction(() => {
      const batch = this.get(projectId, id), native = batch.nativeVideo!
      if (!native.executionAllowed || native.state !== 'awaiting-budget' || native.revision !== revision) fail('批次已更新、已授权或为备份历史，禁止重复授权')
      const total = native.items.reduce((sum, item) => sum + (item.estimatedReservationMicro ?? 0), 0) / 1e6
      if (!Number.isFinite(maxPoints) || !Number.isSafeInteger(Math.round(maxPoints * 1e6)) || maxPoints <= 0 || maxPoints < total) fail('整批预算不足或无效')
      if (maxCostMicro !== null && (!Number.isSafeInteger(maxCostMicro) || maxCostMicro <= 0)) fail('人民币记账预留无效')
      this.assertConfiguration(native)
      for (const other of this.list(projectId)) if (other.id !== id && other.nativeVideo!.authorizedAt &&
        other.nativeVideo!.items.some(item => ['queued', 'dispatching', 'running', 'unknown'].includes(item.status) && native.items.some(next => next.shotId === item.shotId)))
        fail('镜头已在另一未完成批次中，禁止重复排队')
      for (const item of native.items) this.assertSources(projectId, item)
      const totalMicro = Math.round(maxPoints * 1e6)
      const unknownCount = native.items.filter(i => i.estimatedReservationMicro == null).length
      const remaining = totalMicro - native.items.reduce((sum, i) => sum + (i.estimatedReservationMicro ?? 0), 0)
      let unknownIndex = 0
      native.items.forEach(item => { item.ceilingMicro = item.estimatedReservationMicro ??
        (Math.floor(remaining / unknownCount) + (unknownIndex++ < remaining % unknownCount ? 1 : 0)) })
      if (native.items.some(i => i.ceilingMicro <= 0) || native.items.reduce((sum, i) => sum + i.ceilingMicro, 0) > totalMicro) fail('单镜头费用上限无效或超出整批预算')
      native.maxPoints = maxPoints; native.maxCostMicro = maxCostMicro; native.allowUnknownCost = true
      native.authorizedAt = new Date().toISOString(); native.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); native.state = 'active'
      native.scopeFingerprint = this.scopeFingerprint(native)
      return this.save(batch)
    })
  }
  private scopeFingerprint(native: NativeVideoBatch) {
    return configurationHash({ toolId: native.toolId, model: native.model,
      configurationIdentity: native.configurationIdentity, configuration: native.executionConfiguration,
      concurrency: native.concurrency, currency: native.budgetCurrency, maxPoints: native.maxPoints, maxCostMicro: native.maxCostMicro,
      maxCalls: native.maxCalls, allowUnknownCost: native.allowUnknownCost, authorizedAt: native.authorizedAt, expiresAt: native.expiresAt,
      items: native.items.map(i => ({ shotId: i.shotId, input: i.input, revisions: i.sourceRevisions, evidence: i.productionEvidenceDigest, quote: i.estimatedReservationMicro, ceiling: i.ceilingMicro })) })
  }
  private assertConfiguration(native: NativeVideoBatch) {
    if (!native.executionConfiguration || configurationHash(native.executionConfiguration) !== native.configurationIdentity ||
      native.executionConfiguration.descriptor.id !== native.toolId || native.executionConfiguration.profile.modelId !== native.model ||
      this.video.configurationIdentity(native.toolId) !== native.configurationIdentity) fail('原执行配置不可用或已变化；请重新准备批次，旧授权不能迁移')
    if (native.authorizedAt && native.scopeFingerprint !== this.scopeFingerprint(native)) fail('批次参数与原费用授权不一致')
  }
  private assertSources(projectId: string, item: VideoBatchItem) {
    const evidence = videoProductionEvidence(this.video.visual, item.input)
    if ((item.input.purpose === 'narrative-production' || item.productionEvidenceDigest) && item.productionEvidenceDigest !== evidence.digest)
      fail('角色或关键帧批准版本已改变，请重新准备和授权批次')
    for (const [id, revision] of Object.entries(item.sourceRevisions)) if (this.video.generation.entity(projectId, id).revision !== revision) fail('正式实体已修订，请重新准备本镜头，原授权不适用于新内容')
    const frame = item.input.firstFrameAssetVersionId
    if (frame && this.video.visual.version(projectId, frame).status !== 'approved') fail('参考素材审核状态已变化')
  }
  pause(projectId: string, id: string) {
    const batch = this.get(projectId, id)
    if (batch.nativeVideo!.state === 'active') { batch.nativeVideo!.state = 'paused'; this.save(batch) }
    return batch
  }
  resume(projectId: string, id: string) {
    const batch = this.get(projectId, id), native = batch.nativeVideo!
    if (!native.executionAllowed || !native.authorizedAt || !native.expiresAt || native.expiresAt <= new Date().toISOString()) fail('授权不存在、已过期或为备份历史')
    if (native.items.some(item => item.status === 'unknown')) fail('提交状态未知，请先核实原任务，禁止自动补发')
    this.assertConfiguration(native)
    if (native.state === 'paused') { native.state = 'active'; this.save(batch) }
    return batch
  }
  rework(projectId: string, id: string, shotId: string) {
    const item = this.get(projectId, id).nativeVideo!.items.find(i => i.shotId === shotId)
    if (!item || !['failed', 'succeeded'].includes(item.status)) return fail('运行中或未知任务不能返工补发')
    return this.prepare(projectId, [shotId], null, item.input.purpose)
  }
  private claim(projectId: string, id: string, shotId: string, revision: number) {
    return this.database.transaction(() => {
      const fresh = this.get(projectId, id)
      if (fresh.nativeVideo!.state !== 'active' || fresh.nativeVideo!.revision !== revision) return false
      // A persisted slot is shared by service identity across projects and
      // configuration revisions; unknown submissions continue to occupy it.
      const native = fresh.nativeVideo!
      const sameService = (b: NativeVideoBatch) => native.executionConfiguration?.serviceId
        ? b.executionConfiguration?.serviceId === native.executionConfiguration.serviceId
        : b.toolId === native.toolId
      const occupied = this.database.list().flatMap(p => this.list(p.id)).filter(b => b.nativeVideo!.executionAllowed && sameService(b.nativeVideo!))
        .flatMap(b => b.nativeVideo!.items).filter(i => ['dispatching', 'running', 'unknown'].includes(i.status))
      const attached = new Set(occupied.map(i => i.recordId).filter(Boolean))
      const external = this.database.list().flatMap(p => this.video.generation.list('generation_records', p.id))
        .filter(r => r.toolId === native.toolId && r.approvalId && !attached.has(r.id) && ['pending', 'unknown', 'unknown-submission'].includes(r.outcome))
      if (occupied.length + external.length >= native.concurrency) return false
      const row = fresh.nativeVideo!.items.find(i => i.shotId === shotId)
      if (!row || row.status !== 'queued') return false
      row.status = 'dispatching'; this.save(fresh)
      return true
    })
  }
  /** Capability-limited service slots. Polling a known task is never a second submit. */
  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      for (const project of this.database.list()) for (const batch of this.list(project.id)) {
        if (!batch.nativeVideo!.executionAllowed) continue
        for (const item of batch.nativeVideo!.items.filter(i => i.status === 'running' && i.taskId)) {
          try {
            const result = await this.video.query(project.id, item.taskId!)
            const fresh = this.get(project.id, batch.id), current = fresh.nativeVideo!.items.find(i => i.shotId === item.shotId)!
            if (result.record.outcome === 'succeeded') current.status = 'succeeded'
            else if (['unknown', 'unknown-submission'].includes(result.record.outcome)) { current.status = 'unknown'; current.error = '提交结果未知，保留预算；禁止自动补发'; fresh.nativeVideo!.state = 'paused' }
            else if (result.record.outcome !== 'pending') { current.status = 'failed'; current.error = result.task.error?.message ?? `任务结束：${result.record.outcome}` }
            this.save(fresh)
          } catch { /* Original task stays running; query/recovery failure never resubmits. */ }
        }
      }
      for (const project of this.database.list()) for (const batch of this.list(project.id).reverse()) {
        const native = batch.nativeVideo!
        if (native.state !== 'active' || !native.executionAllowed) continue
        if (native.expiresAt! <= new Date().toISOString()) { native.state = 'paused'; this.save(batch); continue }
        const item = native.items.find(i => i.status === 'queued')
        if (!item) { if (!native.items.some(i => ['running', 'dispatching', 'unknown'].includes(i.status))) { native.state = 'completed'; this.save(batch) }; continue }
        if (native.items.filter(i => i.taskId).length >= native.maxCalls || native.items.reduce((sum, i) => sum + i.ceilingMicro, 0) > Math.round(native.maxPoints * 1e6)) fail('批次调用或积分上限不足')
        if (!this.claim(project.id, batch.id, item.shotId, native.revision)) continue
        try {
          this.assertConfiguration(native)
          this.assertSources(project.id, item)
          const preview = await this.video.preview(item.input)
          if (preview.currency !== native.budgetCurrency || preview.model !== native.model) fail('模型或费用单位与冻结授权不一致，禁止提交')
          const fresh = this.get(project.id, batch.id)
          if (fresh.nativeVideo!.state !== 'active') {
            fresh.nativeVideo!.items.find(i => i.shotId === item.shotId)!.status = 'queued'; this.save(fresh); return
          }
          this.assertSources(project.id, item)
          this.assertConfiguration(fresh.nativeVideo!)
          this.video.confirm(project.id, preview.id, item.ceilingMicro, true, (task, record) => {
            const current = this.get(project.id, batch.id), row = current.nativeVideo!.items.find(i => i.shotId === item.shotId)!
            row.taskId = task.id; row.recordId = record.id; row.status = 'running'; this.save(current)
          })
        } catch {
          const fresh = this.get(project.id, batch.id), row = fresh.nativeVideo!.items.find(i => i.shotId === item.shotId)!
          if (!row.taskId) { row.status = 'failed'; row.error = '本地校验或服务预检失败，未提交；请检查服务、余额及实体版本' }
          this.save(fresh)
        }
        return
      }
    } finally { this.busy = false }
  }
  async export(projectId: string, id: string) {
    const batch = this.get(projectId, id)
    const result = await exportVideoSequence(this.video.visual, projectId, batch.nativeVideo!.items.map(i => i.shotId), batch.nativeVideo!.timeline)
    const fresh = this.get(projectId, id)
    fresh.nativeVideo!.exportVersionIds.push(result.id); this.save(fresh)
    return result
  }
  saveTimeline(projectId: string, id: string, expectedRevision: number, clips: VideoTimelineClip[]) {
    return this.database.transaction(() => {
      const batch = this.get(projectId, id)
      if (batch.nativeVideo!.revision !== expectedRevision) fail('批次已更新，请重新载入时间线')
      batch.nativeVideo!.timeline = validateTimeline(this.video.visual, projectId, batch.nativeVideo!.items.map(i => i.shotId), clips)
      return this.save(batch)
    })
  }
  async recoverOutput(projectId: string, id: string, shotId: string) {
    const batch = this.get(projectId, id), item = batch.nativeVideo!.items.find(i => i.shotId === shotId)
    if (!batch.nativeVideo!.executionAllowed || !item?.taskId || item.status !== 'failed') fail('该镜头不支持原结果回收')
    const result = await this.video.reconcileExistingOutput(projectId, item!.taskId!)
    const fresh = this.get(projectId, id), row = fresh.nativeVideo!.items.find(i => i.shotId === shotId)!
    row.status = result.record.outcome === 'succeeded' ? 'succeeded' : result.record.outcome === 'pending' ? 'running' : 'failed'
    row.error = '已查询原远端任务；原本地输出校验失败记录保留，未重新生成'
    return this.save(fresh)
  }
  diagnostic(projectId: string, id: string) {
    const batch = this.get(projectId, id)
    return { batchId: batch.id, scopeHash: createHash('sha256').update(JSON.stringify(batch.nativeVideo!.items.map(i => ({ shotId: i.shotId, sourceRevisions: i.sourceRevisions, input: i.input })))).digest('hex') }
  }
}
