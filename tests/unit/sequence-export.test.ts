import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { sequenceFixture } from '../fixtures/sequence.js'
import { exportVideoSequence, validateTimeline } from '../../electron/main/video/sequence-export.js'
import { probeVideo, runMediaTool } from '../../electron/main/video/ffmpeg.js'
import { videoBatchCommandSchema } from '../../src/shared/video-batch.js'

test('formal sequence exports confirmed local candidates in story order with current trims and no generation batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-sequence-unit-'))
  const f = await sequenceFixture(root)
  try {
    const ids = f.shots.map(s => s.id)
    await assert.rejects(exportVideoSequence(f.visual, f.project.id, ids), /采用/)
    for (const [i, shot] of f.shots.entries()) {
      f.visual.review(f.project.id, f.versions[i].id, 1, 'approved', null, null)
      const approvedOnly = f.repo.entity(f.project.id, shot.id)
      assert.equal(approvedOnly.kind === 'shot' && approvedOnly.confirmedVideoAssetVersionId, null)
      f.visual.review(f.project.id, f.versions[i].id, 2, 'approved', shot.id, shot.revision)
    }
    const clips = ids.map((shotId, i) => ({ shotId, versionId: f.versions[i].id, inSeconds: i ? 0 : 0.25, outSeconds: i ? 0.5 : 0.75 }))
    assert.throws(() => validateTimeline(f.visual, f.project.id, ids, [...clips].reverse()), /顺序/)
    assert.throws(() => validateTimeline(f.visual, f.project.id, ids, clips.map(c => ({ ...c, outSeconds: 2 }))), /区间/)
    const other = f.db.create({ name: '另一项目', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '1:1' })
    await assert.rejects(exportVideoSequence(f.visual, other.id, ids, clips))
    await assert.rejects(exportVideoSequence(f.visual, f.project.id, [ids[0], ids[0]], [clips[0], clips[0]]), /范围/)
    assert.equal(videoBatchCommandSchema.safeParse({ op: 'exportSequence', projectId: f.project.id, clips, path: 'C:/unsafe.mp4' }).success, false)
    const result = await exportVideoSequence(f.visual, f.project.id, [...ids].reverse(), clips)
    assert.equal(result.metadata.localAssembly, true)
    assert.deepEqual(result.metadata.sequence, clips.map((c, i) => ({ ...c, shotNumber: f.shots[i].order, duration: 0.5 })))
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
    // A stale adoption cannot be silently substituted on a subsequent export.
    const shot = f.repo.entity(f.project.id, ids[0])
    f.repo.updateEntity(f.project.id, shot.id, shot.revision, { confirmedVideoAssetId: null, confirmedVideoAssetVersionId: null })
    await assert.rejects(exportVideoSequence(f.visual, f.project.id, ids, clips), /采用/)
  } finally { f.db.close(); await rm(root, { recursive: true, force: true }) }
})
