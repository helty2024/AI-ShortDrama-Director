import { useState } from 'react'
import type { Shot } from '../../shared/domain'
import { useCreator } from '../../components/creator-shell/creator-context'
import { useWorkspace } from '../workspace/state'
import { useVisual } from '../visual/use-visual'
import { useIntelligence } from '../script/use-intelligence'
import { AssetImage } from '../visual/AssetImage'
import { officialVersion, orderedShots } from './storyboard-model'

export function StoryboardInspector({ shot }: { shot: Shot }) {
  const { state } = useWorkspace()
  const { navigateCreator, select } = useCreator()
  const { reload } = useWorkspace()
  const ai = useIntelligence(shot.projectId)
  const [actionError, setActionError] = useState('')
  const entities = state.workspace?.entities ?? []
  const visual = useVisual(shot.projectId)
  const version = officialVersion(shot, 'keyframe', entities, visual.snapshot?.versions ?? [])
  const scene = entities.find((e) => e.id === shot.sceneId)
  const lookup = (id: string) => entities.find((e) => e.id === id)?.name ?? '未找到'
  const sceneShots = orderedShots(entities).filter((item) => item.sceneId === shot.sceneId)
  const position = sceneShots.findIndex((item) => item.id === shot.id)
  const reorder = async (delta: -1 | 1) => {
    if (scene?.kind !== 'scene' || position + delta < 0 || position + delta >= sceneShots.length) return
    const ids = sceneShots.map((item) => item.id)
    ;[ids[position], ids[position + delta]] = [ids[position + delta]!, ids[position]!]
    try { await ai.execute({ operation: 'shots.reorder', projectId: shot.projectId, id: scene.id, expectedRevision: scene.revision, shotIds: ids }); await reload() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : '排序失败') }
  }
  const remove = async () => {
    if (!window.confirm(`删除镜头“${shot.name}”？已有生产记录的镜头不能删除。`)) return
    try { await ai.execute({ operation: 'shot.delete', projectId: shot.projectId, id: shot.id, expectedRevision: shot.revision }); select({ shotId: undefined }); await reload() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : '删除失败') }
  }
  return <div className="storyboard-inspector"><dl className="creator-inspector-facts"><dt>镜头编号</dt><dd>{shot.plan?.shotNumber ? `Shot ${String(shot.plan.shotNumber).padStart(2, '0')}` : shot.name}</dd><dt>时长</dt><dd>{shot.durationSeconds} 秒</dd><dt>场次</dt><dd>{scene?.name ?? '未找到'}</dd><dt>人物</dt><dd>{shot.characterIds.map(lookup).join('、') || '未关联'}</dd><dt>场景</dt><dd>{shot.locationId ? lookup(shot.locationId) : '未关联'}</dd><dt>道具</dt><dd>{shot.propIds.map(lookup).join('、') || '未关联'}</dd><dt>景别</dt><dd>{shot.plan?.framing || '未设置'}</dd><dt>运镜</dt><dd>{shot.plan?.cameraMovement || shot.direction.cameraMovement || '未设置'}</dd></dl><ShotDescriptionEditor key={`${shot.id}:${shot.revision}`} shot={shot} /><h3>镜头顺序</h3><div className="storyboard-shot-actions"><button disabled={ai.busy || position <= 0} onClick={() => void reorder(-1)}>上移</button><button disabled={ai.busy || position >= sceneShots.length - 1} onClick={() => void reorder(1)}>下移</button><button disabled={ai.busy} onClick={() => void remove()}>删除镜头</button></div>{actionError && <p role="alert">{actionError}</p>}<h3>当前关键帧</h3>{version ? <><AssetImage projectId={shot.projectId} versionId={version.id} alt="正式镜头关键帧" /><p>已确认</p></> : <p>{shot.approvedKeyframeVersionId ? '关键帧暂不可用' : '尚未确认关键帧'}</p>}<h3>镜头视频</h3><p>{shot.confirmedVideoAssetVersionId ? '已设置当前镜头视频' : '尚未确认镜头视频'}</p><button className="primary" onClick={() => navigateCreator('generation', { shotId: shot.id, sceneId: shot.sceneId, targetId: undefined, targetKind: undefined, assetId: undefined })}>去生成</button></div>
}

function ShotDescriptionEditor({ shot }: { shot: Shot }) {
  const { reload } = useWorkspace()
  const ai = useIntelligence(shot.projectId)
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(shot.description)
  const [subject, setSubject] = useState(shot.plan?.subject ?? '')
  const [action, setAction] = useState(shot.plan?.action ?? '')
  const [emotion, setEmotion] = useState(shot.plan?.emotion ?? '')
  const [framing, setFraming] = useState(shot.plan?.framing ?? '')
  const [camera, setCamera] = useState(shot.plan?.cameraMovement ?? '')
  const [error, setError] = useState('')
  const save = async () => {
    try {
      const plan = shot.plan ?? {
        shotNumber: shot.order + 1, shotType: '', framing: '', cameraAngle: '', cameraMovement: '', focalLengthSuggestion: '',
        subject: '', action: '', emotion: '', durationSuggestion: shot.durationSeconds, characterRefs: shot.characterIds,
        locationRef: shot.locationId, propRefs: shot.propIds, continuityNotes: '',
      }
      await ai.execute({ operation: 'shot.save', projectId: shot.projectId, id: shot.id, expectedRevision: shot.revision,
        description, plan: { ...plan, subject, action, emotion, framing, cameraMovement: camera } })
      await reload()
      setEditing(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
  }
  return <section><h3>画面描述与镜头计划</h3>{editing ? <div className="storyboard-shot-editor"><label>画面描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>主体<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label><label>动作<textarea value={action} onChange={(event) => setAction(event.target.value)} /></label><label>情绪<input value={emotion} onChange={(event) => setEmotion(event.target.value)} /></label><label>景别<input value={framing} onChange={(event) => setFraming(event.target.value)} /></label><label>运镜<input value={camera} onChange={(event) => setCamera(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<button disabled={ai.busy} onClick={() => setEditing(false)}>取消</button><button className="primary" disabled={ai.busy} onClick={() => void save()}>保存镜头</button></div> : <><p>{shot.description || shot.plan?.action || '尚未填写'}</p><button onClick={() => setEditing(true)}>编辑分镜描述</button></>}</section>
}
