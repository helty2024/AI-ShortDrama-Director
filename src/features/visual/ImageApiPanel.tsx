import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  imageApiCommandSchema,
  type ImageApiCommand,
  type ImageApiPreview,
} from '../../shared/image-api'
import { aiTaskSchema } from '../../shared/intelligence'
import { assetVersionSchema, type AssetVersion } from '../../shared/visual'
import { persistedRecordSchema } from '../../shared/provenance'
import { reservationStatusSchema } from '../../shared/approval'
import { useWorkspace } from '../workspace/state'
import { AssetImage } from '../visual/AssetImage'
async function command(c: ImageApiCommand): Promise<unknown> {
  const r = await window.desktop!.workspace.request({
    action: 'imageApi',
    command: imageApiCommandSchema.parse(c),
  })
  if (!r.ok) throw new Error(r.message)
  return r.data
}
const profilesSchema = z.array(
  z.object({ toolId: z.string(), displayName: z.string() }),
)
const previewSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  target: z.string(),
  tool: z.string(),
  model: z.string(),
  count: z.number(),
  resolution: z.object({ width: z.number(), height: z.number() }),
  referenceCount: z.number(),
  currency: z.string(),
  estimate: z.string(),
  expiresAt: z.string(),
  disclosure: z.string(),
})
const querySchema = z.object({
  task: aiTaskSchema,
  record: persistedRecordSchema,
  reservationStatus: reservationStatusSchema.nullable(),
  versions: z.array(assetVersionSchema),
})
export function ImageApiPanel() {
  const { state } = useWorkspace()
  return <ImageApiSession key={state.workspace?.project.id ?? 'none'} />
}
function ImageApiSession() {
  const { state, reload } = useWorkspace(),
    p = state.workspace?.project.id,
    entities = state.workspace?.entities ?? []
  const [profiles, setProfiles] = useState<z.infer<typeof profilesSchema>>([]),
    [tool, setTool] = useState(''),
    [target, setTarget] = useState(''),
    [count, setCount] = useState(1),
    [width, setWidth] = useState(1024),
    [height, setHeight] = useState(1024)
  const [preview, setPreview] = useState<ImageApiPreview | null>(null),
    [ceiling, setCeiling] = useState(''),
    [allow, setAllow] = useState(false),
    [upload, setUpload] = useState(false),
    [localOnly, setLocalOnly] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [versions, setVersions] = useState<AssetVersion[]>([]),
    [refs, setRefs] = useState<string[]>([]),
    [result, setResult] = useState<z.infer<typeof querySchema> | null>(null)
  const act = async (f: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await f()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let alive = true
    void (async () => {
      const list = profilesSchema.parse(await command({ op: 'profiles' }))
      if (alive) {
        setProfiles(list)
        setTool(list[0]?.toolId ?? '')
      }
      if (p) {
        const r = await window.desktop!.workspace.request({
          action: 'visual',
          command: { operation: 'snapshot', projectId: p },
        })
        if (r.ok && alive)
          setVersions(
            z.object({ versions: z.array(assetVersionSchema) }).parse(r.data)
              .versions,
          )
        const id = localStorage.getItem(`image-api-task:${p}`)
        if (id) {
          const q = querySchema.parse(
            await command({ op: 'query', projectId: p, taskId: id }),
          )
          if (alive) setResult(q)
        }
      }
    })().catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : '读取失败')
    })
    return () => {
      alive = false
    }
  }, [p])
  if (!p) return null
  const chosen = entities.find((e) => e.id === target)
  return (
    <section aria-label="图像 API 生成">
      <h2>图像 API · Reference 协议</h2>
      <p>
        真实供应商未验证。预览不会上传素材或产生生成请求；只有确认后才允许提交。
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void act(async () => {
            await command({ op: 'importProfile' })
            const list = profilesSchema.parse(await command({ op: 'profiles' }))
            setProfiles(list)
            setTool(list.at(-1)?.toolId ?? '')
            setPreview(null)
          })
        }
      >
        安全导入 Profile / Key
      </button>
      {!profiles.length ? (
        <p>
          尚未配置。此协议不代表任何供应商兼容，请参阅 docs/image-api-tool.md。
        </p>
      ) : null}
      <fieldset disabled={busy} onChange={() => setPreview(null)}>
        <legend>生成输入</legend>
        <label>
          目标
          <select
            aria-label="API 生成目标"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">选择 Bible / Shot</option>
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
        <label>
          工具
          <select value={tool} onChange={(e) => setTool(e.target.value)}>
            {profiles.map((v) => (
              <option key={v.toolId} value={v.toolId}>
                {v.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          图片数量
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label>
          宽
          <input
            type="number"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          高
          <input
            type="number"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={localOnly}
            onChange={(e) => setLocalOnly(e.target.checked)}
          />
          仅允许本地工具
        </label>
        <label>
          <input
            type="checkbox"
            checked={upload}
            onChange={(e) => setUpload(e.target.checked)}
          />
          允许所选参考图上传云端
        </label>
        <label>
          参考图（identity）
          <select
            multiple
            value={refs}
            onChange={(e) =>
              setRefs([...e.target.selectedOptions].map((o) => o.value))
            }
          >
            {versions
              .filter((v) => v.mimeType.startsWith('image/'))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {entities.find((e) => e.id === v.assetId)?.name} · v
                  {v.versionNumber}
                </option>
              ))}
          </select>
        </label>
      </fieldset>
      <button
        disabled={busy || !chosen || !tool}
        onClick={() =>
          void act(async () => {
            setPreview(
              previewSchema.parse(
                await command({
                  op: 'preview',
                  input: {
                    projectId: p,
                    targetId: target,
                    toolId: tool,
                    resolution: { width, height },
                    aspectRatio:
                      width === height
                        ? '1:1'
                        : width > height
                          ? '16:9'
                          : '9:16',
                    count,
                    references: refs.map((assetVersionId) => ({
                      assetVersionId,
                      role: 'identity',
                      weight: 1,
                    })),
                    allowAssetUpload: upload,
                    localOnly,
                  },
                }),
              ),
            )
            setAllow(false)
            setCeiling('')
          })
        }
      >
        预览图像生成
      </button>
      {preview ? (
        <div role="region" aria-label="图像生成确认">
          <p>
            {preview.target} · {preview.tool} / {preview.model} ·{' '}
            {preview.count} 张 · {preview.resolution.width}×
            {preview.resolution.height} · {preview.referenceCount} 张参考
          </p>
          <p>{preview.disclosure}</p>
          <p>
            {preview.estimate}（{preview.currency}）；有效至 {preview.expiresAt}
          </p>
          <label>
            最大授权金额（micro {preview.currency}，1 单位 = 1000000 micro）
            <input
              aria-label="最大授权微金额"
              type="number"
              min={0}
              step={1}
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={allow}
              onChange={(e) => setAllow(e.target.checked)}
            />
            我明确允许未知估价，并授权上述费用上限
          </label>
          <button
            disabled={busy || !allow || ceiling === ''}
            onClick={() =>
              void act(async () => {
                const task = aiTaskSchema.parse(
                  await command({
                    op: 'confirm',
                    projectId: p,
                    previewId: preview.id,
                    maxCostMicro: Number(ceiling),
                    allowUnknownCost: allow,
                  }),
                )
                localStorage.setItem(`image-api-task:${p}`, task.id)
                setPreview(null)
                setResult(
                  querySchema.parse(
                    await command({
                      op: 'query',
                      projectId: p,
                      taskId: task.id,
                    }),
                  ),
                )
              })
            }
          >
            确认生成（可能收费）
          </button>
        </div>
      ) : null}
      {result ? (
        <div>
          <p role="status">
            {result.task.status} / {result.record.outcome} · 费用：
            {result.record.actualCost
              ? `${result.record.actualCost.amountMicros} micro ${result.record.currency}`
              : '未知'}
            {' · '}
            {result.reservationStatus === 'requires-review'
              ? '费用需要人工核对（可能超出授权或币种不符）'
              : result.reservationStatus === 'released' ||
                  result.reservationStatus === 'cancelled-before-submit'
                ? '预算已释放'
                : result.reservationStatus === 'consumed'
                  ? '费用已结算'
                  : '预算继续持有，待核对'}
          </p>
          <p>{result.task.error?.message}</p>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () =>
                setResult(
                  querySchema.parse(
                    await command({
                      op: 'query',
                      projectId: p,
                      taskId: result.task.id,
                    }),
                  ),
                ),
              )
            }
          >
            刷新生成结果
          </button>
          {result.versions.map((v) => (
            <article key={v.id}>
              <AssetImage
                projectId={p}
                versionId={v.id}
                alt={`API 候选 v${v.versionNumber}`}
              />
              <p>
                v{v.versionNumber} · {v.status}
              </p>
              {[false, true].map((adopt) => (
                <button
                  key={String(adopt)}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const t = state.workspace?.entities.find(
                        (e) => e.id === result.record.targetObjectId,
                      )
                      if (!t) throw new Error('目标已不存在')
                      await command({
                        op: 'review',
                        projectId: p,
                        versionId: v.id,
                        revision: v.revision,
                        adopt,
                        targetRevision: t.revision,
                      })
                      await reload()
                      setResult(
                        querySchema.parse(
                          await command({
                            op: 'query',
                            projectId: p,
                            taskId: result.task.id,
                          }),
                        ),
                      )
                    })
                  }
                >
                  {adopt ? '审核并采用到目标' : '审核批准版本'}
                </button>
              ))}
            </article>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
