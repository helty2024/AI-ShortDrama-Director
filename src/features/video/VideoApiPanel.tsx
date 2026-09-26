import { createWorkflow } from '../workflow/api'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  videoApiCommandSchema,
  videoApiPreviewSchema,
  type VideoApiCommand,
  type VideoApiPreview,
} from '../../shared/video-api'
import { aiTaskSchema } from '../../shared/intelligence'
import { persistedRecordSchema } from '../../shared/provenance'
import { reservationStatusSchema } from '../../shared/approval'
import { assetVersionSchema, type AssetVersion } from '../../shared/visual'
import { useWorkspace } from '../workspace/state'
import { AssetImage } from '../visual/AssetImage'

async function command(c: VideoApiCommand): Promise<unknown> {
  const result = await window.desktop!.workspace.request({
    action: 'videoApi',
    command: videoApiCommandSchema.parse(c),
  })
  if (!result.ok) throw new Error(result.message)
  return result.data
}
const profilesSchema = z.array(
  z.object({
    toolId: z.string(),
    displayName: z.string(),
    capabilities: z.array(z.string()),
    durations: z.array(z.number()),
    resolutions: z.array(z.object({ width: z.number(), height: z.number() })),
    aspectRatios: z.array(z.string()),
  }),
)
const querySchema = z.object({
  task: aiTaskSchema,
  record: persistedRecordSchema,
  reservationStatus: reservationStatusSchema,
  versions: z.array(assetVersionSchema),
  diagnostic: z
    .object({ stage: z.string(), details: z.record(z.string(), z.unknown()), at: z.string() })
    .nullable(),
})

export function VideoApiPanel() {
  const { state } = useWorkspace()
  return <VideoApiSession key={state.workspace?.project.id ?? 'none'} />
}

