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
  const [compare, setCompare] = useState<string[]>([]),
    [bind, setBind] = useState(targetId ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const current = versions.filter((v) => v.assetId === asset.id).toReversed()
  const review = async (v: AssetVersion, status: AssetVersion['status']) => {
    setBusy(true)
    setError('')
    try {
      const target = entities.find((e) => e.id === bind)
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
              ['character', 'location', 'prop', 'shot'].includes(e.kind),
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
      <div className="asset-version-grid">
        {current.map((v) => (
          <article key={v.id} aria-label={'版本 ' + v.versionNumber}>
            <AssetImage
              projectId={asset.projectId}
              versionId={v.id}
              alt={asset.name + ' v' + v.versionNumber}
            />
            <strong>
              v{v.versionNumber} · {v.status}
            </strong>
            <p>
              {v.sourceType} · {v.width}×{v.height} ·{' '}
              {Math.round(v.fileSize / 1024)} KB
            </p>
            <p>
              {v.provider ?? '本地导入'} / {v.model ?? '—'}
            </p>
            <details>
              <summary>生成信息与预览</summary>
              <AssetImage
                projectId={asset.projectId}
                versionId={v.id}
                thumbnail={false}
                alt="原图预览"
              />
              <p>Prompt：{v.prompt || '—'}</p>
              <p>Negative：{v.negativePrompt || '—'}</p>
              <p>SHA-256：{v.hash}</p>
              <pre>{JSON.stringify(v.metadata, null, 2)}</pre>
            </details>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => void review(v, 'approved')}
              >
                批准 / Promote
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
