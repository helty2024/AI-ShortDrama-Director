import { workflowCommandSchema, type WorkflowCommand } from '../../../src/shared/workflow.js'
import { WorkflowRepository } from './repository.js'
import { WorkflowRunner } from './runner.js'
import type { ImageGenerationService } from '../generation/image-service.js'
import type { VideoApiGenerationService } from '../generation/video-api-service.js'

export class WorkflowService {
  readonly repository: WorkflowRepository
  readonly runner: WorkflowRunner
  constructor(image: ImageGenerationService, video: VideoApiGenerationService) {
    this.repository = new WorkflowRepository(image.visual.repo.database)
    this.runner = new WorkflowRunner(this.repository, image, video)
  }
  execute(raw: WorkflowCommand) {
    const c = workflowCommandSchema.parse(raw)
    if (c.op === 'createWorkflowRun') {
      const result = this.repository.create(c.input)
      this.runner.resume(result.run.projectId, result.run.id)
      return this.repository.get(result.run.projectId, result.run.id)
    }
    if (c.op === 'listWorkflowRuns') return this.repository.list(c.projectId)
    if (c.op === 'resumeWorkflowRun') this.runner.resume(c.projectId, c.runId)
    if (c.op === 'cancelWorkflowRun') this.runner.cancel(c.projectId, c.runId)
    if (c.op === 'submitWorkflowUserDecision') this.runner.decision(c)
    return this.repository.get(c.projectId, c.runId)
  }
}
