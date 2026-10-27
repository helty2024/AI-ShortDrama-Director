import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { sequenceFixture } from '../fixtures/sequence.js'
import { exportVideoSequence, saveSequenceDraft, sequenceExportFilename, validateTimeline } from '../../electron/main/video/sequence-export.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { probeVideo, runMediaTool } from '../../electron/main/video/ffmpeg.js'
import { videoBatchCommandSchema } from '../../src/shared/video-batch.js'
import { sequenceClipLabel } from '../../src/features/shot-videos/shot-video-model.js'

test('sequence export filename keeps project identity and count with Windows-safe names', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const filename = (name: string, count: number) => sequenceExportFilename(name, count, id)
  assert.equal(filename('雨夜来信', 2), `雨夜来信-成片-2镜头-${id}.mp4`)
  assert.equal(filename('雨夜来信', 3), `雨夜来信-成片-3镜头-${id}.mp4`)
  assert.equal(filename('  雨<夜>:"/\\|?*\u0000\n.  ', 2), `雨_夜__________-成片-2镜头-${id}.mp4`)
  for (const name of ['CON', 'nul.txt', 'COM1', 'lPt9.后缀', 'COM¹']) assert(filename(name, 2).startsWith('_'))
  assert.equal(filename(' . . ', 2), `项目-成片-2镜头-${id}.mp4`)
  assert.equal(filename('剧'.repeat(120), 100), `${'剧'.repeat(60)}-成片-100镜头-${id}.mp4`)
  assert(!filename('😀'.repeat(120), 2).includes('\ufffd'))
})

test('sequence history labels use stored sequence count and tolerate missing or malformed legacy metadata', () => {
  const clip = { shotId: 'shot', versionId: 'version' }
  assert.equal(sequenceClipLabel({ metadata: { sequence: [clip, clip] } }), '2 镜头')
  assert.equal(sequenceClipLabel({ metadata: { sequence: [clip, clip, clip] } }), '3 镜头')
  assert.equal(sequenceClipLabel({ metadata: {} }), '镜数未知')
  for (const sequence of [null, [], 'old', [null], [{ shotId: 'shot' }]])
    assert.equal(sequenceClipLabel({ metadata: { sequence } }), '镜数未知')
})

test('sequence shot labels distinguish subsets, compress consecutive positions and safely fall back', () => {
  const shots = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const partial = { metadata: { sequence: [{ shotId: 'a', versionId: 'v1' }, { shotId: 'c', versionId: 'v3' }] } }
  const adjacent = { metadata: { sequence: [{ shotId: 'a', versionId: 'v1' }, { shotId: 'b', versionId: 'v2' }] } }
  assert.equal(sequenceClipLabel(partial, shots), '2 镜头 · 项目镜序1、3')
  assert.equal(sequenceClipLabel(adjacent, shots), '2 镜头 · 项目镜序1-2')
  assert.equal(sequenceClipLabel(partial, [shots[2], shots[1], shots[0]]), '2 镜头 · 项目镜序3、1', 'preserve recorded clip order')
  assert.equal(sequenceClipLabel(partial, [shots[0]]), '2 镜头')
  assert.equal(sequenceClipLabel({ metadata: { sequence: [{ shotId: 'a', versionId: 'v1' }, { shotId: 'a', versionId: 'v1' }] } }, shots), '2 镜头')
  assert.equal(sequenceClipLabel({ metadata: { sequence: [null] } }, shots), '镜数未知')
  const many = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }))
  const long = sequenceClipLabel({ metadata: { sequence: many.filter((_, i) => i % 2 === 0).map(s => ({ shotId: s.id, versionId: 'v' })) } }, many)
  assert.equal(long, '100 镜头 · 项目镜序1、3、5、7、9、11、13、15、…')
  assert(`成片 · ${long}`.length <= 120)
})

