import { randomUUID } from 'node:crypto'
import { DomainError } from '../database.js'
import type { ImageGenerationService } from '../generation/image-service.js'
import type { VideoApiGenerationService } from '../generation/video-api-service.js'
import { workflowPreviewSchema, type WorkflowCommand } from '../../../src/shared/workflow.js'
import { WorkflowRepository, terminalWorkflow } from './repository.js'

type DecisionCommand = Extract<WorkflowCommand, { op: 'submitWorkflowUserDecision' }>
export class WorkflowRunner {
  readonly repository: WorkflowRepository
  readonly image: ImageGenerationService
  readonly video: VideoApiGenerationService
  private readonly pending = new Map<string, Promise<void>>()
  // A persisted preview is display-only after restart. Regeneration of a preview never submits.
  private readonly previews = new Map<string, string>()
  constructor(repository: WorkflowRepository, image: ImageGenerationService, video: VideoApiGenerationService) {
    this.repository = repository; this.image = image; this.video = video
  }
  resume(p: string, id: string) {
    const { run } = this.repository.get(p, id)
    if (!run.executionAllowed || terminalWorkflow(run.status) || this.pending.has(id)) return
    const work = this.advance(p, id).catch((error: unknown) => {
      try { this.fail(p, id, error instanceof DomainError ? error.code : 'step-failed', error instanceof DomainError ? error.message : '步骤执行失败；已有任务不会重新提交，请检查关联任务') }
      catch { /* Deleted project or malformed state: stop without creating execution. */ }
    }).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
  }
  async wait(id: string) { await this.pending.get(id) }
  private fail(p: string, id: string, code: string, message: string) {
    const { run, steps } = this.repository.get(p, id)
    if (terminalWorkflow(run.status)) return
    const step = steps.find((s) => s.stepKey === run.currentStepKey)!
    const error = { code, message, stepKey: step.stepKey }, now = new Date().toISOString()
    this.repository.database.transaction(() => {
      this.repository.saveStep({ ...step, status: 'failed', failedAt: now, errorSummary: error })
      this.repository.saveRun({ ...run, status: 'failed', failedAt: now, errorSummary: error })
    })
  }
  private async advance(p: string, id: string) {
    for (;;) {
      const { run, steps } = this.repository.get(p, id)
      if (!run.executionAllowed || terminalWorkflow(run.status)) return
      const step = steps.find((s) => s.status !== 'succeeded')
      if (!step) throw new DomainError('CONFLICT', '工作流缺少完成步骤')
      const now = new Date().toISOString()
      if (step.stepType === 'prepare') {
        this.repository.database.transaction(() => {
          this.repository.saveStep({ ...step, status: 'succeeded', startedAt: now, completedAt: now })
          this.repository.saveRun({ ...run, status: 'running', startedAt: run.startedAt ?? now, currentStepKey: steps[1].stepKey })
        })
        continue
      }
      if (step.stepType.startsWith('generate-')) {
        if (!step.relatedTaskId) {
          if (step.outputSnapshot.preview && this.previews.get(id) === step.outputSnapshot.preview.id && Date.parse(step.outputSnapshot.preview.expiresAt) > Date.now()) return
          const input = run.inputSnapshot
          const preview = input.workflowType === 'shot-keyframe'
            ? await this.image.preview(input.generation) : await this.video.preview(input.generation)
          const latest = this.repository.get(p, id)
          if (terminalWorkflow(latest.run.status)) return
          this.repository.database.transaction(() => {
            this.repository.saveStep({ ...latest.steps[step.sequence], status: 'waiting-user', startedAt: step.startedAt ?? now,
              outputSnapshot: { ...step.outputSnapshot, preview: workflowPreviewSchema.parse(preview) } })
            this.repository.saveRun({ ...latest.run, status: 'waiting-user', currentStepKey: step.stepKey })
          })
          this.previews.set(id, preview.id)
          return
        }
        if (run.workflowType === 'shot-keyframe') await this.image.recover(p, step.relatedTaskId)
        else await this.video.wait(step.relatedTaskId)
        const result = run.workflowType === 'shot-keyframe'
          ? this.image.query(p, step.relatedTaskId) : await this.video.query(p, step.relatedTaskId)
        const latest = this.repository.get(p, id)
        if (terminalWorkflow(latest.run.status)) return
        if (result.task.status !== 'succeeded') {
          if (['running', 'queued'].includes(result.task.status)) return
          this.fail(p, id, 'generation-failed', '生成未完成；请查看关联任务和费用状态，流程不会自动重提')
          return
        }
        if (result.versions.length !== 1) throw new DomainError('CONFLICT', '工作流要求一个候选版本')
        this.repository.database.transaction(() => {
          this.repository.saveStep({ ...latest.steps[step.sequence], status: 'succeeded', completedAt: new Date().toISOString(), relatedAssetVersionId: result.versions[0].id })
          this.repository.saveRun({ ...latest.run, status: 'running', currentStepKey: steps[step.sequence + 1].stepKey })
        })
        continue
      }
      if (step.stepType.startsWith('review-') || step.stepType.startsWith('adopt-')) {
        if (step.status === 'waiting-user') return
        const generated = steps[1]
        this.repository.database.transaction(() => {
          this.repository.saveStep({ ...step, status: 'waiting-user', startedAt: now,
            relatedTaskId: generated.relatedTaskId, relatedGenerationRecordId: generated.relatedGenerationRecordId,
            relatedAssetVersionId: generated.relatedAssetVersionId, relatedApprovalId: generated.relatedApprovalId })
          this.repository.saveRun({ ...run, status: 'waiting-user', currentStepKey: step.stepKey })
        })
        return
      }
      if (step.stepType === 'complete') {
        this.repository.database.transaction(() => {
          this.repository.saveStep({ ...step, status: 'succeeded', startedAt: now, completedAt: now })
          this.repository.saveRun({ ...run, status: 'succeeded', currentStepKey: 'complete', completedAt: now,
            resultSummary: { assetVersionId: steps[1].relatedAssetVersionId, adopted: true, reason: null } })
        })
        return
      }
    }
  }
  decision(command: DecisionCommand) {
    const { projectId: p, runId: id, decision } = command
    const { run, steps } = this.repository.get(p, id)
    if (!run.executionAllowed || run.status !== 'waiting-user' || run.revision !== command.expectedRevision || this.pending.has(id))
      throw new DomainError('CONFLICT', '流程状态已变化，请刷新后操作')
    const step = steps.find((s) => s.stepKey === run.currentStepKey)!
    const now = new Date().toISOString(), decisionId = randomUUID()
    if (decision.action === 'confirm-generation') {
      if (!step.stepType.startsWith('generate-') || step.relatedTaskId || this.previews.get(id) !== decision.previewId || step.outputSnapshot.preview?.id !== decision.previewId)
        throw new DomainError('CONFLICT', '生成预览已失效，请恢复流程重新预览确认')
      const service = run.workflowType === 'shot-keyframe' ? this.image : this.video
      // This callback executes inside the same transaction as approval/reservation/task/record.
      this.previews.delete(id)
      service.confirm(p, decision.previewId, decision.maxCostMicro, decision.allowUnknownCost, (task, record) => {
        this.repository.saveStep({ ...step, status: 'running', attemptCount: 1,
          relatedTaskId: task.id, relatedGenerationRecordId: record.id, relatedApprovalId: record.approvalId,
          outputSnapshot: { ...step.outputSnapshot, decisions: [{ id: decisionId, action: decision.action, at: now,
            versionId: null, maxCostMicro: decision.maxCostMicro, allowUnknownCost: decision.allowUnknownCost }] } })
        this.repository.saveRun({ ...run, status: 'running' })
      })
      this.previews.delete(id)
      this.resume(p, id)
      return
    }
    const review = step.stepType.startsWith('review-'), adopt = step.stepType.startsWith('adopt-')
    if (decision.versionId !== step.relatedAssetVersionId ||
      (decision.action === 'adopt-candidate' ? !adopt : !review))
      throw new DomainError('CONFLICT', '当前步骤不接受此候选或决定')
    this.repository.database.transaction(() => {
      const service = run.workflowType === 'shot-keyframe' ? this.image : this.video
      const target = service.generation.entity(p, run.targetObjectId)
      if (target.revision !== decision.targetRevision) throw new DomainError('CONFLICT', 'Shot 已更新，请刷新')
      if (decision.action === 'reject-candidate') service.visual.review(p, decision.versionId, decision.versionRevision, 'rejected', null, null)
      else service.review(p, decision.versionId, decision.versionRevision, adopt, decision.targetRevision)
      const rejected = decision.action === 'reject-candidate'
      const error = rejected ? { code: 'stopped-by-user', message: '用户拒绝候选', stepKey: step.stepKey } : null
      this.repository.saveStep({ ...step, status: rejected ? 'failed' : 'succeeded',
        completedAt: rejected ? null : now, failedAt: rejected ? now : null, errorSummary: error, relatedReviewId: decisionId,
        outputSnapshot: { ...step.outputSnapshot, decisions: [...step.outputSnapshot.decisions, {
          id: decisionId, action: decision.action, at: now, versionId: decision.versionId, maxCostMicro: null, allowUnknownCost: null,
        }] } })
      this.repository.saveRun({ ...run, status: rejected ? 'failed' : 'running', failedAt: rejected ? now : null,
        currentStepKey: rejected ? step.stepKey : steps[step.sequence + 1].stepKey, errorSummary: error })
    })
    this.resume(p, id)
  }
  cancel(p: string, id: string) {
    const { run, steps } = this.repository.get(p, id)
    if (terminalWorkflow(run.status)) return
    this.repository.database.transaction(() => {
      for (const step of steps) if (['pending', 'running', 'waiting-user'].includes(step.status)) this.repository.saveStep({ ...step, status: 'cancelled' })
      this.repository.saveRun({ ...run, status: 'cancelled', completedAt: new Date().toISOString(),
        resultSummary: { ...run.resultSummary, reason: '停止后续步骤；已提交的底层任务仍可完成并保留费用和输出记录' } })
    })
    this.previews.delete(id)
  }
  recoverUnfinished() {
    for (const project of this.repository.database.list())
      for (const row of this.repository.database.connection.prepare('SELECT id FROM workflow_runs WHERE project_id=?').all(project.id)) {
        try { this.resume(project.id, String(row.id)) }
        catch { /* Invalid stored state stays untouched and query reports the error. */ }
      }
  }
}
