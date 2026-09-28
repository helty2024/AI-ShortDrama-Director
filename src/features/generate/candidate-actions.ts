import type { AssetVersion } from '../../shared/visual'
import type { Shot, Character, Location, Prop } from '../../shared/domain'
import type { WorkflowSnapshot, WorkflowRun } from '../../shared/workflow'
import type { AITask } from '../../shared/intelligence'
import { workflowSnapshotSchema } from '../../shared/workflow'
import { workflowCommand } from '../workflow/api'
import { visualService } from '../../services/visual'
import { imageCommand, videoCommand } from './generation-api'

export type CandidateAction = 'approve' | 'reject' | 'adopt'
export async function reviewCreatorCandidate(input: {
  projectId: string
  target: Shot | Character | Location | Prop
  version: AssetVersion
  action: CandidateAction
  runs?: WorkflowRun[]
  workflow?: WorkflowSnapshot | null
  tasks?: AITask[]
}) {
  const { projectId, target, version, action } = input
  if (target.kind === 'shot') {
    const snapshots = input.workflow ? [input.workflow] : await Promise.all((input.runs ?? [])
      .filter((run) => run.targetObjectId === target.id)
      .map(async (run) => workflowSnapshotSchema.parse(await workflowCommand({ op: 'getWorkflowRun', projectId, runId: run.id }))))
    const active = snapshots.find((snapshot) => snapshot.run.status === 'waiting-user' && snapshot.steps.some((step) => step.stepKey === snapshot.run.currentStepKey && step.relatedAssetVersionId === version.id))
    if (active) {
      await workflowCommand({ op: 'submitWorkflowUserDecision', projectId, runId: active.run.id, expectedRevision: active.run.revision, decision: {
        action: action === 'approve' ? 'approve-candidate' : action === 'reject' ? 'reject-candidate' : 'adopt-candidate',
        versionId: version.id, versionRevision: version.revision, targetRevision: target.revision,
      } })
      return
    }
    if (snapshots.some((snapshot) => snapshot.steps.some((step) => step.relatedAssetVersionId === version.id)) && action !== 'adopt')
      throw new Error('请在当前镜头工作流阶段审核此候选')
    const videoTask = input.tasks?.find((task) => task.id === version.generationTaskId && 'targetId' in task.input && task.input.targetId === target.id && task.input.type === 'video-api')
    if (videoTask && action !== 'reject') {
      await videoCommand({ op: 'review', projectId, versionId: version.id, revision: version.revision, adopt: action === 'adopt', targetRevision: target.revision })
      return
    }
    // Legacy/imported versions have no direct-generation record. The existing visual review
    // contract still separates approval from explicit Shot binding.
    await visualService.command({ operation: 'version.review', projectId, id: version.id, expectedRevision: version.revision,
      status: action === 'reject' ? 'rejected' : 'approved', targetId: action === 'adopt' ? target.id : null,
      targetRevision: action === 'adopt' ? target.revision : null })
    return
  }
  if (action === 'reject') await visualService.command({ operation: 'version.review', projectId, id: version.id, expectedRevision: version.revision, status: 'rejected', targetId: null, targetRevision: null })
  else await imageCommand({ op: 'review', projectId, versionId: version.id, revision: version.revision, adopt: action === 'adopt', targetRevision: target.revision })
}
