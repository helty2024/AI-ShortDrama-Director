import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { AssetVersion } from '../../shared/visual'
import type { ImageApiPreview } from '../../shared/image-api'
import { aiTaskSchema } from '../../shared/intelligence'
import { workflowPreviewSchema } from '../../shared/workflow'
import { useCreator } from '../../components/creator-shell/creator-context'
import { useToast } from '../../components/creator-shell/toast-context'
import { useWorkspace } from '../workspace/state'
import { useVisual } from '../visual/use-visual'
import { useIntelligence } from '../script/use-intelligence'
import { AssetImage } from '../visual/AssetImage'
import { resolveCreatorAsset, assetLabels } from '../assets/creator-assets'
import { orderedShots, officialVersion, shotCandidates, shotStatus, approvedShotReferences, videoStatusWithReadiness } from '../storyboard/storyboard-model'
import { useWorkflowRuns } from './use-workflow-runs'
import { useGenerationWorkflow } from './use-generation-workflow'
import { imageCommand, imageProfilesSchema, videoCommand, videoProfilesSchema, directQuerySchema } from './generation-api'
import { GenerationConfirm } from './GenerationConfirm'
import { CandidateSource } from './GenerationSource'
import { videoToolReady } from './readiness'
import { reviewCreatorCandidate } from './candidate-actions'
import { creatorErrorMessage, creatorStatus } from '../../components/creator-shell/status'
import { isAlphaTestTool } from '../../shared/alpha'
import './generate-creator.css'

type Mode = 'keyframe' | 'video'
const imagePreviewSchema = z.object({ id: z.uuid(), projectId: z.uuid(), target: z.string(), tool: z.string(), model: z.string(), prompt: z.string(), negativePrompt: z.string().optional(), compilerVersion: z.string().optional(), count: z.number(), resolution: z.object({ width: z.number(), height: z.number() }), referenceCount: z.number(), currency: z.string(), estimate: z.string(), expiresAt: z.string(), disclosure: z.string(), executionMode: z.enum(['cloud', 'local-service']), knownFree: z.boolean() })

export function GenerateCreatorPage() {
  const { state } = useWorkspace()
  const projectId = state.workspace?.project.id
  if (!projectId) return <p className="empty">请先打开项目。</p>
  return <GenerateWorkspace key={projectId} projectId={projectId} />
}

