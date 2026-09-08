import { useState } from 'react'
import { useWorkspace } from '../workspace/state'
import { useProduction } from './use-production'
import { useIntelligence } from '../script/use-intelligence'
import { TaskList } from '../script/TaskList'
import { batchPreviewSchema } from '../../shared/video'
export function BatchPanel() {
  const { state } = useWorkspace()
  return state.workspace ? (
    <Batch projectId={state.workspace.project.id} />
  ) : null
}
function Batch({ projectId }: { projectId: string }) {
  const { state, reload } = useWorkspace(),
    production = useProduction(projectId),
    ai = useIntelligence(projectId)
  const [selected, setSelected] = useState<string[]>([]),
    [sceneId, setSceneId] = useState(''),
    [episodeId, setEpisodeId] = useState(''),
    [provider, setProvider] = useState<'mock-image' | 'comfyui'>('mock-image'),
    [preview, setPreview] = useState<
      { shotId: string; positivePrompt: string; error: string | null }[]
    >([])
  const entities = state.workspace?.entities ?? [],
    shots = entities.filter((e) => e.kind === 'shot')
  const filtered = shots.filter(
    (s) =>
      (!sceneId || s.sceneId === sceneId) &&
      (!episodeId ||
        entities.some(
          (e) =>
            e.kind === 'scene' &&
            e.id === s.sceneId &&
            e.episodeId === episodeId,
        )),
  )
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await reload()
      await ai.refresh()
    } catch {
      /* hook shows errors */
    }
  }
  return (
    <details className="batch-panel">
      <summary>批量关键帧生产</summary>
      <p>
        每个镜头独立任务和候选版本，最多 20 项；失败不会批准或覆盖其他镜头。
      </p>
      <div className="asset-filters">
        <label>
          Scene
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            <option value="">全部场次</option>
            {entities
              .filter((e) => e.kind === 'scene')
              .map((e) => (
                <option value={e.id} key={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Episode
          <select
            value={episodeId}
            onChange={(e) => setEpisodeId(e.target.value)}
          >
            <option value="">全部分集</option>
            {entities
              .filter((e) => e.kind === 'episode')
              .map((e) => (
                <option value={e.id} key={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          批量图像 Provider
          <select
            value={provider}
            onChange={(e) =>
              setProvider(e.target.value as 'mock-image' | 'comfyui')
            }
          >
            <option value="mock-image">Mock Image</option>
            <option value="comfyui">ComfyUI</option>
          </select>
        </label>
      </div>
      <div className="actions">
        <button
          onClick={() => setSelected(filtered.slice(0, 20).map((s) => s.id))}
        >
          当前范围全选
        </button>
        <button
          onClick={() =>
            setSelected(
              filtered
                .filter((s) => !s.approvedKeyframeVersionId)
                .slice(0, 20)
                .map((s) => s.id),
            )
          }
        >
          仅选缺少关键帧
        </button>
        <button onClick={() => setSelected([])}>清空选择</button>
      </div>
      {filtered.map((s) => (
        <label className="check-label" key={s.id}>
          <input
            type="checkbox"
            checked={selected.includes(s.id)}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...selected, s.id].slice(0, 20)
                  : selected.filter((id) => id !== s.id),
              )
            }
          />
          {s.name} {s.approvedKeyframeVersionId ? '已确认关键帧' : '待生成'}
        </label>
      ))}
      <div className="actions">
        <button
          disabled={!selected.length || production.busy}
          onClick={() =>
            void run(async () =>
              setPreview(
                batchPreviewSchema.parse(
                  await production.execute({
                    operation: 'batch.compile',
                    projectId,
                    shotIds: selected,
                  }),
                ),
              ),
            )
          }
        >
          批量编译 Prompt
        </button>
        <button
          disabled={!selected.length || production.busy}
          onClick={() =>
            void run(() =>
              production.execute({
                operation: 'batch.start',
                projectId,
                shotIds: selected,
                provider,
              }),
            )
          }
        >
          批量生成关键帧
        </button>
        <button disabled>批量视频请前往生产看板</button>
        <button disabled>暂停 / 继续（预留）</button>
      </div>
      {production.error && (
        <p role="alert" className="error">
          {production.error}
        </p>
      )}
      {preview.map((p) => (
        <details key={p.shotId}>
          <summary>
            {shots.find((s) => s.id === p.shotId)?.name} · Prompt
          </summary>
          <p>{p.error || p.positivePrompt}</p>
        </details>
      ))}
      {production.snapshot?.batches.toReversed().map((group) => {
        const tasks = ai.snapshot.tasks.filter((t) =>
          group.entries.some((e) => e.taskId === t.id),
        )
        return (
          <article key={group.id}>
            <h4>{group.name}</h4>
            <p>
              {tasks.filter((t) => t.status === 'succeeded').length}/
              {group.entries.length} 成功 ·{' '}
              {tasks.filter((t) => t.status === 'failed').length +
                group.entries.filter((e) => e.error).length}{' '}
              失败
            </p>
            {group.entries
              .filter((e) => e.error)
              .map((e) => (
                <p key={e.shotId} className="error">
                  {shots.find((s) => s.id === e.shotId)?.name}：{e.error}
                  <button
                    disabled={production.busy}
                    onClick={() =>
                      void run(() =>
                        production.execute({
                          operation: 'batch.start',
                          projectId,
                          shotIds: [e.shotId],
                          provider,
                        }),
                      )
                    }
                  >
                    重试准备失败项
                  </button>
                </p>
              ))}
            <TaskList tasks={tasks} execute={ai.execute} />
          </article>
        )
      })}
    </details>
  )
}
