import { useEffect, useRef, useState } from 'react'
import type { AssetVersion, } from '../../shared/visual'
import type { Shot } from '../../shared/domain'
import { useCreator } from '../../components/creator-shell/creator-context'
import { useToast } from '../../components/creator-shell/toast-context'
import { useWorkspace } from '../workspace/state'
import { useVisual } from '../visual/use-visual'
import { useIntelligence } from '../script/use-intelligence'
import { useWorkflowRuns } from '../generate/use-workflow-runs'
import { reviewCreatorCandidate } from '../generate/candidate-actions'
import type { CandidateAction } from '../generate/candidate-actions'
import { CandidateSource } from '../generate/GenerationSource'
import { orderedShots, shotStatus } from '../storyboard/storyboard-model'
import { AssetImage } from '../visual/AssetImage'
import { shotVideoThumbnail, shotVideoView } from './shot-video-model'
import { ShotVideoPlayer } from './ShotVideoPlayer'
import './shot-videos-creator.css'

function shotLabel(shot: Shot, index: number) { return `Shot ${String(shot.plan?.shotNumber ?? index + 1).padStart(2, '0')}` }
function versionState(version: AssetVersion, confirmedId: string | null) {
  return version.id === confirmedId ? '已确认' : version.status === 'approved' ? '准备就绪' : '待审核'
}

export function ShotVideosCreatorPage() {
  const { state } = useWorkspace()
  const projectId = state.workspace?.project.id
  if (!projectId) return <p className="empty">请先打开项目。</p>
  return <ShotVideosWorkspace key={projectId} projectId={projectId} />
}

