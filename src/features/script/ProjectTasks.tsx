import { useWorkspace } from '../workspace/state'
import { useIntelligence } from './use-intelligence'
import { TaskList } from './TaskList'
export function ProjectTasks() {
  const { state } = useWorkspace()
  return state.workspace ? (
    <Tasks projectId={state.workspace.project.id} />
  ) : null
}
function Tasks({ projectId }: { projectId: string }) {
  const ai = useIntelligence(projectId)
  return (
    <>
      {ai.error && (
        <p className="error" role="alert">
          {ai.error}
        </p>
      )}
      <TaskList tasks={ai.snapshot.tasks} execute={ai.execute} />
    </>
  )
}