test('formal sequence exports only selected confirmed candidates in story order with current trims and no generation batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-sequence-unit-'))
  const f = await sequenceFixture(root, true)
  try {
    const selectedShots = [f.shots[0], f.shots[2]]
    const selectedVersions = [f.versions[0], f.versions[2]]
    const ids = selectedShots.map(s => s.id)
    await assert.rejects(exportVideoSequence(f.visual, f.project.id, []), /范围/)
    await assert.rejects(exportVideoSequence(f.visual, f.project.id, ids), /采用/)
    for (const [i, shot] of f.shots.entries()) {
      f.visual.review(f.project.id, f.versions[i].id, 1, 'approved', null, null)
      const approvedOnly = f.repo.entity(f.project.id, shot.id)
      assert.equal(approvedOnly.kind === 'shot' && approvedOnly.confirmedVideoAssetVersionId, null)
      f.visual.review(f.project.id, f.versions[i].id, 2, 'approved', shot.id, shot.revision)
    }
    const clips = ids.map((shotId, i) => ({ shotId, versionId: selectedVersions[i].id, inSeconds: i ? 0 : 0.25, outSeconds: i ? 0.5 : 0.75 }))
    const draft = saveSequenceDraft(f.visual, f.project.id, 0, clips)
    assert.deepEqual(draft.clips, clips)
    assert(!draft.clips.some(c => c.shotId === f.shots[1].id))
    assert.throws(() => validateTimeline(f.visual, f.project.id, ids, [...clips].reverse()), /顺序/)
    assert.throws(() => validateTimeline(f.visual, f.project.id, ids, clips.map(c => ({ ...c, outSeconds: 2 }))), /区间/)
    const other = f.db.create({ name: '另一项目', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '1:1' })
    await assert.rejects(exportVideoSequence(f.visual, other.id, ids, clips))
    await assert.rejects(exportVideoSequence(f.visual, f.project.id, [ids[0], ids[0]], [clips[0], clips[0]]), /范围/)
    assert.equal(videoBatchCommandSchema.safeParse({ op: 'exportSequence', projectId: f.project.id, clips, path: 'C:/unsafe.mp4' }).success, false)
    const result = await exportVideoSequence(f.visual, f.project.id, [...ids].reverse(), clips)
    assert.equal(result.metadata.localAssembly, true)
    assert.equal(f.visual.asset(f.project.id, result.assetId).name, '成片 · 2 镜头 · 项目镜序2、4')
    assert.equal(sequenceClipLabel(result), '2 镜头')
    const repeat = await exportVideoSequence(f.visual, f.project.id, ids, clips)
    const firstName = sequenceExportFilename(f.project.name, clips.length, result.id)
    const repeatName = sequenceExportFilename(f.project.name, clips.length, repeat.id)
    assert.notEqual(firstName, repeatName, 'two actual same-count exports have unique filename suggestions')
    assert(firstName.endsWith(`-${result.id}.mp4`))
    assert(repeatName.endsWith(`-${repeat.id}.mp4`))
    assert.deepEqual(result.metadata.sequence, clips.map((c, i) => ({ ...c, shotNumber: selectedShots[i].order, duration: 0.5 })))
    const file = await f.visual.storage.resolveRegisteredFile(result.storageKey)
    assert(Math.abs((await probeVideo(file)).duration - 1) < 0.05)
    for (const [time, channel] of [[0, 0], [0.7, 2]] as const) {
      const png = join(root, `frame-${time}.png`)
      await runMediaTool('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-y', png])
      const stats = await sharp(png).stats()
      assert(stats.channels[channel].mean > 200, 'exported frame matches formal red → blue story order')
    }
    assert.equal(f.db.connection.prepare('SELECT count(*) AS count FROM production_batches').get()?.count, 0)
    assert.equal(f.db.connection.prepare('SELECT count(*) AS count FROM generation_records').get()?.count, 0)
    const full = await exportVideoSequence(f.visual, f.project.id, f.shots.map(s => s.id))
    assert.equal(f.visual.asset(f.project.id, full.assetId).name, '成片 · 3 镜头 · 项目镜序2-4')
    assert.equal(sequenceClipLabel(full), '3 镜头')
    const adjacent = await exportVideoSequence(f.visual, f.project.id, f.shots.slice(0, 2).map(s => s.id))
    assert.equal(f.visual.asset(f.project.id, adjacent.assetId).name, '成片 · 2 镜头 · 项目镜序2-3')
    assert.notEqual(f.visual.asset(f.project.id, adjacent.assetId).name, f.visual.asset(f.project.id, result.assetId).name)
    // A stale adoption cannot be silently substituted on a subsequent export.
    const shot = f.repo.entity(f.project.id, ids[0])
    f.repo.updateEntity(f.project.id, shot.id, shot.revision, { confirmedVideoAssetId: null, confirmedVideoAssetVersionId: null })
    await assert.rejects(exportVideoSequence(f.visual, f.project.id, ids, clips), /采用/)
  } finally { f.db.close(); await rm(root, { recursive: true, force: true }) }
})