function VideoApiSession() {
  const { state, reload } = useWorkspace()
  const projectId = state.workspace?.project.id
  const entities = state.workspace?.entities ?? []
  const [profiles, setProfiles] = useState<z.infer<typeof profilesSchema>>([])
  const [versions, setVersions] = useState<AssetVersion[]>([])
  const [toolId, setToolId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [mode, setMode] = useState<'text-to-video' | 'image-to-video'>('image-to-video')
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(5)
  const [fps, setFps] = useState(24)
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(720)
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '9:16' | '16:9' | '4:3' | '3:4' | 'custom'>('16:9')
  const [firstFrame, setFirstFrame] = useState('')
  const [lastFrame, setLastFrame] = useState('')
  const [allowUpload, setAllowUpload] = useState(false)
  const [preview, setPreview] = useState<VideoApiPreview | null>(null)
  const [ceiling, setCeiling] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<z.infer<typeof querySchema> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (raw) {
      setError(raw instanceof Error ? raw.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    void (async () => {
      const available = profilesSchema.parse(await command({ op: 'profiles' }))
      if (active) {
        setProfiles(available)
        setToolId(available[0]?.toolId ?? '')
      }
      if (!projectId) return
      const media = await window.desktop!.workspace.request({
        action: 'visual',
        command: { operation: 'snapshot', projectId },
      })
      if (media.ok && active)
        setVersions(
          z.object({ versions: z.array(assetVersionSchema) }).parse(media.data)
            .versions,
        )
      const taskId = localStorage.getItem(`video-api-task:${projectId}`)
      if (taskId && active)
        setResult(
          querySchema.parse(
            await command({ op: 'query', projectId, taskId }),
          ),
        )
    })().catch((raw) => {
      if (active) setError(raw instanceof Error ? raw.message : '读取失败')
    })
    return () => {
      active = false
    }
  }, [projectId])
  if (!projectId) return null
  const selectedProfile = profiles.find((value) => value.toolId === toolId)
  const imageVersions = versions.filter((value) => value.mimeType.startsWith('image/'))
  return (
    <section aria-label="Video API 生成">
      <h2>Video API</h2>
      <p>Reference Video Protocol 仅用于生产链验证，不代表任何真实视频供应商兼容。预览不会上传或提交。</p>
      {!profiles.length ? (
        <p className="empty">尚未注册 Video API Profile。旧 Mock / Seedance 路径继续独立工作。</p>
      ) : (
        <>
          <fieldset disabled={busy} onChange={() => setPreview(null)}>
            <legend>视频生成输入</legend>
            <label>
              Shot
              <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">选择 Shot</option>
                {entities.filter((value) => value.kind === 'shot').map((value) => (
                  <option key={value.id} value={value.id}>{value.name}</option>
                ))}
              </select>
            </label>
            <label>
              工具
              <select value={toolId} onChange={(event) => setToolId(event.target.value)}>
                {profiles.map((value) => <option key={value.toolId} value={value.toolId}>{value.displayName}</option>)}
              </select>
            </label>
            <label>
              模式
              <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                <option value="text-to-video">文生视频</option>
                <option value="image-to-video">图生视频</option>
              </select>
            </label>
            <label>
              生成描述
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="留空时使用 Shot 的视频描述" />
            </label>
            <label>时长（秒）<input type="number" min={1} max={600} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
            <label>FPS<input type="number" min={1} max={120} value={fps} onChange={(event) => setFps(Number(event.target.value))} /></label>
            <label>宽<input type="number" min={16} value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label>
            <label>高<input type="number" min={16} value={height} onChange={(event) => setHeight(Number(event.target.value))} /></label>
            <label>
              画幅
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}>
                {['1:1', '9:16', '16:9', '4:3', '3:4', 'custom'].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            {mode === 'image-to-video' ? (
              <>
                <label>首帧<select value={firstFrame} onChange={(event) => setFirstFrame(event.target.value)}><option value="">选择受控 AssetVersion</option>{imageVersions.map((value) => <option key={value.id} value={value.id}>v{value.versionNumber} · {entities.find((entity) => entity.id === value.assetId)?.name}</option>)}</select></label>
                <label>可选尾帧<select value={lastFrame} onChange={(event) => setLastFrame(event.target.value)}><option value="">无</option>{imageVersions.map((value) => <option key={value.id} value={value.id}>v{value.versionNumber} · {entities.find((entity) => entity.id === value.assetId)?.name}</option>)}</select></label>
              </>
            ) : null}
            <label className="check-label"><input type="checkbox" checked={allowUpload} onChange={(event) => setAllowUpload(event.target.checked)} />允许把生成描述{mode === 'image-to-video' ? '及所选首尾帧' : ''}发送到该云端工具</label>
          </fieldset>
          <button disabled={busy || !targetId || !selectedProfile} onClick={() => void act(async () => {
            setPreview(videoApiPreviewSchema.parse(await command({ op: 'preview', input: {
              projectId, targetId, toolId, mode, prompt: prompt.trim() || null,
              durationSeconds: duration, fps, resolution: { width, height }, aspectRatio,
              seed: null, firstFrameAssetVersionId: mode === 'image-to-video' ? firstFrame || null : null,
              lastFrameAssetVersionId: mode === 'image-to-video' ? lastFrame || null : null,
              allowAssetUpload: allowUpload, localOnly: false,
            } })))
            setConfirmed(false)
            setCeiling('')
          })}>预览 Video API 生成</button>
        </>
      )}
      <button disabled={busy || !targetId || !selectedProfile} onClick={() => void act(async () => {
        await createWorkflow({ workflowType: 'shot-video', generation: {
          projectId, targetId, toolId, mode, prompt: prompt.trim() || null,
          durationSeconds: duration, fps, resolution: { width, height }, aspectRatio,
          seed: null, firstFrameAssetVersionId: mode === 'image-to-video' ? firstFrame || null : null,
          lastFrameAssetVersionId: mode === 'image-to-video' ? lastFrame || null : null,
          allowAssetUpload: allowUpload, localOnly: false,
        } })
        setPreview(null)
      })}>创建 Shot 视频工作流</button>
      {preview ? (
        <div role="region" aria-label="Video API 提交确认">
          <p>{preview.target} · {preview.tool} / {preview.model} · {preview.mode} · {preview.durationSeconds} 秒 · {preview.resolution.width}×{preview.resolution.height}</p>
          <p>Prompt：{preview.prompt}</p>
          <p>{preview.disclosure}</p>
          <p>{preview.estimate}（{preview.currency}）</p>
          <label>最大授权金额（micro {preview.currency}）<input type="number" min={0} value={ceiling} onChange={(event) => setCeiling(event.target.value)} /></label>
          <label className="check-label"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我明确确认本次云端提交，并授权上述单次费用上限</label>
          <button disabled={busy || !confirmed || ceiling === ''} onClick={() => void act(async () => {
            const task = aiTaskSchema.parse(await command({ op: 'confirm', projectId, previewId: preview.id, maxCostMicro: Number(ceiling), allowUnknownCost: true }))
            localStorage.setItem(`video-api-task:${projectId}`, task.id)
            setPreview(null)
            setResult(querySchema.parse(await command({ op: 'query', projectId, taskId: task.id })))
          })}>确认生成（可能收费）</button>
        </div>
      ) : null}
      {result ? (
        <div>
          <p role="status">{result.task.status} / {result.record.outcome} · 预算 {result.reservationStatus} · 实际费用 {result.record.actualCost ? `${result.record.actualCost.amountMicros} micro ${result.record.actualCost.currency}` : 'unknown'}</p>
          {result.diagnostic ? <p>当前阶段：{result.diagnostic.stage}</p> : null}
          <button disabled={busy} onClick={() => void act(async () => setResult(querySchema.parse(await command({ op: 'query', projectId, taskId: result.task.id }))))}>恢复 / 刷新远端任务</button>
          {result.task.status === 'running' ? <button disabled={busy || !result.task.providerTaskId} onClick={() => void act(async () => { await command({ op: 'cancel', projectId, taskId: result.task.id }); setResult(querySchema.parse(await command({ op: 'query', projectId, taskId: result.task.id }))) })}>请求取消远端任务</button> : null}
          {result.versions.map((version) => (
            <article key={version.id}>
              <AssetImage projectId={projectId} versionId={version.id} thumbnail={false} alt={`Video API 候选 v${version.versionNumber}`} />
              <p>v{version.versionNumber} · {version.status} · {version.width}×{version.height} · {version.duration} 秒</p>
              {[false, true].map((adopt) => <button key={String(adopt)} disabled={busy} onClick={() => void act(async () => {
                const target = state.workspace?.entities.find((value) => value.id === result.record.targetObjectId)
                if (!target) throw new Error('目标已不存在')
                await command({ op: 'review', projectId, versionId: version.id, revision: version.revision, adopt, targetRevision: target.revision })
                await reload()
                setResult(querySchema.parse(await command({ op: 'query', projectId, taskId: result.task.id })))
              })}>{adopt ? '审核并采用到 Shot' : '审核批准候选'}</button>)}
            </article>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert" className="error">{error}</p> : null}
    </section>
  )
}
