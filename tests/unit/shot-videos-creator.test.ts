import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { assetVersionSchema } from '../../src/shared/visual.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import { pruneSequenceTrims, rememberRemovedSequenceClips, sequenceClipForBuild, shotVideoCandidates, shotVideoThumbnail, shotVideoView } from '../../src/features/shot-videos/shot-video-model.js'
import { orderedShots } from '../../src/features/storyboard/storyboard-model.js'
import type { VideoTimelineClip } from '../../src/shared/video-batch.js'

test('removed sequence trims return for the same shot/version and update on repeated removal', () => {
  const clips = Array.from({ length: 3 }, () => ({ shotId: randomUUID(), versionId: randomUUID(), inSeconds: 0.2, outSeconds: 0.7 }))
  const cache = new Map<string, VideoTimelineClip>()
  const remaining = [clips[0], clips[2]]
  rememberRemovedSequenceClips(cache, clips, remaining)
  assert.deepEqual([...cache.values()], [clips[1]])
  const restored = sequenceClipForBuild(clips[1].shotId, clips[1].versionId, 1, remaining, cache)
  assert.deepEqual(restored, clips[1])
  assert.notEqual(restored, cache.get(clips[1].shotId))
  rememberRemovedSequenceClips(cache, remaining, [clips[0], restored, clips[2]])
  assert.equal(cache.size, 0, 'returning clips consume their cache entry')
  const edited = { ...restored, inSeconds: 0.3 }
  rememberRemovedSequenceClips(cache, [edited], [])
  assert.deepEqual(sequenceClipForBuild(edited.shotId, edited.versionId, 1, [], cache), edited)
  const invalidCurrent = { ...edited, outSeconds: 2 }
  assert.deepEqual(sequenceClipForBuild(edited.shotId, edited.versionId, 1, [invalidCurrent], cache), invalidCurrent, 'current invalid edits keep existing draft behavior')
})

test('invalid removed trims and changed/deleted bindings fall back without reviving an old version', () => {
  const clip = { shotId: randomUUID(), versionId: randomUUID(), inSeconds: 0.2, outSeconds: 0.7 }
  const cache = new Map<string, VideoTimelineClip>()
  const full = { ...clip, inSeconds: 0, outSeconds: 1 }
  for (const range of [{ inSeconds: -1 }, { inSeconds: 0.8 }, { inSeconds: NaN }, { outSeconds: 0 }, { outSeconds: 2 }, { outSeconds: Infinity }]) {
    cache.set(clip.shotId, { ...clip, ...range })
    assert.deepEqual(sequenceClipForBuild(clip.shotId, clip.versionId, 1, [], cache), full)
  }
  cache.set(clip.shotId, clip)
  assert.deepEqual(sequenceClipForBuild(clip.shotId, clip.versionId, 0.5, [], cache), { ...full, outSeconds: 0.5 })
  const newVersion = randomUUID()
  assert.deepEqual(sequenceClipForBuild(clip.shotId, newVersion, 1, [], cache), { ...full, versionId: newVersion })
  pruneSequenceTrims(cache, [{ id: clip.shotId, confirmedVideoAssetVersionId: newVersion }])
  pruneSequenceTrims(cache, [{ id: clip.shotId, confirmedVideoAssetVersionId: clip.versionId }])
  assert.deepEqual(sequenceClipForBuild(clip.shotId, clip.versionId, 1, [], cache), full, 'A → B → A does not revive the previous A trim')
  cache.set(clip.shotId, clip)
  pruneSequenceTrims(cache, [])
  assert.equal(cache.size, 0)
})

test('removed sequence trim cache is bounded and supports removing the last clip', () => {
  const cache = new Map<string, VideoTimelineClip>()
  const clips = Array.from({ length: 101 }, () => ({ shotId: randomUUID(), versionId: randomUUID(), inSeconds: 0.2, outSeconds: 0.7 }))
  for (const clip of clips) rememberRemovedSequenceClips(cache, [clip], [])
  assert.equal(cache.size, 100)
  assert.equal(cache.has(clips[0].shotId), false)
  const last = clips.at(-1)!
  assert.deepEqual(sequenceClipForBuild(last.shotId, last.versionId, 1, [], cache), last)
})