test('project draft survives reopen, isolates projects, preserves invalid edits and rejects concurrent overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-sequence-draft-'))
  const f = await sequenceFixture(root)
  let db = f.db
  try {
    assert.equal(db.get(f.project.id).sequenceDraft, undefined, 'old projects need no migration')
    for (const [i, shot] of f.shots.entries()) f.visual.review(f.project.id, f.versions[i].id, 1, 'approved', shot.id, shot.revision)
    const clips = f.shots.map((shot, i) => ({ shotId: shot.id, versionId: f.versions[i].id, inSeconds: i ? 0 : 0.25, outSeconds: i ? 0.5 : 0.75 }))
    const saved = saveSequenceDraft(f.visual, f.project.id, 0, clips)
    assert.equal(saved.revision, 1)
    assert.throws(() => saveSequenceDraft(f.visual, f.project.id, 0, clips), /其他窗口/)
    const other = db.create({ name: '独立项目', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '1:1' })
    assert.equal(db.get(other.id).sequenceDraft, undefined)
    assert.throws(() => saveSequenceDraft(f.visual, other.id, 0, clips), /当前项目|不属于|不存在/)
    const asset = db.createDraft({ projectId: other.id, kind: 'asset', name: '跨项目视频' })
    f.repo.updateEntity(other.id, asset.id, asset.revision, { mediaType: 'video' })
    const stored = await f.visual.storage.storeVideo(other.id, asset.id, await f.visual.storage.read(f.versions[0].storageKey))
    const foreign = f.visual.commitVersion(other.id, asset.id, stored, { sourceType: 'imported', provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: {} })
    assert.throws(() => saveSequenceDraft(f.visual, f.project.id, 1, [{ ...clips[0], versionId: foreign.id }]))
    assert.throws(() => saveSequenceDraft(f.visual, f.project.id, 1, [clips[0], clips[0]]), /重复/)
    assert.equal(videoBatchCommandSchema.safeParse({ op: 'saveSequenceDraft', projectId: f.project.id, expectedRevision: 1, clips, path: 'unsafe' }).success, false)
    assert.equal(videoBatchCommandSchema.safeParse({ op: 'saveSequenceDraft', projectId: f.project.id, expectedRevision: 1, clips: Array(101).fill(clips[0]) }).success, false)
    // A temporarily invalid edit must survive as-is, but cannot export.
    const invalid = [{ ...clips[0], outSeconds: 2 }, clips[1]]
    saveSequenceDraft(f.visual, f.project.id, 1, invalid)
    assert.throws(() => validateTimeline(f.visual, f.project.id, clips.map(c => c.shotId), invalid), /区间/)
    assert.deepEqual(db.get(f.project.id).sequenceDraft?.clips, invalid)
    saveSequenceDraft(f.visual, f.project.id, 2, clips)
    db.update({ id: f.project.id, expectedRevision: db.get(f.project.id).revision, changes: { name: '草稿仍在' } })
    db.close()
    db = new ProjectDatabase(join(root, 'workspace.sqlite'))
    const restored = db.get(f.project.id).sequenceDraft!
    assert.deepEqual(restored.clips, clips)
    assert.equal(restored.revision, 3)
    const visual = new VisualRepository(new IntelligenceRepository(db), f.visual.storage)
    const result = await exportVideoSequence(visual, f.project.id, restored.clips.map(c => c.shotId), restored.clips)
    assert(Math.abs(result.duration! - 1) < 0.05)
    // Reordered or replaced formal selections never silently change a draft.
    const shot = visual.repo.entity(f.project.id, clips[0].shotId)
    visual.repo.updateEntity(f.project.id, shot.id, shot.revision, { sceneId: f.shots[1].sceneId, order: 100 })
    await assert.rejects(exportVideoSequence(visual, f.project.id, clips.map(c => c.shotId), restored.clips), /顺序/)
    assert.deepEqual(db.get(f.project.id).sequenceDraft?.clips, clips)
    assert.equal(db.connection.prepare('SELECT count(*) AS count FROM generation_records').get()?.count, 0)
    db.delete(f.project.id)
    assert.throws(() => db.get(f.project.id), /不存在/)
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})

test('removing the final clip persists an empty draft with its revision while empty export remains blocked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-sequence-empty-'))
  const f = await sequenceFixture(root)
  let db = f.db
  try {
    const clip = { shotId: f.shots[0].id, versionId: f.versions[0].id, inSeconds: 0.25, outSeconds: 0.75 }
    saveSequenceDraft(f.visual, f.project.id, 0, [clip])
    const empty = saveSequenceDraft(f.visual, f.project.id, 1, [])
    assert.deepEqual(empty.clips, [])
    assert.equal(empty.revision, 2)
    assert.equal(videoBatchCommandSchema.safeParse({ op: 'saveSequenceDraft', projectId: f.project.id, expectedRevision: 2, clips: [] }).success, true)
    assert.equal(videoBatchCommandSchema.safeParse({ op: 'exportSequence', projectId: f.project.id, clips: [] }).success, false)
    db.close()
    db = new ProjectDatabase(join(root, 'workspace.sqlite'))
    const visual = new VisualRepository(new IntelligenceRepository(db), f.visual.storage)
    assert.deepEqual(db.get(f.project.id).sequenceDraft, empty)
    assert.throws(() => saveSequenceDraft(visual, f.project.id, 1, [clip]), /其他窗口/)
    await assert.rejects(exportVideoSequence(visual, f.project.id, [], []), /范围/)
    assert.deepEqual(saveSequenceDraft(visual, f.project.id, 2, [clip]).clips, [clip])
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})
