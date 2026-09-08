import { useState } from 'react'
import { useWorkspace } from '../workspace/state'
import { usePilot } from '../production/use-pilot'
import { useVisual } from '../visual/use-visual'
import { nextAction } from '../../shared/operations'
import { AssetImage } from '../visual/AssetImage'
import { AssetReview } from '../visual/AssetReview'
import { LazyPanel } from '../../components/LazyPanel'
import { ShotTools } from '../production/ProductionBoard'
import { PaidTest } from './OperationsPage'
export function SimpleBoard() {
  const { state } = useWorkspace()
  return state.workspace ? (
    <Board projectId={state.workspace.project.id} />
  ) : (
    <p>请先打开项目。</p>
  )
}
function Board({ projectId }: { projectId: string }) {
  const { state, reload } = useWorkspace(),
    pilot = usePilot(projectId),
    visual = useVisual(projectId),
    [page, setPage] = useState(0),
    [error, setError] = useState('')
  const entities = state.workspace?.entities ?? [],
    shots = entities.filter((e) => e.kind === 'shot'),
    snapshot = pilot.snapshot
  if (!snapshot || !visual.snapshot) return <p>加载生产状态…</p>
  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
      await reload()
      await visual.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    }
  }
  return (
    <section>
      <p>
        从关键帧开始，依次审核视频、检查连续性和 QC。服务参数与批次设置可在顶部
        Advanced 中查看。
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={pilot.busy}
        onClick={() =>
          void run(() =>
            pilot.execute({
              operation: 'manifest.export',
              projectId,
              episodeId: entities.find((e) => e.kind === 'episode')!.id,
            }),
          )
        }
      >
        导出 Production Manifest
      </button>
      <p>
        {shots.length} 个镜头 · 第 {page + 1} 页
      </p>
      <button disabled={!page} onClick={() => setPage((n) => n - 1)}>
        上一页镜头
      </button>
      <button
        disabled={(page + 1) * 20 >= shots.length}
        onClick={() => setPage((n) => n + 1)}
      >
        下一页镜头
      </button>
      {shots.slice(page * 20, (page + 1) * 20).map((shot) => {
        const status = snapshot.statuses.find((s) => s.shotId === shot.id)
        const versions = visual.snapshot!.versions.filter(
          (v) =>
            v.metadata.targetId === shot.id ||
            shot.assetIds.includes(v.assetId),
        )
        const assets = entities.filter(
          (e) => e.kind === 'asset' && versions.some((v) => v.assetId === e.id),
        )
        return (
          <article
            className="production-shot"
            key={shot.id}
            aria-label={'生产镜头 ' + shot.name}
          >
            <h2>
              Shot {shot.order + 1} · {shot.name}
            </h2>
            {status && (
              <p role="status">
                <strong>下一步：{nextAction(status)}</strong>
                <br />
                关键帧 {status.keyframe} · 视频 {status.video} · QC {status.qc}
              </p>
            )}
            {shot.approvedKeyframeVersionId && (
              <AssetImage
                projectId={projectId}
                versionId={shot.approvedKeyframeVersionId}
                alt={shot.name}
              />
            )}
            <button
              disabled={visual.busy || status?.keyframe === 'generating'}
              onClick={() =>
                void run(() =>
                  visual.execute({
                    operation: 'generate',
                    projectId,
                    targetId: shot.id,
                    assetId: null,
                    provider: visual.snapshot!.settings.provider,
                    positivePrompt: null,
                    negativePrompt: null,
                    previousShot: false,
                  }),
                )
              }
            >
              生成关键帧
            </button>
            <LazyPanel title="关键帧 / 视频审核">
              {assets.map(
                (asset) =>
                  asset.kind === 'asset' && (
                    <AssetReview
                      key={asset.id}
                      asset={asset}
                      versions={versions}
                      entities={entities}
                      execute={visual.execute}
                      onChanged={async () => {
                        await reload()
                        await visual.refresh()
                      }}
                      targetId={shot.id}
                    />
                  ),
              )}
            </LazyPanel>
            <LazyPanel title="生成视频（单镜头确认）">
              <PaidTest projectId={projectId} shotId={shot.id} />
            </LazyPanel>
            <LazyPanel title="连续性与 QC">
              <ShotTools
                shot={shot}
                entities={entities}
                snapshot={snapshot}
                execute={pilot.execute}
              />
            </LazyPanel>
          </article>
        )
      })}
    </section>
  )
}
