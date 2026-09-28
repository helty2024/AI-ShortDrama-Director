import type { Shot, Entity } from '../../shared/domain.js'
import type { AITask } from '../../shared/intelligence.js'
import type { AssetVersion } from '../../shared/visual.js'
import { officialVersion } from '../storyboard/storyboard-model.js'

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
