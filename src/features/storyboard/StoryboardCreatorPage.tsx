import { useEffect, useState } from 'react'
import type { Episode, Scene } from '../../shared/domain'
import { useCreator } from '../../components/creator-shell/creator-context'
import { useWorkspace } from '../workspace/state'
import { useVisual } from '../visual/use-visual'
import { useIntelligence } from '../script/use-intelligence'
import { useWorkflowRuns } from '../generate/use-workflow-runs'
import { videoCommand, videoProfilesSchema } from '../generate/generation-api'
import { AssetImage } from '../visual/AssetImage'
import { StoryboardPage } from '../workspace/pages'
import { orderedShots, officialVersion, shotCandidates, shotGroups, shotStatus, videoStatusWithReadiness } from './storyboard-model'
import './storyboard-creator.css'

export function StoryboardCreatorPage() {
  const { state, modal } = useWorkspace()
  const { sceneId: contextScene, shotId, select, navigateCreator } = useCreator()
  const projectId = state.workspace?.project.id
  const [episodeId, setEpisodeId] = useState('')
  const [sceneId, setSceneId] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [advanced, setAdvanced] = useState(false)
  if (!projectId) return <p className="empty">请先打开项目。</p>
  return <StoryboardWorkspace key={projectId} projectId={projectId} episodeId={episodeId} setEpisodeId={setEpisodeId} sceneId={sceneId} setSceneId={setSceneId} contextScene={contextScene} shotId={shotId} collapsed={collapsed} setCollapsed={setCollapsed} advanced={advanced} setAdvanced={setAdvanced} select={select} navigate={navigateCreator} create={modal} />
}

