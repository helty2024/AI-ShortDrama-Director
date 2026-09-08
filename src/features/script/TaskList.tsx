import type { AITask, IntelligenceCommand } from '../../shared/intelligence'
const taskNames = {
  'shot-video': '镜头视频',
  'character-image': '角色生图',
  'location-image': '场景生图',
  'prop-image': '道具生图',
  'shot-keyframe': '镜头关键帧',
  parse: '剧本解析',
  breakdown: '制作拆解',
  characterBible: '角色 Bible 建议',
  shotPlanning: '导演拆镜',
}
const statuses = {
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
}
export function TaskList({
  tasks,
  execute,
}: {
  tasks: AITask[]
  execute: (command: IntelligenceCommand) => Promise<unknown>
}) {
  return (
    <section aria-label="AI 任务">
      <h3>AI 任务</h3>
      {!tasks.length && <p>暂无任务。</p>}
      {tasks.toReversed().map((task) => (
        <article className="task-row" key={task.id}>
          <strong>
            {taskNames[task.input.type]} · {statuses[task.status]}{' '}
            {Math.round(task.progress * 100)}%
          </strong>
          <small>
            {' '}
            第 {task.attempt} 次 / {task.resultIds.length} 项结果
          </small>
          {task.error && (
            <p className="error">
              {task.error.code}：{task.error.message}
            </p>
          )}
          {(task.status === 'queued' || task.status === 'running') && (
            <button
              onClick={() =>
                void execute({
                  operation: 'task.cancel',
                  projectId: task.projectId,
                  id: task.id,
                }).catch(() => undefined)
              }
            >
              取消任务
            </button>
          )}
          {(task.status === 'failed' || task.status === 'cancelled') && (
            <button
              onClick={() =>
                void (
                  'request' in task.input &&
                  !task.providerTaskId &&
                  !window.confirm(
                    '将重新提交媒体任务；若上次提交结果未知，请先检查 Provider 队列，避免重复执行。',
                  )
                    ? Promise.resolve()
                    : execute({
                        operation: 'task.retry',
                        projectId: task.projectId,
                        id: task.id,
                      })
                ).catch(() => undefined)
              }
            >
              重试任务
            </button>
          )}
        </article>
      ))}
    </section>
  )
}
