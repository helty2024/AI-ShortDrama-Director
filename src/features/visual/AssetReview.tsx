import { useSimpleMode } from '../operations/mode'
import { LazyPanel } from '../../components/LazyPanel'
import { useState } from 'react'
import type { Asset, Entity } from '../../shared/domain'
import type { AssetVersion, VisualCommand } from '../../shared/visual'
import { AssetImage } from './AssetImage'
export function AssetReview({
  asset,
  versions,
  entities,
  execute,
  onChanged,
  targetId,
  onRegenerate,
}: {
  asset: Asset
  versions: AssetVersion[]
  entities: Entity[]
  execute: (c: VisualCommand) => Promise<unknown>
  onChanged: () => Promise<void>
  targetId?: string
  onRegenerate?: (version: AssetVersion) => void
}) {
  const simple = useSimpleMode()
  const [page, setPage] = useState(0)
  const [compare, setCompare] = useState<string[]>([]),
    [bind, setBind] = useState(targetId ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const current = versions.filter((v) => v.assetId === asset.id).toReversed()
  const review = async (
    v: AssetVersion,
    status: AssetVersion['status'],
    bindTarget = true,
  ) => {
    setBusy(true)
    setError('')
    try {
      const target = bindTarget
        ? entities.find((e) => e.id === bind)
        : undefined
      await execute({
        operation: 'version.review',
        projectId: asset.projectId,
        id: v.id,
        expectedRevision: v.revision,
        status,
        targetId: status === 'approved' && target ? target.id : null,
        targetRevision:
          status === 'approved' && target ? target.revision : null,
      })
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '审核失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="asset-review" aria-label={'版本审核 ' + asset.name}>
      <h3>{asset.name} · 版本审核</h3>
      <p>
        主版本：
        {current.find((v) => v.id === asset.approvedVersionId)?.versionNumber ??
          '尚未批准'}
        。镜头固定所确认版本；提升新版本不会替换其他镜头。
      </p>
      <label>
        批准后绑定到
        <select
          aria-label="批准后绑定到"
          value={bind}
          onChange={(e) => setBind(e.target.value)}
        >
          <option value="">只提升资产主版本</option>
          {entities
            .filter((e) =>
              (asset.mediaType === 'video'
                ? ['shot']
                : ['character', 'location', 'prop', 'shot']
              ).includes(e.kind),
            )
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>
        共 {current.length} 个版本 · 第 {page + 1} 页
      </p>
      <button disabled={!page} onClick={() => setPage((n) => n - 1)}>
        上一页版本
      </button>
      <button
        disabled={(page + 1) * 20 >= current.length}
        onClick={() => setPage((n) => n + 1)}
      >
        下一页版本
      </button>
      <div className="asset-version-grid">
        {current.slice(page * 20, (page + 1) * 20).map((v) => (
          <article key={v.id} aria-label={'版本 ' + v.versionNumber}>
            <AssetImage
              projectId={asset.projectId}
              versionId={v.id}
              thumbnail={!(simple && v.mimeType === 'video/mp4')}
              alt={asset.name + ' v' + v.versionNumber}
            />
            <strong>
              v{v.versionNumber} · {v.status}
            </strong>
            <p>
              {v.duration
                ? `${v.duration.toFixed(1)} 秒 / ${v.fps ?? '—'} fps / ${v.codec ?? '—'} · `
                : ''}
              {v.sourceType} · {v.width}×{v.height} ·{' '}
              {Math.round(v.fileSize / 1024)} KB
            </p>
            <p>
              {v.provider ?? '本地导入'} / {v.model ?? '—'}
            </p>
            <LazyPanel title="生成信息与预览">
              {!(simple && v.mimeType === 'video/mp4') && (
                <AssetImage
                  projectId={asset.projectId}
                  versionId={v.id}
                  thumbnail={false}
                  alt="原图预览"
                />
              )}
              <p>Prompt：{v.prompt || '—'}</p>
              <p>Negative：{v.negativePrompt || '—'}</p>
              <p>SHA-256：{v.hash}</p>
              <pre>
                {JSON.stringify(
                  { metadata: v.metadata, cost: v.cost },
                  null,
                  2,
                )}
              </pre>
            </LazyPanel>
            <div className="actions">
              {asset.mediaType === 'video' && (
                <button
                  disabled={busy}
                  onClick={() => void review(v, 'approved', false)}
                >
                  Approve 视频版本
                </button>
              )}
              <button
                disabled={busy || (asset.mediaType === 'video' && !bind)}
                onClick={() => void review(v, 'approved')}
              >
                {asset.mediaType === 'video'
                  ? 'Confirm for Shot'
                  : '批准 / Promote'}
              </button>
              <button
                disabled={busy || v.id === asset.approvedVersionId}
                onClick={() => void review(v, 'rejected')}
              >
                Reject
              </button>
              <button
                disabled={busy || v.id === asset.approvedVersionId}
                onClick={() => void review(v, 'archived')}
              >
                Archive
              </button>
            </div>
            {onRegenerate && (
              <button disabled={busy} onClick={() => onRegenerate(v)}>
                Regenerate / 编辑后重生
              </button>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={compare.includes(v.id)}
                onChange={(e) =>
                  setCompare(
                    e.target.checked
                      ? [...compare.slice(-1), v.id]
                      : compare.filter((id) => id !== v.id),
                  )
                }
              />
              对比此版本
            </label>
          </article>
        ))}
      </div>
      {compare.length > 0 && (
        <div className="version-compare" aria-label="版本对比">
          {compare.map((id) => (
            <figure key={id}>
              <AssetImage
                projectId={asset.projectId}
                versionId={id}
                thumbnail={false}
                alt={
                  '对比版本 ' + current.find((v) => v.id === id)?.versionNumber
                }
              />
              <figcaption>
                v{current.find((v) => v.id === id)?.versionNumber}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <details>
        <summary>引用关系</summary>
        {entities
          .filter((e) => 'assetIds' in e && e.assetIds.includes(asset.id))
          .map((e) => (
            <p key={e.id}>
              {e.name}
              {e.kind === 'shot' && e.approvedKeyframeAssetId === asset.id
                ? ' · 已确认关键帧（版本固定）'
                : ''}
            </p>
          ))}
      </details>
    </section>
  )
}
