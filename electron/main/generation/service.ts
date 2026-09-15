import { randomUUID } from 'node:crypto'
import { GenerationRepository } from './repository.js'
import { DomainError } from '../database.js'
import { compileCharacterPrompt, compileLocationPrompt, compilePropPrompt, compileShotKeyframePrompt } from '../visual/prompt-compiler.js'
import type { ProvenanceRecord, ProvenancePrompt, GenerationOutput } from '../../../src/shared/provenance.js'
import type { Capability } from '../../../src/shared/capabilities/index.js'
import { aiTaskSchema, type AITask } from '../../../src/shared/intelligence.js'

export class GenerationService {
  readonly repository: GenerationRepository
  constructor(repository: GenerationRepository) { this.repository = repository }
  capturePrompt(projectId: string, targetId: string, capability: Capability = 'image.generate'): ProvenancePrompt {
    const target = this.repository.entity(projectId, targetId)
    const context = this.repository.database.workspace(projectId).entities
    const compiledPrompt = target.kind === 'character' ? compileCharacterPrompt(target) : target.kind === 'location' ? compileLocationPrompt(target) : target.kind === 'prop' ? compilePropPrompt(target) : target.kind === 'shot' ? compileShotKeyframePrompt(target, context) : null
    if (!compiledPrompt || !capability.startsWith('image.')) throw new DomainError('INVALID_INPUT', '此快照入口仅包装现有图像 Prompt Compiler')
    return this.repository.create('prompt_packages', { id: randomUUID(), projectId, targetObjectId: targetId, targetObjectType: target.kind, semanticInputSnapshot: { target, context }, compiledPrompt, compilerVersion: compiledPrompt.promptVersion, skillId: null, skillVersion: null, targetCapability: capability, targetToolId: null, targetModel: null, createdAt: new Date().toISOString() })
  }
  recordAttempt(record: ProvenanceRecord) {
    return this.repository.atomic(() => {
      for (const [id, revision] of Object.entries(record.sourceRevisions)) if (this.repository.entity(record.projectId, id).revision !== revision) throw new DomainError('CONFLICT', '来源版本已改变，请重新预检')
      return this.repository.recordAttempt(record)
    })
  }
  createAttempt(task: AITask, record: ProvenanceRecord) {
    return this.repository.atomic(() => {
      const parsed = aiTaskSchema.parse(task)
      if (parsed.id !== record.taskId || parsed.projectId !== record.projectId) throw new DomainError('FORBIDDEN', '任务身份与来源记录不一致')
      this.repository.database.connection.prepare('INSERT INTO ai_tasks(id,project_id,data) VALUES (?,?,?)').run(parsed.id, parsed.projectId, JSON.stringify(parsed))
      return this.recordAttempt(record)
    })
  }
  completeAttempt(projectId: string, id: string, outputs: GenerationOutput[], actualCost: ProvenanceRecord['actualCost'] = null) { return this.finish(projectId, id, 'succeeded', outputs, actualCost) }
  failAttempt(projectId: string, id: string, outcome: Exclude<ProvenanceRecord['outcome'], 'pending' | 'succeeded'>) { return this.finish(projectId, id, outcome, [], null) }
  private finish(projectId: string, id: string, outcome: ProvenanceRecord['outcome'], outputs: GenerationOutput[], actualCost: ProvenanceRecord['actualCost']) {
    const current = this.repository.getRecord(projectId, id), now = new Date().toISOString()
    actualCost ??= current.actualCost
    return this.repository.finish(projectId, id, { startedAt: current.startedAt, completedAt: now, updatedAt: now, actualDuration: current.startedAt ? Math.max(0, (Date.parse(now) - Date.parse(current.startedAt)) / 1000) : null, actualCost, costStatus: actualCost ? 'known' : 'unknown', currency: actualCost?.currency ?? current.currency, outcome }, outputs)
  }
  history(projectId: string, targetId: string) { return this.repository.history(projectId, targetId) }
}