test('Shot Videos resolves only explicit MP4 ownership and exact confirmed pin', () => {
  const db = new ProjectDatabase(':memory:')
  try {
    const project = db.seed(buildSeed)
    const entities = db.workspace(project.id).entities
    const shot = orderedShots(entities)[0]!
    const other = orderedShots(entities)[1]!
    const asset = entities.find((entity) => entity.kind === 'asset')!
    if (asset.kind !== 'asset') throw new Error('fixture')
    const version = (targetId: string, status: 'draft' | 'approved' | 'rejected', type: 'video/mp4' | 'image/png' = 'video/mp4') => assetVersionSchema.parse({ id: randomUUID(), projectId: project.id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1, assetId: asset.id, versionNumber: 1, status, sourceType: 'generated', mimeType: type, width: 32, height: 32, fileSize: 32, hash: 'a'.repeat(64), storageKey: 'test', thumbnailPath: 'test', provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: { targetId } })
    const pinned = version(shot.id, 'approved')
    const newer = version(shot.id, 'draft')
    const foreign = version(other.id, 'draft')
    const rejected = version(shot.id, 'rejected')
    const image = version(shot.id, 'draft', 'image/png')
    const bound = { ...shot, confirmedVideoAssetId: asset.id, confirmedVideoAssetVersionId: pinned.id }
    const all = [newer, foreign, pinned, rejected, image]
    assert.deepEqual(shotVideoCandidates(shot, all, []).map((item) => item.id).sort(), [newer.id, pinned.id, rejected.id].sort())
    assert.equal(shotVideoView(bound, entities, all, []).confirmed?.id, pinned.id)
    assert.deepEqual(shotVideoView(bound, entities, all, []).candidates.map((item) => item.id), [newer.id])
    assert.deepEqual(shotVideoView(bound, entities, all, []).history.map((item) => item.id), [rejected.id])
    assert.equal(shotVideoView({ ...bound, confirmedVideoAssetVersionId: randomUUID() }, entities, all, []).bindingBroken, true)
    assert.equal(shotVideoView({ ...bound, confirmedVideoAssetVersionId: randomUUID() }, entities, all, []).confirmed, undefined)
    assert.equal(shotVideoThumbnail(bound, entities, all, []).version?.id, pinned.id)
    assert.equal(shotVideoThumbnail(shot, entities, [newer], []).candidate, true)
    const linkedOnly = { ...newer, id: randomUUID(), metadata: {}, assetId: randomUUID() }
    const task = aiTaskSchema.parse({ id: randomUUID(), projectId: project.id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1, input: { type: 'video-api', targetId: shot.id }, status: 'succeeded', attempt: 1, error: null, resultIds: [linkedOnly.id], sourceRevisions: {} })
    assert.deepEqual(shotVideoCandidates(shot, [linkedOnly], [task]).map((item) => item.id), [linkedOnly.id])
    assert.deepEqual(shotVideoCandidates(other, [linkedOnly], [task]), [])
    assert.deepEqual(shotVideoCandidates({ ...shot, assetIds: [linkedOnly.assetId] }, [linkedOnly], []), [linkedOnly])
    assert.deepEqual(shotVideoCandidates({ ...other, assetIds: [linkedOnly.assetId] }, [{ ...linkedOnly, metadata: { targetId: shot.id } }], []), [])
  } finally { db.close() }
})

test('Shot Videos sequence follows persisted production order', () => {
  const db = new ProjectDatabase(':memory:')
  try {
    const project = db.seed(buildSeed)
    const shots = orderedShots(db.workspace(project.id).entities)
    assert.ok(shots.length > 1)
    assert.ok(shots.every((shot, index) => index === 0 || shot.order >= shots[index - 1]!.order || shot.sceneId !== shots[index - 1]!.sceneId))
  } finally { db.close() }
})
