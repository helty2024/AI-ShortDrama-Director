import type { Shot, Entity } from '../../shared/domain.js'
import type { AITask } from '../../shared/intelligence.js'
import type { AssetVersion } from '../../shared/visual.js'
import { officialVersion } from '../storyboard/storyboard-model.js'
import { videoTimelineClipSchema, type VideoTimelineClip } from '../../shared/video-batch.js'

// One most-recent version per removed shot, bounded to one timeline's capacity.
export function rememberRemovedSequenceClips(cache: Map<string, VideoTimelineClip>, before: VideoTimelineClip[], after: VideoTimelineClip[]) {
  for (const clip of after) cache.delete(clip.shotId)
  for (const clip of before) if (!after.some(c => c.shotId === clip.shotId && c.versionId === clip.versionId)) {
    cache.delete(clip.shotId)
    cache.set(clip.shotId, { ...clip })
  }
  while (cache.size > 100) cache.delete(cache.keys().next().value!)
}

export function pruneSequenceTrims(cache: Map<string, VideoTimelineClip>, shots: Pick<Shot, 'id' | 'confirmedVideoAssetVersionId'>[]) {
  for (const [id, clip] of cache) if (!shots.some(s => s.id === id && s.confirmedVideoAssetVersionId === clip.versionId)) cache.delete(id)
}

export function sequenceClipForBuild(shotId: string, versionId: string, duration: number, current: VideoTimelineClip[], cache: ReadonlyMap<string, VideoTimelineClip>): VideoTimelineClip {
  const existing = current.find(c => c.shotId === shotId && c.versionId === versionId)
  // Keep current edits, including invalid edits, under the existing draft rules.
  if (existing) return existing
  const removed = cache.get(shotId)
  if (removed?.shotId === shotId && removed.versionId === versionId && videoTimelineClipSchema.safeParse(removed).success && removed.outSeconds <= duration) return { ...removed }
  return { shotId, versionId, inSeconds: 0, outSeconds: duration }
}

export function sequenceClipLabel(version: Pick<AssetVersion, 'metadata'>) {
  const sequence = version.metadata.sequence
  const valid = Array.isArray(sequence) && sequence.length > 0 && sequence.every(c => c && typeof c === 'object' && !Array.isArray(c) && typeof c.shotId === 'string' && typeof c.versionId === 'string')
  return valid ? `${sequence.length} 镜头` : '镜数未知'
}

export function shotVideoCandidates(shot: Shot, versions: AssetVersion[], tasks: AITask[]) {
  const outputOwners = new Map<string, string>()
  const taskOwners = new Map<string, string>()
  for (const task of tasks) if ('targetId' in task.input && task.input.type === 'video-api')
    { taskOwners.set(task.id, task.input.targetId); for (const id of task.resultIds) outputOwners.set(id, task.input.targetId) }
  return versions.filter((version) => {
    if (version.mimeType !== 'video/mp4') return false
    const metadataTarget = typeof version.metadata.targetId === 'string' ? version.metadata.targetId : undefined
    const taskOwner = outputOwners.get(version.id)
    const generationTaskOwner = version.generationTaskId ? taskOwners.get(version.generationTaskId) : undefined
    if (metadataTarget && metadataTarget !== shot.id || taskOwner && taskOwner !== shot.id || generationTaskOwner && generationTaskOwner !== shot.id) return false
    return metadataTarget === shot.id || taskOwner === shot.id || generationTaskOwner === shot.id || shot.assetIds.includes(version.assetId)
  }).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.versionNumber - a.versionNumber)
}

export function shotVideoView(shot: Shot, entities: Entity[], versions: AssetVersion[], tasks: AITask[]) {
  const confirmed = officialVersion(shot, 'video', entities, versions)
  const related = shotVideoCandidates(shot, versions, tasks)
  return {
    confirmed,
    candidates: related.filter((version) => version.id !== confirmed?.id && (version.status === 'draft' || version.status === 'approved')),
    history: related.filter((version) => version.status === 'rejected' || version.status === 'archived'),
    bindingBroken: Boolean(shot.confirmedVideoAssetVersionId && !confirmed),
  }
}

export function shotVideoThumbnail(shot: Shot, entities: Entity[], versions: AssetVersion[], tasks: AITask[]) {
  const view = shotVideoView(shot, entities, versions, tasks)
  const keyframe = officialVersion(shot, 'keyframe', entities, versions)
  return { version: view.confirmed ?? keyframe ?? view.candidates[0], candidate: !view.confirmed && !keyframe && view.candidates.length > 0 }
}