function StoryboardWorkspace({ projectId, episodeId, setEpisodeId, sceneId, setSceneId, contextScene, shotId, collapsed, setCollapsed, advanced, setAdvanced, select, navigate, create }: {
  projectId: string; episodeId: string; setEpisodeId: (id: string) => void; sceneId: string; setSceneId: (id: string) => void; contextScene?: string; shotId?: string
  collapsed: string[]; setCollapsed: (ids: string[]) => void; advanced: boolean; setAdvanced: (value: boolean) => void
  select: ReturnType<typeof useCreator>['select']; navigate: ReturnType<typeof useCreator>['navigateCreator']; create: ReturnType<typeof useWorkspace>['modal']
}) {
  const { state } = useWorkspace()
  const entities = state.workspace?.entities ?? []
  const visual = useVisual(projectId), ai = useIntelligence(projectId), workflows = useWorkflowRuns(projectId)
  const [videoReady, setVideoReady] = useState<boolean | null>(null)
  useEffect(() => { let active = true; void videoCommand({ op: 'profiles' }).then((result) => { if (active) setVideoReady(videoProfilesSchema.parse(result).length > 0) }).catch(() => { if (active) setVideoReady(false) }); return () => { active = false } }, [projectId])
  const episodes = entities.filter((e): e is Episode => e.kind === 'episode').toSorted((a, b) => a.order - b.order)
  const scenes = entities.filter((e): e is Scene => e.kind === 'scene').toSorted((a, b) => a.order - b.order)
  const context = scenes.find((scene) => scene.id === contextScene)
  const effectiveEpisode = episodeId === '__all__' ? '' : episodeId || context?.episodeId || ''
  const effectiveScene = sceneId === '__all__' ? '' : sceneId || (context?.episodeId === effectiveEpisode ? context.id : '')
  const shots = orderedShots(entities)
  const groups = shotGroups(entities).map((group) => ({ ...group, shots: group.shots.filter((shot) => (!effectiveEpisode || scenes.find((scene) => scene.id === shot.sceneId)?.episodeId === effectiveEpisode) && (!effectiveScene || shot.sceneId === effectiveScene)) })).filter((group) => group.shots.length)
  const versions = visual.snapshot?.versions ?? []
  return <section className="storyboard-creator" aria-label="分镜工作区">
    <div className="page-heading"><div><h1>分镜</h1><p>按故事顺序查看镜头；正式关键帧只显示已确认版本。</p></div><button className="primary" onClick={() => create({ type: 'entity', kind: 'shot' })}>新增镜头</button></div>
    <div className="storyboard-toolbar"><label>分集<select aria-label="筛选分集" value={effectiveEpisode} onChange={(e) => { setEpisodeId(e.target.value || '__all__'); setSceneId('__all__') }}><option value="">全部分集</option>{episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.name}</option>)}</select></label><label>场次<select aria-label="筛选场次" value={effectiveScene} onChange={(e) => setSceneId(e.target.value || '__all__')}><option value="">全部场次</option>{scenes.filter((scene) => !effectiveEpisode || scene.episodeId === effectiveEpisode).map((scene) => <option key={scene.id} value={scene.id}>{scene.content.heading || scene.name}</option>)}</select></label><button onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>更多操作</button></div>
    {advanced && <section className="storyboard-advanced"><p>智能拆解、批量关键帧与旧版镜头记录保留在此入口。镜头编辑、场内排序和安全删除可在当前镜头检查器操作。</p><StoryboardPage /></section>}
    {(visual.error || ai.error || workflows.error) && <p role="alert" className="error">{visual.error || ai.error || workflows.error}</p>}
    {!shots.length ? <div className="storyboard-empty"><h2>还没有分镜</h2><p>可以先从剧本确认镜头计划，或新增第一个镜头。</p><button onClick={() => navigate('scripts')}>从剧本创建分镜</button><button className="primary" onClick={() => create({ type: 'entity', kind: 'shot' })}>新增第一个镜头</button></div> : !groups.length ? <p className="empty">当前范围没有镜头。</p> : groups.map((group) => <div key={group.scene?.id ?? 'continuous'} className="storyboard-group">{shots.length > 30 && <button className="storyboard-group-head" aria-expanded={!collapsed.includes(group.scene?.id ?? '')} onClick={() => setCollapsed(collapsed.includes(group.scene?.id ?? '') ? collapsed.filter((id) => id !== group.scene?.id) : [...collapsed, group.scene?.id ?? ''])}>{group.scene?.content.heading || group.scene?.name || '未命名场次'} <small>{group.shots.length} 镜头</small></button>}{!collapsed.includes(group.scene?.id ?? '') && <div className="storyboard-shot-grid">{group.shots.map((shot) => {
      const official = officialVersion(shot, 'keyframe', entities, versions)
      const candidate = shotCandidates(shot, 'keyframe', versions, ai.snapshot.tasks).find((v) => v.status === 'draft' || v.status === 'approved')
      const preview = official ?? candidate
      const keyframe = shotStatus(shot, 'keyframe', entities, versions, ai.snapshot.tasks, workflows.runs)
      const videoStatus = shotStatus(shot, 'video', entities, versions, ai.snapshot.tasks, workflows.runs)
      const video = videoReady === null ? videoStatus : videoStatusWithReadiness(videoStatus, videoReady)
      return <button key={shot.id} className="storyboard-shot-card" aria-pressed={shot.id === shotId} onClick={() => select({ shotId: shot.id, sceneId: shot.sceneId, assetId: undefined, targetId: undefined, targetKind: undefined })}><div className="storyboard-shot-image">{preview ? <AssetImage projectId={projectId} versionId={preview.id} alt={official ? `${shot.name}正式关键帧` : `${shot.name}候选预览`} /> : <span>镜头 {String(shots.indexOf(shot) + 1).padStart(2, '0')}</span>}{preview && !official && <small className="storyboard-candidate-mark">候选</small>}</div><div className="storyboard-shot-info"><strong>{shot.plan?.shotNumber ? `Shot ${String(shot.plan.shotNumber).padStart(2, '0')}` : shot.name}</strong><span>{shot.durationSeconds}s</span><p>{shot.description || shot.plan?.action || '暂无画面描述'}</p><small>{shot.plan?.framing || shot.plan?.shotType || '景别待定'} · {shot.plan?.cameraMovement || shot.direction.cameraMovement || '运镜待定'}</small><small>{shot.characterIds.map((id) => entities.find((e) => e.id === id)?.name).filter(Boolean).join(' / ') || '人物待定'}</small><div><span className="creator-status" data-status={keyframe}>关键帧 {keyframe}</span><span>视频 {video}</span></div></div></button>
    })}</div>}</div>)}
  </section>
}
