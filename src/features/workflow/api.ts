import { workflowCommandSchema, workflowSnapshotSchema, type WorkflowCommand, type WorkflowInput } from '../../shared/workflow'

export async function workflowCommand(command: WorkflowCommand): Promise<unknown> {
  const result = await window.desktop!.workspace.request({ action: 'workflow', command: workflowCommandSchema.parse(command) })
  if (!result.ok) throw new Error(result.message)
  return result.data
}
export async function createWorkflow(input: WorkflowInput) {
  const snapshot = workflowSnapshotSchema.parse(await workflowCommand({ op: 'createWorkflowRun', input }))
  window.dispatchEvent(new CustomEvent('director-workflow-created', { detail: snapshot.run.id }))
}
