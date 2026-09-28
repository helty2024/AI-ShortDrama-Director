import type { Asset, Entity, Episode, Scene, Shot } from '../../shared/domain.js'
import type { AITask } from '../../shared/intelligence.js'
import type { AssetVersion } from '../../shared/visual.js'
import type { WorkflowRun } from '../../shared/workflow.js'
import type { CreatorStatus } from '../../components/creator-shell/status.js'

export interface ShotGroup { scene: Scene | undefined; shots: Shot[] }

export function orderedShots(entities: Entity[]): Shot[] {
  const episodes = new Map(entities.filter((e): e is Episode => e.kind === 'episode').map((e) => [e.id, e]))
  const scenes = new Map(entities.filter((e): e is Scene => e.kind === 'scene').map((e) => [e.id, e]))
  return entities.filter((e): e is Shot => e.kind === 'shot').toSorted((a, b) => {
    const sa = scenes.get(a.sceneId), sb = scenes.get(b.sceneId)
    const ea = sa && episodes.get(sa.episodeId), eb = sb && episodes.get(sb.episodeId)
    return (ea?.order ?? 0) - (eb?.order ?? 0) || (sa?.order ?? 0) - (sb?.order ?? 0) || a.order - b.order || a.createdAt.localeCompare(b.createdAt)
  })
}

export function shotGroups(entities: Entity[]): ShotGroup[] {
  const shots = orderedShots(entities)
  if (shots.length <= 30) return [{ scene: undefined, shots }]
  const scenes = new Map(entities.filter((e): e is Scene => e.kind === 'scene').map((e) => [e.id, e]))
  const groups: ShotGroup[] = []
  for (const shot of shots) {
    const previous = groups.at(-1)
    if (previous?.scene?.id === shot.sceneId) previous.shots.push(shot)
    else groups.push({ scene: scenes.get(shot.sceneId), shots: [shot] })
  }
  return groups
}

export function officialVersion(shot: Shot, kind: 'keyframe' | 'video', entities: Entity[], versions: AssetVersion[]) {
  const assetId = kind === 'keyframe' ? shot.approvedKeyframeAssetId : shot.confirmedVideoAssetId
  const versionId = kind === 'keyframe' ? shot.approvedKeyframeVersionId : shot.confirmedVideoAssetVersionId
  const asset = entities.find((e): e is Asset => e.kind === 'asset' && e.id === assetId)
  return asset && versionId
    ? versions.find((v) => v.id === versionId && v.assetId === asset.id && (kind === 'keyframe' ? v.mimeType.startsWith('image/') : v.mimeType === 'video/mp4'))
    : undefined
}

export function shotCandidates(shot: Shot, kind: 'keyframe' | 'video', versions: AssetVersion[], tasks: AITask[]) {
  const outputs = new Set(tasks.filter((task) => 'targetId' in task.input && task.input.targetId === shot.id).flatMap((task) => task.resultIds))
  return versions.filter((v) => (v.metadata.targetId === shot.id || outputs.has(v.id)) &&
    (kind === 'keyframe' ? v.mimeType.startsWith('image/') : v.mimeType === 'video/mp4'))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.versionNumber - a.versionNumber)
}

export function shotStatus(shot: Shot, kind: 'keyframe' | 'video', entities: Entity[], versions: AssetVersion[], tasks: AITask[], runs: WorkflowRun[]): CreatorStatus {
  const relatedRuns = runs.filter((r) => r.targetObjectId === shot.id && r.workflowType === (kind === 'keyframe' ? 'shot-keyframe' : 'shot-video'))
  const relatedTasks = tasks.filter((task) => 'targetId' in task.input && task.input.targetId === shot.id &&
    (kind === 'keyframe' ? task.input.type === 'image-api' || task.input.type === 'shot-keyframe' : task.input.type === 'video-api'))
  const currentRun = relatedRuns[0]
  const candidates = shotCandidates(shot, kind, versions, relatedTasks)
  if (currentRun?.status === 'failed' || relatedTasks[0]?.status === 'failed') return '失败'
  if (currentRun?.status === 'running' || currentRun?.status === 'pending' || relatedTasks.some((t) => t.status === 'running' || t.status === 'queued')) return '生成中'
  if (currentRun?.status === 'waiting-user') return '等待用户'
  if (candidates.some((v) => v.status === 'draft' || v.status === 'approved') && !officialVersion(shot, kind, entities, versions)) return '待审核'
  if (officialVersion(shot, kind, entities, versions)) return '已确认'
  if ((kind === 'keyframe' && shot.approvedKeyframeVersionId) || (kind === 'video' && shot.confirmedVideoAssetVersionId)) return '不可用'
  if (kind === 'video' && officialVersion(shot, 'keyframe', entities, versions)) return '准备就绪'
  return '待生成'
}

export function videoStatusWithReadiness(status: CreatorStatus, ready: boolean): CreatorStatus {
  return ready || status === '已确认' || status === '待审核' || status === '生成中' || status === '等待用户' ? status : '不可用'
}

export function approvedShotReferences(shot: Shot, entities: Entity[], versions: AssetVersion[], previous?: Shot) {
  const ids = [...shot.characterIds, shot.locationId, ...shot.propIds].filter((id): id is string => Boolean(id))
  const refs = ids.flatMap((id) => {
    const target = entities.find((e) => e.id === id)
    if (!target || !('visualReferences' in target)) return []
    const primary = target.visualReferences.find((ref) => ref.primary)
    const asset = entities.find((e): e is Asset => e.kind === 'asset' && e.id === primary?.assetId)
    return asset?.approvedVersionId ? versions.filter((v) => v.id === asset.approvedVersionId && v.assetId === asset.id && v.status === 'approved' && v.mimeType.startsWith('image/')) : []
  })
  const prior = previous ? officialVersion(previous, 'keyframe', entities, versions) : undefined
  return [...new Map([...refs, ...(prior ? [prior] : [])].map((v) => [v.id, v])).values()].slice(0, 8)
}