function GenerateWorkspace({ projectId }: { projectId: string }) {
  const { state, reload } = useWorkspace()
  const { shotId, targetId, targetKind, generationMode, select, navigateCreator, closeInspector } = useCreator()
  const toast = useToast()
  const visual = useVisual(projectId), ai = useIntelligence(projectId), allRuns = useWorkflowRuns(projectId)
  const entities = state.workspace?.entities ?? []
  const versions = visual.snapshot?.versions ?? []
  const shots = orderedShots(entities)
  const asset = targetKind && targetId ? entities.find((e) => e.id === targetId && e.kind === targetKind) : undefined
  const shot = !asset ? shots.find((s) => s.id === shotId) : undefined
  const target = asset ?? shot
  const [modeChoice, setModeChoice] = useState<{ shotId: string; mode: Mode } | null>(null)
  const [imageProfiles, setImageProfiles] = useState<z.infer<typeof imageProfilesSchema>>([])
  const [videoProfiles, setVideoProfiles] = useState<z.infer<typeof videoProfilesSchema>>([])
  const [toolChoice, setToolChoice] = useState('')
  const [routingMode, setRoutingMode] = useState<'AUTO' | 'fixed'>('AUTO')
  const [resolutionChoice, setResolutionChoice] = useState<{ width: number; height: number } | null>(null)
  const [durationChoice, setDurationChoice] = useState<number | null>(null)
  const [fps, setFps] = useState(24)
  const [videoType, setVideoType] = useState<'image-to-video' | 'text-to-video'>('image-to-video')
  const [allowUpload, setAllowUpload] = useState(true)
  const [localOnly, setLocalOnly] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [videoDetails, setVideoDetails] = useState(false)
  const [preview, setPreview] = useState<ImageApiPreview | null>(null)
  const [dismissedPreviewId, setDismissedPreviewId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [directResult, setDirectResult] = useState<z.infer<typeof directQuerySchema> | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [compare, setCompare] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkedShots, setCheckedShots] = useState<string[]>([])
  const [failureEvidence, setFailureEvidence] = useState<{ taskId: string; unknown: boolean } | null>(null)
  const mode: Mode = shot && modeChoice?.shotId === shot.id ? modeChoice.mode : shot && generationMode === 'video' ? 'video' : shot && officialVersion(shot, 'keyframe', entities, versions) ? 'video' : 'keyframe'
  const profiles = mode === 'video' && shot ? videoProfiles : imageProfiles
  const toolId = profiles.some((profile) => profile.toolId === toolChoice) ? toolChoice : profiles[0]?.toolId ?? ''
  const videoReady = videoToolReady(videoProfiles, toolId)
  const testGeneration = isAlphaTestTool(toolId)
  const resolution = resolutionChoice ?? (mode === 'video' && shot ? videoProfiles.find(p => p.toolId === toolId)?.resolutions[0] : imageProfiles.find(p => p.toolId === toolId)?.resolutions.value?.[0]) ?? { width: 1024, height: 1024 }
  const duration = durationChoice ?? videoProfiles.find(p => p.toolId === toolId)?.durations[0] ?? shot?.durationSeconds ?? 5
  const workflow = useGenerationWorkflow(projectId, shot?.id ?? '', mode)
  const run = workflow.snapshot?.run
  const step = workflow.snapshot?.steps.find((item) => item.stepKey === run?.currentStepKey)
  const workflowPreview = step?.outputSnapshot.preview ? workflowPreviewSchema.parse(step.outputSnapshot.preview) : null
  const confirmation = shot ? workflowPreview && workflowPreview.id !== dismissedPreviewId && run?.status === 'waiting-user' && step && !step.relatedTaskId ? workflowPreview : null : preview
  const ownedDirect = ai.snapshot.tasks.filter((task) => target && 'targetId' in task.input && task.input.targetId === target.id && task.input.type === 'image-api' && !allRuns.runs.some((r) => r.targetObjectId === target.id && r.workflowType === 'shot-keyframe' && r.id === run?.id && step?.relatedTaskId === task.id))
  const activeTaskId = taskId || (!shot ? ownedDirect[0]?.id ?? '' : '')
  const currentTask = ai.snapshot.tasks.find((task) => task.id === activeTaskId)
  useEffect(() => {
    if (run?.status !== 'failed' || !step?.relatedTaskId) return
    let active = true
    const failedTaskId = step.relatedTaskId
    const command = { op: 'query' as const, projectId, taskId: failedTaskId }
    void (mode === 'video' ? videoCommand(command) : imageCommand(command)).then(raw => {
      const result = directQuerySchema.parse(raw)
      if (active) setFailureEvidence({ taskId: failedTaskId, unknown: result.reservationStatus === 'pending-unknown' || result.record.outcome === 'unknown' })
    }).catch(() => { if (active) setFailureEvidence({ taskId: failedTaskId, unknown: true }) })
    return () => { active = false }
  }, [run?.status, step?.relatedTaskId, projectId, mode])

  useEffect(() => {
    let active = true
    void Promise.all([imageCommand({ op: 'profiles' }), videoCommand({ op: 'profiles' })]).then(([images, videos]) => {
      if (!active) return
      setImageProfiles(imageProfilesSchema.parse(images).toSorted((a, b) => Number(isAlphaTestTool(b.toolId)) - Number(isAlphaTestTool(a.toolId))))
      setVideoProfiles(videoProfilesSchema.parse(videos).toSorted((a, b) => Number(isAlphaTestTool(b.toolId)) - Number(isAlphaTestTool(a.toolId))))
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '生成方式暂不可用') })
    return () => { active = false }
  }, [projectId])
  useEffect(() => {
    let active = true
    if (!activeTaskId || shotId) return
    void imageCommand({ op: 'query', projectId, taskId: activeTaskId }).then((result) => { if (active) setDirectResult(directQuerySchema.parse(result)) }).catch(() => { if (active) setDirectResult(null) })
    return () => { active = false }
  }, [projectId, activeTaskId, shotId])

  const act = async (operation: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await operation() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请刷新后重试') }
    finally { setBusy(false) }
  }
  const previousShot = shot ? shots.filter((candidate) => candidate.storyboardId === shot.storyboardId && candidate.order < shot.order).at(-1) : undefined
  const references = shot ? approvedShotReferences(shot, entities, versions, previousShot) : []
  const keyframe = shot ? officialVersion(shot, 'keyframe', entities, versions) : undefined
  const currentOfficial = shot ? officialVersion(shot, mode, entities, versions) : asset && (asset.kind === 'character' || asset.kind === 'location' || asset.kind === 'prop') ? resolveCreatorAsset(asset, entities, versions, ai.snapshot.tasks).primaryVersion : undefined
  const currentCandidates = shot ? (step?.relatedAssetVersionId ? versions.filter((v) => v.id === step.relatedAssetVersionId && (v.status === 'draft' || v.status === 'approved')) : []) : asset && (asset.kind === 'character' || asset.kind === 'location' || asset.kind === 'prop') ? resolveCreatorAsset(asset, entities, versions, ai.snapshot.tasks).candidates : []
  const history = shot ? shotCandidates(shot, mode, versions, ai.snapshot.tasks).filter((v) => v.status === 'rejected' || v.status === 'archived') : asset && (asset.kind === 'character' || asset.kind === 'location' || asset.kind === 'prop') ? resolveCreatorAsset(asset, entities, versions, ai.snapshot.tasks).history : []
  const candidate = currentCandidates.find((v) => v.id === selectedVersionId) ?? currentCandidates[0]
  const pendingUnknown = directResult?.reservationStatus === 'pending-unknown' || directResult?.record.outcome === 'unknown' || (run?.status === 'failed' && failureEvidence?.taskId === step?.relatedTaskId && failureEvidence?.unknown)
  const queueTargets = checkedShots.length ? shots.filter(item => checkedShots.includes(item.id)) : shot ? [shot] : []
  const locked = pendingUnknown || Boolean(run && ['running', 'pending', 'waiting-user'].includes(run.status)) || Boolean(run?.status === 'failed' && step?.relatedTaskId && failureEvidence?.taskId !== step.relatedTaskId)

  const start = () => void act(async () => {
    if (shot && mode === 'video' && !videoReady) throw new Error('尚未配置可用的视频生成工具')
    if (!target || !toolId) throw new Error('请先选择目标并配置可用生成工具')
    if (shot) {
      if (mode === 'video' && videoType === 'image-to-video' && queueTargets.some(item => !officialVersion(item, 'keyframe', entities, versions))) throw new Error('请先确认所选镜头的关键帧，或切换文生视频')
      for (const item of queueTargets) {
        if (allRuns.runs.some(existing => existing.targetObjectId === item.id && existing.workflowType === (mode === 'keyframe' ? 'shot-keyframe' : 'shot-video') && ['running', 'pending', 'waiting-user'].includes(existing.status))) throw new Error('该镜头已有制作进行中，请先完成选择或刷新状态。')
        const firstFrame = officialVersion(item, 'keyframe', entities, versions)
        const refs = approvedShotReferences(item, entities, versions)
        if (mode === 'keyframe') await workflow.create({ workflowType: 'shot-keyframe', generation: { projectId, targetId: item.id, toolId, routingMode: testGeneration ? 'fixed' : routingMode, resolution, aspectRatio: resolution.width === resolution.height ? '1:1' : resolution.width > resolution.height ? '16:9' : '9:16', count: 1, references: refs.map((v) => ({ assetVersionId: v.id, role: 'identity', weight: 1 })), allowAssetUpload: allowUpload, localOnly } })
        else await workflow.create({ workflowType: 'shot-video', generation: { projectId, targetId: item.id, toolId, mode: videoType, prompt: null, durationSeconds: duration, fps, resolution, aspectRatio: resolution.width === resolution.height ? '1:1' : resolution.width > resolution.height ? '16:9' : '9:16', seed: null, firstFrameAssetVersionId: videoType === 'image-to-video' ? firstFrame?.id ?? null : null, lastFrameAssetVersionId: null, allowAssetUpload: allowUpload, localOnly: false } })
      }
      select({ shotId: queueTargets[0]!.id, sceneId: queueTargets[0]!.sceneId })
      closeInspector()
    } else {
      setPreview(imagePreviewSchema.parse(await imageCommand({ op: 'preview', input: { projectId, targetId: target.id, toolId, routingMode: testGeneration ? 'fixed' : routingMode, resolution, aspectRatio: resolution.width === resolution.height ? '1:1' : resolution.width > resolution.height ? '16:9' : '9:16', count: 1, references: [], allowAssetUpload: false, localOnly } })))
    }
  })
  const confirm = async (micro: number, unknown: boolean) => act(async () => {
    if (shot && run && workflowPreview) {
      await workflow.act({ op: 'submitWorkflowUserDecision', projectId, runId: run.id, expectedRevision: run.revision, decision: { action: 'confirm-generation', previewId: workflowPreview.id, maxCostMicro: micro, allowUnknownCost: unknown } })
    } else if (preview) {
      const task = aiTaskSchema.parse(await imageCommand({ op: 'confirm', projectId, previewId: preview.id, maxCostMicro: micro, allowUnknownCost: unknown }))
      setTaskId(task.id); setPreview(null); await ai.refresh()
    }
  })
  const review = (version: AssetVersion, action: 'approve' | 'reject' | 'adopt') => void act(async () => {
    if (!target) throw new Error('目标不存在')
    if (target.kind !== 'shot' && target.kind !== 'character' && target.kind !== 'location' && target.kind !== 'prop') throw new Error('目标类型不支持审核')
    await reviewCreatorCandidate({ projectId, target, version, action, workflow: shot ? workflow.snapshot : null, tasks: ai.snapshot.tasks })
    await Promise.all([reload(), visual.refresh(), ai.refresh()])
    toast('success', action === 'approve' ? '候选已批准，尚未采用' : action === 'reject' ? '候选已拒绝，历史仍保留' : shot ? mode === 'keyframe' ? '已设为镜头关键帧' : '已设为当前镜头视频' : '已设为主参考')
  })
  const refreshStatus = () => void act(async () => {
    if (shot && run) { await workflow.act({ op: 'resumeWorkflowRun', projectId, runId: run.id }); await workflow.refresh() }
    else if (activeTaskId) setDirectResult(directQuerySchema.parse(await imageCommand({ op: 'query', projectId, taskId: activeTaskId })))
    await Promise.all([visual.refresh(), ai.refresh(), reload()])
  })

  return <section className="generate-creator" aria-label="生成工作区"><div className="page-heading"><div><h1>让故事，变成画面</h1><p>选择镜头 → 确认生成 → 选择候选 → 设为当前版本。每一步由你决定。</p></div><span className="creator-status">自动推荐{testGeneration ? ' · 模拟生成' : ''}</span></div>
    {testGeneration && <p className="alpha-test-notice">Alpha 测试模式：{mode === 'video' ? '测试视频' : '测试图片'}由本地模拟生成，带有测试标记，不消费积分。用于验证流程，不能代表真实画面质量。</p>}
    <div className="generate-layout"><aside className="generate-queue" aria-label={asset ? '当前资产目标' : '镜头队列'}>{asset ? <><small>{assetLabels[asset.kind as 'character' | 'location' | 'prop']}</small><h2>{asset.name}</h2><p>参考图生成</p><button onClick={() => navigateCreator('assetsHub', { targetKind: asset.kind as 'character' | 'location' | 'prop', targetId: asset.id, assetId: asset.id, shotId: undefined })}>返回资产</button></> : <><h2>镜头队列</h2>{shots.map((item) => <div className="generate-queue-row" key={item.id}><label className="queue-select"><input type="checkbox" aria-label={`选择镜头 ${item.name}`} checked={checkedShots.includes(item.id)} onChange={(event) => setCheckedShots(old => event.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))} /></label><button className="generate-queue-shot" aria-pressed={shot?.id === item.id} onClick={() => { select({ shotId: item.id, sceneId: item.sceneId, targetKind: undefined, targetId: undefined, assetId: undefined }); closeInspector() }}><strong>{item.plan?.shotNumber ? `镜头 ${String(item.plan.shotNumber).padStart(2, '0')}` : item.name}</strong><small>{item.description || '暂无描述'}</small><span>关键帧 {shotStatus(item, 'keyframe', entities, versions, ai.snapshot.tasks, allRuns.runs)} · 视频 {videoStatusWithReadiness(shotStatus(item, 'video', entities, versions, ai.snapshot.tasks, allRuns.runs), videoProfiles.length > 0)}</span></button></div>)}</>}</aside>
    <div className="generate-workspace">{!target ? <div className="generate-empty"><h2>{shots.length ? '选择一个镜头开始制作' : '还没有镜头，先做一张分镜'}</h2><p>{shots.length ? '从左侧镜头队列选择。生成后，先批准候选，再设为当前版本。' : '回到分镜，为剧本场次创建第一个镜头，然后继续生成。'}</p><button onClick={() => navigateCreator('storyboard')}>前往分镜 →</button></div> : <><div className="generate-target-head"><div><small>{asset ? '资产参考图' : '镜头制作'}</small><h2>{target.name}</h2></div>{shot && <button onClick={() => navigateCreator('storyboard', { shotId: shot.id, sceneId: shot.sceneId })}>查看分镜</button>}</div>
      {shot && <div className="generate-modes" role="tablist" aria-label="生成类型"><button role="tab" aria-selected={mode === 'keyframe'} onClick={() => { setModeChoice({ shotId: shot.id, mode: 'keyframe' }); setResolutionChoice(null); setDurationChoice(null) }}>关键帧</button><button role="tab" aria-selected={mode === 'video'} onClick={() => { setModeChoice({ shotId: shot.id, mode: 'video' }); setResolutionChoice(null); setDurationChoice(null) }}>镜头视频</button></div>}
      <section className="generate-description"><h3>{shot && mode === 'keyframe' ? '生成依据' : '生成描述'}</h3>{shot && mode === 'keyframe' ? <><dl className="generate-basis"><dt>画面</dt><dd>{shot.description || shot.plan?.action || '尚未填写'}</dd><dt>主体</dt><dd>{shot.plan?.subject || '尚未填写'}</dd><dt>镜头</dt><dd>{[shot.plan?.framing, shot.plan?.cameraMovement || shot.direction.cameraMovement].filter(Boolean).join(' · ') || '尚未设置'}</dd><dt>角色</dt><dd>{shot.characterIds.map((id) => entities.find((item) => item.id === id)?.name).filter(Boolean).join('、') || '未关联'}</dd><dt>场景</dt><dd>{entities.find((item) => item.id === shot.locationId)?.name || '未关联'}</dd><dt>参考</dt><dd>{references.length} 张已确认参考图</dd></dl><button onClick={() => navigateCreator('storyboard', { shotId: shot.id, sceneId: shot.sceneId })}>编辑分镜描述</button><small>根据分镜描述和已确认参考图制作；生成前可以核对。</small></> : <><p>{shot ? shot.videoPrompt || shot.direction.action || shot.plan?.action || shot.description || '当前镜头尚无视频生成描述。' : asset?.description || (asset?.kind === 'character' ? asset.appearance : '') || '依据现有角色、场景和道具设定整理生成描述。'}</p><small>想修改画面？返回分镜编辑描述。已确认版本始终保留。</small></>}</section>
      {shot && mode === 'video' && <div className="generate-video-type"><label><input type="radio" checked={videoType === 'image-to-video'} onChange={() => setVideoType('image-to-video')} />以确认关键帧为首帧</label><label><input type="radio" checked={videoType === 'text-to-video'} onChange={() => setVideoType('text-to-video')} />文生视频</label>{videoType === 'image-to-video' && !keyframe && <p role="status">请先确认镜头关键帧，或切换文生视频。</p>}</div>}
      <div className="generate-input-summary"><span>当前正式版本：{currentOfficial ? '已确认' : '尚未设置'}</span>{shot && <span>受控参考图：{references.length} 张</span>}{shot && mode === 'video' && <span>首帧：{keyframe ? '已确认关键帧' : '未就绪'}</span>}</div>
      {shot && mode === 'video' && !videoReady && <div className="generate-unavailable" role="status"><strong>尚未配置可用的视频生成工具</strong><p>当前镜头关键帧：{keyframe ? '已确认' : '未确认'}。分镜、关键帧和资产制作仍可使用。</p><div className="actions"><button onClick={() => { navigateCreator('settings'); setVideoDetails(false) }}>前往项目设置</button><button onClick={() => setVideoDetails(!videoDetails)} aria-expanded={videoDetails}>查看技术详情</button></div>{videoDetails && <p>Video Tools：0。当前版本尚未注册视频生成工具；Reference Video Protocol 仅用于测试验证，不是正式供应商。</p>}</div>}
      {(!shot || mode !== 'video' || videoReady) && <button className="primary" disabled={busy || workflow.busy || locked || !toolId || Boolean(shot && mode === 'video' && videoType === 'image-to-video' && !keyframe)} onClick={start}>{shot ? `开始生成 ${queueTargets.length} 个镜头` : '开始生成参考图'}</button>}
      <details className="generate-advanced" open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}><summary>高级设置</summary><div className="generate-advanced-fields">{mode === 'keyframe' && <label>路由<select value={routingMode} onChange={(e) => setRoutingMode(e.target.value as 'AUTO' | 'fixed')}><option value="AUTO">自动</option><option value="fixed">固定工具</option></select></label>}<label>工具<select value={toolId} onChange={(e) => { setToolChoice(e.target.value); setResolutionChoice(null) }}>{profiles.map((profile) => <option key={profile.toolId} value={profile.toolId}>{profile.displayName}</option>)}</select></label><label>宽<input type="number" min="16" value={resolution.width} onChange={(e) => setResolutionChoice({ ...resolution, width: Number(e.target.value) })} /></label><label>高<input type="number" min="16" value={resolution.height} onChange={(e) => setResolutionChoice({ ...resolution, height: Number(e.target.value) })} /></label>{shot && mode === 'video' && <><label>时长（秒）<input type="number" min="1" max="600" value={duration} onChange={(e) => setDurationChoice(Number(e.target.value))} /></label><label>FPS<input type="number" min="1" max="120" value={fps} onChange={(e) => setFps(Number(e.target.value))} /></label></>}<label><input type="checkbox" checked={allowUpload} onChange={(e) => setAllowUpload(e.target.checked)} />允许上传所选参考素材</label>{mode === 'keyframe' && <label><input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} />仅使用本地工具</label>}</div></details>
      {(error || visual.error || ai.error || workflow.error) && <div className="error" role="alert"><p>{creatorErrorMessage(error || visual.error || ai.error || workflow.error)}</p><details><summary>高级诊断</summary><p>{error || visual.error || ai.error || workflow.error}</p></details></div>}
      {!imageProfiles.length && !videoProfiles.length && <p className="error">尚未配置生成工具。请在项目设置中配置可用工具。</p>}
      {workflowPreview && <details className="generate-compiled"><summary>高级生成 · 实际编译 Prompt</summary><dl><dt>Prompt</dt><dd>{workflowPreview.prompt}</dd><dt>Negative Prompt</dt><dd>{workflowPreview.negativePrompt ?? '当前预览未返回'}</dd><dt>Compiler Version</dt><dd>{workflowPreview.compilerVersion ?? '当前预览未返回'}</dd><dt>Tool</dt><dd>{workflowPreview.tool}</dd><dt>Model</dt><dd>{workflowPreview.model}</dd><dt>References</dt><dd>{'referenceCount' in workflowPreview ? workflowPreview.referenceCount : workflowPreview.inputImageCount}</dd></dl></details>}
      {pendingUnknown && <div className="generate-unknown" role="alert"><p>请求已发出，但暂时无法确认远端任务状态。系统不会自动重试，以避免重复扣费。</p><button disabled={busy} onClick={refreshStatus}>刷新状态</button><details><summary>查看详情</summary><p>{directResult?.record.outcome || step?.errorSummary?.message || '请在验收与维护中查看原任务。'}</p></details></div>}
      {shot && run?.status === 'waiting-user' && workflowPreview?.id === dismissedPreviewId && <div className="generate-current-task"><p>确认已暂时关闭，原预览仍等待您的决定；未提交生成。</p><button onClick={() => setDismissedPreviewId('')}>继续确认</button><button disabled={busy || workflow.busy} onClick={() => void act(async () => { await workflow.act({ op: 'cancelWorkflowRun', projectId, runId: run.id }); setDismissedPreviewId('') })}>取消制作</button></div>}
      {run && <div className="generate-current-task" role={run.status === 'failed' ? 'alert' : 'status'}>当前制作：{pendingUnknown ? '需要处理' : run.status === 'succeeded' ? '已确认' : run.status === 'failed' && run.errorSummary && creatorErrorMessage(run.errorSummary.message).startsWith('服务不可用') ? '服务不可用' : creatorStatus(run.status)}{step?.relatedTaskId && <button onClick={refreshStatus} disabled={busy}>刷新状态</button>}{run.errorSummary && <p>{creatorErrorMessage(run.errorSummary.message)}</p>}</div>}
      {!shot && currentTask && <div className="generate-current-task" role="status">参考图任务：{currentTask.status === 'succeeded' ? '候选已生成' : currentTask.status === 'failed' ? '生成失败' : '生成中'} <button onClick={refreshStatus} disabled={busy}>刷新状态</button></div>}
      <section className="generate-results"><h3>当前版本与候选</h3>{currentOfficial && <div className="generate-official"><strong>{shot ? mode === 'keyframe' ? '当前镜头关键帧' : '当前镜头视频' : '当前主参考'}</strong><AssetImage projectId={projectId} versionId={currentOfficial.id} thumbnail={false} alt="当前正式版本" /></div>}{!currentCandidates.length ? <p>暂无当前目标的候选结果。生成完成后将在此审核。</p> : <><div className="generate-candidate-strip">{currentCandidates.map((v) => <button key={v.id} aria-pressed={candidate?.id === v.id} onClick={() => setSelectedVersionId(v.id)}><AssetImage projectId={projectId} versionId={v.id} alt={`候选 ${v.versionNumber}`} /><small>{v.status === 'approved' ? '已批准' : '等待选择'}</small></button>)}</div>{candidate && <div className="generate-candidate-main"><AssetImage projectId={projectId} versionId={candidate.id} thumbnail={false} alt="当前候选" /><p>候选 {candidate.versionNumber} · {candidate.status === 'approved' ? '已批准，等待采用' : '等待审核'}</p><div className="actions"><button onClick={() => setCompare((old) => old.includes(candidate.id) ? old.filter((id) => id !== candidate.id) : [...old.slice(-1), candidate.id])}>对比</button>{candidate.status === 'draft' && (!shot || step?.stepKey.startsWith('review-')) && <><button disabled={busy || workflow.busy} onClick={() => review(candidate, 'approve')}>批准</button><button disabled={busy || workflow.busy} onClick={() => review(candidate, 'reject')}>拒绝</button></>}{candidate.status === 'approved' && (!shot || step?.stepKey.startsWith('adopt-')) && <button className="primary" disabled={busy || workflow.busy} onClick={() => review(candidate, 'adopt')}>{asset ? '设为主参考' : mode === 'keyframe' ? '设为镜头关键帧' : '设为当前镜头视频'}</button>}</div><CandidateSource version={candidate} /></div>}{compare.length > 0 && <div className="generate-compare">{compare.map((id) => { const v = currentCandidates.find((item) => item.id === id); return v ? <figure key={id}><AssetImage projectId={projectId} versionId={id} thumbnail={false} alt={`对比候选 ${v.versionNumber}`} /><figcaption>候选 {v.versionNumber}</figcaption></figure> : null })}</div>}</>}{history.length > 0 && <details><summary>历史版本（{history.length}）</summary>{history.map((v) => <p key={v.id}>版本 {v.versionNumber} · {v.status === 'rejected' ? '已拒绝' : '旧版本'}</p>)}</details>}</section>
    </>}</div></div>
    {confirmation && <GenerationConfirm key={confirmation.id} preview={confirmation} testToolId={toolId} workflow={shot ? workflow.snapshot : null} busy={busy || workflow.busy} onCancel={() => { if (shot) { setDismissedPreviewId(confirmation.id); setError('已取消确认；流程仍等待用户，可稍后继续。') } else setPreview(null) }} onConfirm={confirm} />}
  </section>
}