function ShotVideosWorkspace({ projectId }: { projectId: string }) {
  const { state, reload } = useWorkspace()
  const creator = useCreator()
  const toast = useToast()
  const visual = useVisual(projectId), ai = useIntelligence(projectId), workflows = useWorkflowRuns(projectId)
  const entities = state.workspace?.entities ?? []
  const versions = visual.snapshot?.versions ?? []
  const shots = orderedShots(entities)
  const shot = shots.find((item) => item.id === creator.shotId) ?? shots[0]
  const visibleShotId = useRef(shot?.id)
  useEffect(() => { visibleShotId.current = shot?.id }, [shot?.id])
  const [previewId, setPreviewId] = useState('')
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [showSource, setShowSource] = useState(false)
  useEffect(() => {
    if (shot && creator.shotId !== shot.id) creator.select({ shotId: shot.id, sceneId: shot.sceneId, targetKind: undefined, targetId: undefined, assetId: undefined, candidateId: undefined })
  }, [shot, creator])
  const view = shot ? shotVideoView(shot, entities, versions, ai.snapshot.tasks) : null
  const candidates = view?.candidates ?? []
  const preview = candidates.find((version) => version.id === previewId)
  const playerVersion = preview ?? view?.confirmed
  const status = (item: Shot) => {
    const itemView = shotVideoView(item, entities, versions, ai.snapshot.tasks)
    const current = shotStatus(item, 'video', entities, versions, ai.snapshot.tasks, workflows.runs)
    return itemView.confirmed ? '已确认' : itemView.bindingBroken ? '不可用' : current === '准备就绪' ? '待生成' : current
  }
  const chooseShot = (item: Shot) => {
    visibleShotId.current = item.id
    setPreviewId(''); setShowSource(false); setError('')
    creator.select({ shotId: item.id, sceneId: item.sceneId, targetKind: undefined, targetId: undefined, assetId: undefined, candidateId: undefined })
  }
  const toGenerate = () => shot && creator.navigateCreator('generation', { shotId: shot.id, sceneId: shot.sceneId, generationMode: 'video', targetKind: undefined, targetId: undefined, assetId: undefined })
  const toStoryboard = () => shot && creator.navigateCreator('storyboard', { shotId: shot.id, sceneId: shot.sceneId })
  const act = async (version: AssetVersion, action: CandidateAction) => {
    if (!shot || busyId) return
    const target = shot
    setBusyId(version.id); setError('')
    try {
      await reviewCreatorCandidate({ projectId, target, version, action, runs: workflows.runs, tasks: ai.snapshot.tasks })
      await Promise.all([reload(), visual.refresh(), ai.refresh()])
      if (action === 'adopt') { if (visibleShotId.current === target.id) setPreviewId(''); toast('success', '已设为当前镜头视频') }
      else toast('success', action === 'approve' ? '候选已批准，尚未采用' : '候选已拒绝，历史仍保留')
    } catch (cause) { if (visibleShotId.current === target.id) setError(cause instanceof Error ? cause.message : '操作失败，请刷新后重试') }
    finally { setBusyId('') }
  }
  return <section className="shot-videos-creator" aria-label="分镜视频工作区">
    <header className="page-heading shot-videos-heading"><div><small>CREATOR / SHOT VIDEOS</small><h1>分镜视频</h1><p>沿着故事顺序审看镜头，批准候选后再明确采用。</p></div><span className="creator-status">{shots.filter((item) => shotVideoView(item, entities, versions, ai.snapshot.tasks).confirmed).length} / {shots.length} 已确认</span></header>
    {(visual.error || ai.error || workflows.error || error) && <p role="alert" className="error">{error || visual.error || ai.error || workflows.error}</p>}
    {!shot ? <div className="shot-videos-empty"><h2>还没有分镜视频</h2><p>先在“分镜”中创建镜头。</p><button className="primary" onClick={() => creator.navigateCreator('storyboard')}>前往分镜</button></div> : <>
      <div className="shot-videos-layout">
        <aside className="shot-videos-list" aria-label="镜头视频列表"><div className="shot-videos-list-head"><h2>镜头序列</h2><small>{shots.length} SHOTS</small></div>{shots.map((item, index) => <button key={item.id} className="shot-videos-list-item" aria-pressed={shot.id === item.id} onClick={() => chooseShot(item)}><span className="shot-videos-number">{shotLabel(item, index)}</span><strong>{item.description || item.plan?.action || item.name}</strong><small>{item.durationSeconds}s <span className="creator-status" data-status={status(item)}>{status(item)}</span></small></button>)}</aside>
        <div className="shot-videos-main"><div className="shot-videos-main-head"><div><small>当前镜头 / {shotLabel(shot, shots.indexOf(shot))}</small><h2>{shot.description || shot.plan?.action || shot.name}</h2></div><div className="actions"><button onClick={toStoryboard}>查看分镜</button><button onClick={toGenerate}>去生成</button></div></div>
          <section className="shot-videos-screen" aria-label="镜头视频播放器"><div className="shot-videos-screen-top"><span>{preview ? '候选预览 · 尚未采用' : view?.confirmed ? '当前确认视频' : '当前镜头视频'}</span><span>{playerVersion ? `${playerVersion.width} × ${playerVersion.height}` : state.workspace?.project.aspectRatio}</span></div>
            {playerVersion ? <ShotVideoPlayer key={`${shot.id}:${playerVersion.id}`} version={playerVersion} label={preview ? '候选视频' : '当前确认视频'} onSource={() => setShowSource(true)} /> : <div className="shot-videos-screen-empty"><span>▶</span><strong>{view?.bindingBroken ? '当前确认视频不可用' : '尚未确认当前镜头视频'}</strong><p>{view?.bindingBroken ? '原绑定的版本无法解析；不会自动使用候选替代。' : '当前还没有确认的视频。生成并批准候选后，可将其设为当前镜头视频。'}</p><button onClick={toGenerate}>前往生成</button></div>}
            {view?.confirmed && preview && <button className="shot-videos-return" onClick={() => setPreviewId('')}>返回当前确认视频</button>}
          </section>
          {playerVersion && showSource && <div className="shot-videos-source"><button onClick={() => setShowSource(false)}>收起来源</button><CandidateSource key={playerVersion.id} version={playerVersion} /></div>}
          {view?.confirmed && !preview && <details className="shot-videos-confirmed-source"><summary>当前视频来源</summary><CandidateSource key={view.confirmed.id} version={view.confirmed} /></details>}
          <section className="shot-videos-candidates" aria-label="当前镜头视频候选"><div className="shot-videos-section-head"><h3>当前镜头视频候选</h3><span>{candidates.length} 个候选</span></div>{!candidates.length ? <p>暂无可审核候选。{view?.confirmed ? '当前视频仍可审看。' : '可前往生成，制作新的镜头视频。'}</p> : <div className="shot-videos-candidate-strip">{candidates.map((version, index) => <article key={version.id} className="shot-videos-candidate" data-version-id={version.id} data-primary={index < 2} data-active={preview?.id === version.id}><button className="shot-videos-candidate-pick" aria-pressed={preview?.id === version.id} onClick={() => { setPreviewId(version.id); setShowSource(false) }}><AssetImage projectId={projectId} versionId={version.id} alt={`候选 ${index + 1} 缩略图`} /><span>候选 {index + 1} <em>{versionState(version, shot.confirmedVideoAssetVersionId)}</em></span></button><small>{version.duration ?? '—'}s · {version.width}×{version.height}</small><div className="actions">{version.status === 'draft' && <><button disabled={Boolean(busyId)} onClick={() => void act(version, 'approve')}>批准</button><button disabled={Boolean(busyId)} onClick={() => void act(version, 'reject')}>拒绝</button></>}{version.status === 'approved' && <button className="primary" disabled={Boolean(busyId)} onClick={() => void act(version, 'adopt')}>设为当前镜头视频</button>}</div><details><summary>查看来源</summary><CandidateSource key={version.id} version={version} /></details></article>)}</div>}</section>
          {view && view.history.length > 0 && <details className="shot-videos-history"><summary>历史版本（{view.history.length}）</summary>{view.history.map((version) => <p key={version.id}>版本 {version.versionNumber} · {version.status === 'rejected' ? '已拒绝' : '旧版本'} · {new Date(version.createdAt).toLocaleString('zh-CN')}</p>)}</details>}
        </div>
      </div>
      <section className="shot-videos-sequence" aria-label="镜头顺序条"><div className="shot-videos-section-head"><h3>镜头顺序</h3><span>按分镜顺序浏览 · 在分镜中调整排序</span></div><div className="shot-videos-sequence-scroll">{shots.map((item, index) => { const thumb = shotVideoThumbnail(item, entities, versions, ai.snapshot.tasks); return <button key={item.id} aria-pressed={shot.id === item.id} onClick={() => chooseShot(item)}><div className="shot-videos-sequence-thumb">{thumb.version ? <AssetImage projectId={projectId} versionId={thumb.version.id} alt={`${shotLabel(item, index)} 缩略图`} /> : <span>▶</span>}{thumb.candidate && <em>候选</em>}</div><strong>{shotLabel(item, index)}</strong><small>{item.durationSeconds}s · {status(item)}</small></button> })}</div></section>
    </>}
  </section>
}
