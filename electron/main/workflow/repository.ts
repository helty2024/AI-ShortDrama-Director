import { z } from 'zod'
import { DomainError, metadata, type ProjectDatabase } from '../database.js'
import { workflowInputSchema, workflowRunSchema, stepRunSchema, type WorkflowInput, type WorkflowRun, type StepRun } from '../../../src/shared/workflow.js'
import { workflowDefinitions } from './workflow-definitions.js'
import { GenerationRepository } from '../generation/repository.js'

export const terminalWorkflow = (status: WorkflowRun['status']) => ['succeeded', 'failed', 'cancelled'].includes(status)
export class WorkflowRepository {
  readonly database: ProjectDatabase
  constructor(database: ProjectDatabase) { this.database = database }
  create(raw: WorkflowInput) {
    const input = workflowInputSchema.parse(raw), p = input.generation.projectId
    const target = new GenerationRepository(this.database).entity(p, input.generation.targetId)
    if (target.kind !== 'shot') throw new DomainError('INVALID_INPUT', '工作流目标必须是 Shot')
    const times = { startedAt: null, completedAt: null, failedAt: null }
    const run = workflowRunSchema.parse({ ...metadata(), ...times, projectId: p, workflowType: input.workflowType,
      targetObjectType: 'shot', targetObjectId: target.id, status: 'pending', currentStepKey: 'prepare',
      requestedBy: 'local-user', inputSnapshot: input, executionAllowed: true,
      resultSummary: { assetVersionId: null, adopted: false, reason: null }, errorSummary: null })
    this.database.transaction(() => {
      this.database.connection.prepare('INSERT INTO workflow_runs(id,project_id,data) VALUES (?,?,?)').run(run.id, p, JSON.stringify(run))
      workflowDefinitions[run.workflowType].steps.forEach((key, sequence) => {
        const step = stepRunSchema.parse({ ...metadata(), ...times, projectId: p, workflowRunId: run.id,
          stepKey: key, stepType: key, sequence, status: 'pending', attemptCount: 0, inputSnapshot: input,
          outputSnapshot: { preview: null, decisions: [] }, errorSummary: null,
          relatedTaskId: null, relatedGenerationRecordId: null, relatedAssetVersionId: null, relatedReviewId: null, relatedApprovalId: null })
        this.database.connection.prepare('INSERT INTO step_runs(id,project_id,data) VALUES (?,?,?)').run(step.id, p, JSON.stringify(step))
      })
    })
    return this.get(p, run.id)
  }
  get(p: string, id: string) {
    this.database.get(p)
    const row = this.database.connection.prepare('SELECT data FROM workflow_runs WHERE project_id=? AND id=?').get(p, id)
    if (!row) throw new DomainError('NOT_FOUND', '工作流不存在')
    const run = workflowRunSchema.parse(JSON.parse(String(row.data)))
    const steps = this.database.connection.prepare('SELECT data FROM step_runs WHERE project_id=? AND run_id=? ORDER BY CAST(json_extract(data,\'$.sequence\') AS INTEGER)').all(p, id)
      .map((r) => stepRunSchema.parse(JSON.parse(String(r.data))))
    const fail = () => { throw new DomainError('CONFLICT', '工作流状态或关联损坏，禁止执行') }
    const def = workflowDefinitions[run.workflowType]
    if (run.id !== id || run.projectId !== p || run.workflowType !== run.inputSnapshot.workflowType ||
      run.inputSnapshot.generation.projectId !== p || run.inputSnapshot.generation.targetId !== run.targetObjectId || steps.length !== def.steps.length) fail()
    const gen = new GenerationRepository(this.database)
    if (gen.entity(p, run.targetObjectId).kind !== 'shot') fail()
    let incomplete = false
    for (const [i, step] of steps.entries()) {
      if (step.projectId !== p || step.workflowRunId !== id || step.sequence !== i || step.stepKey !== def.steps[i] || step.stepType !== step.stepKey ||
        JSON.stringify(step.inputSnapshot) !== JSON.stringify(run.inputSnapshot)) fail()
      if (incomplete && ['running', 'waiting-user', 'succeeded'].includes(step.status)) fail()
      if (step.status !== 'succeeded') incomplete = true
      if (step.relatedTaskId) {
        const record = gen.findByTask(p, step.relatedTaskId)
        if (!record || record.id !== step.relatedGenerationRecordId || record.targetObjectId !== run.targetObjectId || record.approvalId !== step.relatedApprovalId) fail()
        if (gen.task(p, step.relatedTaskId).input.type !== (run.workflowType === 'shot-keyframe' ? 'image-api' : 'video-api')) fail()
        if (step.relatedAssetVersionId && !record?.outputAssetVersionIds.includes(step.relatedAssetVersionId)) fail()
      } else if (step.relatedGenerationRecordId || step.relatedAssetVersionId || step.relatedApprovalId) fail()
      if (step.stepKey.startsWith('generate-') && ((step.attemptCount === 1) !== Boolean(step.relatedTaskId))) fail()
      if (step.stepKey.startsWith('generate-') && step.relatedTaskId && !step.outputSnapshot.decisions.some(d => d.action === 'confirm-generation')) fail()
      if (step.relatedReviewId && !step.outputSnapshot.decisions.some((d) => d.id === step.relatedReviewId)) fail()
      if (step.status === 'succeeded' && step.stepKey.startsWith('generate-')) {
        if (!step.relatedTaskId || !step.relatedAssetVersionId || gen.findByTask(p, step.relatedTaskId)?.outcome !== 'succeeded') fail()
      }
      if (step.status === 'succeeded' && (step.stepKey.startsWith('review-') || step.stepKey.startsWith('adopt-'))) {
        const action = step.stepKey.startsWith('review-') ? 'approve-candidate' : 'adopt-candidate'
        if (!step.relatedReviewId || !step.outputSnapshot.decisions.some(d => d.id === step.relatedReviewId && d.action === action && d.versionId === step.relatedAssetVersionId)) fail()
      }
    }
    const current = steps.find((s) => s.stepKey === run.currentStepKey)
    if (!current || (run.status === 'waiting-user' && current.status !== 'waiting-user') ||
      (run.status === 'succeeded' && (incomplete || !run.resultSummary.adopted))) fail()
    if (!terminalWorkflow(run.status) && steps.find(s => s.status !== 'succeeded')?.stepKey !== run.currentStepKey) fail()
    if (!terminalWorkflow(run.status) && steps.some(s => ['failed', 'skipped', 'cancelled'].includes(s.status))) fail()
    if (run.status === 'failed' && current?.status !== 'failed') fail()
    if (run.status === 'succeeded' && run.resultSummary.assetVersionId !== steps[1].relatedAssetVersionId) fail()
    return { run, steps }
  }
  list(p: string) {
    this.database.get(p)
    return this.database.connection.prepare('SELECT id FROM workflow_runs WHERE project_id=? ORDER BY rowid DESC').all(p)
      .map((row) => this.get(p, String(row.id)).run)
  }
  saveRun(value: WorkflowRun) { return this.save('workflow_runs', workflowRunSchema, value) }
  saveStep(value: StepRun) { return this.save('step_runs', stepRunSchema, value) }
  private save<T extends WorkflowRun | StepRun>(table: string, schema: z.ZodType<T>, value: T): T {
    const next = schema.parse({ ...value, revision: value.revision + 1, updatedAt: new Date().toISOString() })
    const result = this.database.connection.prepare(`UPDATE ${table} SET data=? WHERE project_id=? AND id=? AND json_extract(data,'$.revision')=?`)
      .run(JSON.stringify(next), value.projectId, value.id, value.revision)
    if (result.changes !== 1) throw new DomainError('CONFLICT', '工作流已更新，请刷新')
    return next
  }
}
