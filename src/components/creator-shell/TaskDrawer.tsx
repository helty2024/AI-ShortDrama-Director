import { useEffect, useState } from 'react'
import { operationsSnapshotSchema } from '../../shared/operations'
import type { OperationsSnapshot } from '../../shared/operations'
import { workflowRunSchema } from '../../shared/workflow'
import type { WorkflowRun } from '../../shared/workflow'
import { operate } from '../../features/operations/api'
import { workflowCommand } from '../../features/workflow/api'
import { useWorkspace } from '../../features/workspace/state'
import { useCreator } from './creator-context'
import type { CreatorSelection } from './creator-context'
import type { CreatorModule } from './modules'
import { StatusBadge } from './StatusBadge'

export function TaskDrawer() {
  const { state } = useWorkspace()
  const { taskDrawerOpen, setTaskDrawerOpen, navigateCreator } = useCreator()
  const projectId = state.workspace?.project.id
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null)
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!projectId) return
    let active = true
    const refresh = async () => {
      try {
        const [tasks, runs] = await Promise.all([
          operate({ operation: 'snapshot', projectId, page: 0 }),
          workflowCommand({ op: 'listWorkflowRuns', projectId }),
        ])
        if (active) {
          setSnapshot(operationsSnapshotSchema.parse(tasks))
          setWorkflows(workflowRunSchema.array().parse(runs))
          setError('')
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '任务读取失败') }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [projectId])
  const tasks = snapshot?.tasks ?? []
  const activeCount = tasks.filter((task) => ['queued', 'submitted', 'running'].includes(task.status)).length + workflows.filter((run) => ['pending', 'running'].includes(run.status)).length
  const waitingCount = workflows.filter((run) => run.status === 'waiting-user').length
  const openTask = (task: OperationsSnapshot['tasks'][number]) => {
    const matches = state.workspace?.entities.filter((entity) => entity.id === task.target || entity.name === task.target) ?? []
    const target = matches.length === 1 ? matches[0] : undefined
    let module: CreatorModule = 'scripts'
    let selection: CreatorSelection = {}
    if (target?.kind === 'shot') {
      module = task.kind === 'qc' ? 'storyboard' : 'generation'
      selection = { shotId: target.id }
    } else if (target && ['character', 'location', 'prop', 'asset'].includes(target.kind)) {
      module = 'assetsHub'
      selection = { assetId: target.id }
    } else if (task.kind.includes('video') || task.kind.includes('image')) module = 'generation'
    navigateCreator(module, selection)
    setTaskDrawerOpen(false)
  }
  return <section className={'creator-task-drawer' + (taskDrawerOpen ? ' is-open' : '')} aria-label="制作任务">
    <button className="creator-task-toggle" aria-expanded={taskDrawerOpen} aria-controls="creator-task-content" onClick={() => setTaskDrawerOpen(!taskDrawerOpen)}>
      <strong>制作任务</strong><span>{activeCount} 个任务进行中 · {waitingCount} 个等待确认</span><span aria-hidden="true">{taskDrawerOpen ? '⌄' : '⌃'}</span>
    </button>
    {taskDrawerOpen && <div id="creator-task-content" className="creator-task-content">
      {error && <p role="alert">{error}</p>}
      {!tasks.length && !workflows.length && !error && <p>暂无制作任务。</p>}
      {workflows.map((run) => <article key={run.id} className="creator-task-row"><div><strong>{state.workspace?.entities.find((entity) => entity.id === run.targetObjectId)?.name ?? '镜头'}</strong><span>{run.workflowType === 'shot-video' ? '生成视频' : '生成关键帧'}</span></div><StatusBadge status={run.status} task /><button onClick={() => { navigateCreator('generation', { shotId: run.targetObjectId }); setTaskDrawerOpen(false) }}>查看</button></article>)}
      {tasks.map((task) => <article key={task.id} className="creator-task-row"><div><strong>{task.target}</strong><span>{task.kind === 'qc' ? '质量检查' : task.kind.includes('video') ? '生成视频' : task.kind.includes('image') ? '生成图片' : '剧本任务'}</span></div><StatusBadge status={task.status} task /><span>{Math.round(task.progress * 100)}%</span><button onClick={() => openTask(task)}>查看</button></article>)}
      {snapshot && snapshot.totalTasks > tasks.length && <button onClick={() => navigateCreator('operations')}>查看全部历史任务</button>}
    </div>}
  </section>
}
