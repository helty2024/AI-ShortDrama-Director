import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workflowRunSchema, workflowSnapshotSchema, type WorkflowRun, type WorkflowSnapshot, type WorkflowCommand } from '../../shared/workflow'
import { assetVersionSchema, type AssetVersion } from '../../shared/visual'
import { useWorkspace } from '../workspace/state'
import { AssetImage } from '../visual/AssetImage'
import { workflowCommand } from './api'

const names = { pending: '待开始', running: '执行中', 'waiting-user': '等待确认', succeeded: '已完成', failed: '失败', skipped: '已跳过', cancelled: '已取消' }
const stepNames = { prepare: '准备', 'generate-image': '生成关键帧', 'review-image': '审核关键帧', 'adopt-image': '采用关键帧', 'generate-video': '生成视频', 'review-video': '审核视频', 'adopt-video': '采用视频', complete: '完成' }
export function WorkflowPanel() {
  const { state } = useWorkspace()
  return state.workspace ? <WorkflowSession key={state.workspace.project.id} projectId={state.workspace.project.id} /> : null
}
function WorkflowSession({ projectId }: { projectId: string }) {
  const { state, reload } = useWorkspace()
  const [runs, setRuns] = useState<WorkflowRun[]>([]), [selected, setSelected] = useState('')
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null), [versions, setVersions] = useState<AssetVersion[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const operating = useRef(false)
  useEffect(() => {
    let active = true, fetching = false
    const refresh = async () => {
      if (fetching || operating.current) return
      fetching = true
      try {
        const list = z.array(workflowRunSchema).parse(await workflowCommand({ op: 'listWorkflowRuns', projectId }))
        const id = selected || list[0]?.id
        const next = id ? workflowSnapshotSchema.parse(await workflowCommand({ op: 'getWorkflowRun', projectId, runId: id })) : null
        const media = await window.desktop!.workspace.request({ action: 'visual', command: { operation: 'snapshot', projectId } })
        if (active && !operating.current) {
          setRuns(list); setSnapshot(next)
          if (media.ok) setVersions(z.object({ versions: z.array(assetVersionSchema) }).parse(media.data).versions)
        }
      } catch (raw) { if (active) setError(raw instanceof Error ? raw.message : '读取流程失败') }
      finally { fetching = false }
    }
    const created = (event: Event) => { if (event instanceof CustomEvent && typeof event.detail === 'string') setSelected(event.detail); void refresh() }
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    window.addEventListener('director-workflow-created', created)
    return () => { active = false; clearInterval(timer); window.removeEventListener('director-workflow-created', created) }
  }, [projectId, selected])
  const act = async (command: WorkflowCommand) => {
    operating.current = true
    setBusy(true); setError('')
    try {
      const next = workflowSnapshotSchema.parse(await workflowCommand(command))
      const media = await window.desktop!.workspace.request({ action: 'visual', command: { operation: 'snapshot', projectId } })
      if (!media.ok) throw new Error(media.message)
      await reload()
      setVersions(z.object({ versions: z.array(assetVersionSchema) }).parse(media.data).versions)
      setSnapshot(next)
    }
    catch (raw) { setError(raw instanceof Error ? raw.message : '操作失败') }
    finally { operating.current = false; setBusy(false) }
  }
  const run = snapshot?.run, current = snapshot?.steps.find((s) => s.stepKey === run?.currentStepKey)
  const candidate = versions.find((v) => v.id === current?.relatedAssetVersionId)
  const target = state.workspace?.entities.find((e) => e.id === run?.targetObjectId)
  const stopped = run && ['succeeded', 'failed', 'cancelled'].includes(run.status)
  return <section aria-label="制作工作流">
    <h2>制作工作流</h2>
    <p>在下方图像或视频表单中选择 Shot 并创建工作流。生成前确认费用，候选需审核和采用后才正式绑定。</p>
    <label>历史流程<select aria-label="选择工作流" value={selected || runs[0]?.id || ''} onChange={(e) => setSelected(e.target.value)}>
      {!runs.length && <option value="">暂无流程</option>}
      {runs.map((r) => <option key={r.id} value={r.id}>{r.workflowType === 'shot-keyframe' ? '关键帧' : '视频'} · {state.workspace?.entities.find((e) => e.id === r.targetObjectId)?.name ?? r.targetObjectId} · {names[r.status]}</option>)}
    </select></label>
    {snapshot && run && <div>
      <p role="status">流程状态：{names[run.status]} · {stepNames[run.currentStepKey]}</p>
      {!run.executionAllowed && <p>备份历史，仅可查看。</p>}
      <ol>{snapshot.steps.map((s) => <li key={s.id}>{stepNames[s.stepType]}：{names[s.status]}
        {s.relatedTaskId && <details><summary>生产记录</summary><p>Task：{s.relatedTaskId}</p><p>GenerationRecord：{s.relatedGenerationRecordId}</p><p>AssetVersion：{s.relatedAssetVersionId ?? '尚未产生'}</p></details>}
        {s.errorSummary && <p>{s.errorSummary.message}</p>}
      </li>)}</ol>
      {!stopped && run.executionAllowed && <>
        <button disabled={busy} onClick={() => void act({ op: 'resumeWorkflowRun', projectId, runId: run.id })}>恢复 / 继续流程</button>
        <button disabled={busy} onClick={() => void act({ op: 'cancelWorkflowRun', projectId, runId: run.id })}>取消流程（停止后续步骤）</button>
      </>}
      {run.executionAllowed && run.status === 'waiting-user' && current?.outputSnapshot.preview && !current.relatedTaskId &&
        <WorkflowConfirmation key={current.outputSnapshot.preview.id} snapshot={snapshot} busy={busy} act={act} />}
      {run.executionAllowed && run.status === 'waiting-user' && candidate && target && <div>
        <AssetImage projectId={projectId} versionId={candidate.id} thumbnail={false} alt="工作流候选" />
        <p>候选 v{candidate.versionNumber} · {candidate.status}</p>
        {(current!.stepKey.startsWith('review-') ? ['approve-candidate', 'reject-candidate'] as const : ['adopt-candidate'] as const).map((action) =>
          <button key={action} disabled={busy} onClick={() => void act({ op: 'submitWorkflowUserDecision', projectId, runId: run.id, expectedRevision: run.revision,
            decision: { action, versionId: candidate.id, versionRevision: candidate.revision, targetRevision: target.revision } })}>
            {action === 'approve-candidate' ? '批准候选（尚不绑定）' : action === 'reject-candidate' ? '拒绝候选并结束' : '采用到 Shot'}
          </button>)}
      </div>}
      {run.resultSummary.reason && <p>{run.resultSummary.reason}</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>
}
function WorkflowConfirmation({ snapshot, busy, act }: { snapshot: WorkflowSnapshot; busy: boolean; act: (command: WorkflowCommand) => Promise<void> }) {
  const step = snapshot.steps.find((s) => s.stepKey === snapshot.run.currentStepKey)!, preview = step.outputSnapshot.preview!
  const knownFree = 'knownFree' in preview && preview.knownFree
  const [amount, setAmount] = useState(''), [confirmed, setConfirmed] = useState(false), [unknown, setUnknown] = useState(false)
  return <fieldset disabled={busy}>
    <legend>工作流生成确认</legend>
    <p>{preview.tool} / {preview.model} · {preview.resolution.width}×{preview.resolution.height}</p>
    <p>{preview.prompt}</p><p>{preview.disclosure}</p><p>{preview.estimate} · {preview.currency} · 有效至 {preview.expiresAt}</p>
    {!knownFree && <>
      <label>工作流费用上限（micro {preview.currency}）<input type="number" min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label><input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} />允许未知估价（仍受上述预算上限约束）</label>
    </>}
    <label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我确认本次执行及费用授权</label>
    <button disabled={!confirmed || (!knownFree && amount === '')} onClick={() => void act({ op: 'submitWorkflowUserDecision', projectId: snapshot.run.projectId,
      runId: snapshot.run.id, expectedRevision: snapshot.run.revision, decision: { action: 'confirm-generation', previewId: preview.id,
        maxCostMicro: knownFree ? 0 : Number(amount), allowUnknownCost: knownFree ? false : unknown } })}>确认工作流生成</button>
  </fieldset>
}
