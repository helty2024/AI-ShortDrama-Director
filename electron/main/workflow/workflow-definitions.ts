import type { WorkflowRun, StepRun } from '../../../src/shared/workflow.js'

interface WorkflowDefinition {
  workflowType: WorkflowRun['workflowType']
  supportedTargetType: 'shot'
  steps: readonly StepRun['stepType'][]
  resumePolicy: 'existing-task-only'
  cancellableSteps: readonly StepRun['stepType'][]
  requiresUserActionSteps: readonly StepRun['stepType'][]
}
function definition(kind: 'image' | 'video'): WorkflowDefinition {
  const steps: StepRun['stepType'][] = ['prepare', `generate-${kind}`, `review-${kind}`, `adopt-${kind}`, 'complete']
  return Object.freeze({
    workflowType: kind === 'image' ? 'shot-keyframe' : 'shot-video', supportedTargetType: 'shot',
    steps: Object.freeze(steps), resumePolicy: 'existing-task-only', cancellableSteps: Object.freeze(steps.slice(0, -1)),
    requiresUserActionSteps: Object.freeze(steps.slice(1, -1)),
  })
}
export const workflowDefinitions = Object.freeze({ 'shot-keyframe': definition('image'), 'shot-video': definition('video') })
