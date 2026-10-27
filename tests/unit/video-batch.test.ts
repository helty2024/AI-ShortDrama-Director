import sharp from 'sharp'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { CompShareMiniMaxH3Adapter } from '../../electron/main/tools/adapters/compshare-minimax-h3.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'
import { VideoApiGenerationService } from '../../electron/main/generation/video-api-service.js'
import { VideoBatchService } from '../../electron/main/generation/video-batch.js'
import { compshareServer } from '../fixtures/compshare-http.js'
import { shotSchema } from '../../src/shared/domain.js'
import { backupProject, restoreProject } from '../../electron/main/operations/backup.js'
import { VideoApiAdapter, type VideoApiTool } from '../../electron/main/tools/adapters/video-api.js'
import { videoServer } from '../fixtures/video-http.js'
import { videoApiProfileSchema } from '../../src/shared/video-tool-profile.js'
import { nativeVideoBatchSchema } from '../../src/shared/video-batch.js'
import { configurationHash } from '../../electron/main/generation/execution-binding.js'

function prepareTechnical(batch: VideoBatchService, projectId: string, ids: string[], reference: string | null = null) { return batch.prepare(projectId, ids, reference, 'technical-test') }

test('legacy batches without readiness evidence remain technical history, never retroactive narrative approval', async () => {
  const f = await fixture()
  try {
    const batch = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
    f.db.connection.prepare("UPDATE production_batches SET data=json_remove(data,'$.nativeVideo.items[0].input.purpose') WHERE id=?").run(batch.id)
    assert.equal(f.batch.get(f.project.id, batch.id).nativeVideo!.items[0].input.purpose, 'technical-test')
    assert.equal(f.server.counts.submit, 0)
  } finally { await f.close() }
})

async function fixture(kind: 'h3' | 'reference' = 'h3', shotDuration = 4) {
  const local = kind === 'reference' ? await videoServer('ok', true) : null
  const server = local ?? await compshareServer(), root = await mkdtemp(join(tmpdir(), 'director-video-batch-'))
  const path = join(root, 'workspace.sqlite')
  let db = new ProjectDatabase(path)
  const project = db.create({ name: 'batch', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '1:1' })
  db.insertEntities(project.id, buildSeed(project.id))
  const old = db.workspace(project.id).entities.find(e => e.kind === 'shot')!
  assert.equal(old.kind, 'shot')
  if (old.kind !== 'shot') throw new Error()
  const shots = Array.from({ length: 7 }, (_, i) => shotSchema.parse({ ...old, ...metadata(), id: randomUUID(), name: `镜 ${i + 1}`, order: i + 10, durationSeconds: shotDuration,
    plan: { shotNumber: i + 1, shotType: '中景', framing: '中景', cameraAngle: '平视', focalLengthSuggestion: '50mm', subject: '人物', action: `动作 ${i + 1}`, cameraMovement: '固定', durationSuggestion: 4, emotion: '平静', continuityNotes: '连续', characterRefs: old.characterIds, locationRef: old.locationId, propRefs: old.propIds } }))
  db.insertEntities(project.id, shots)
  const profile = local ? videoApiProfileSchema.parse({ ...local.profile, supportsLastFrame: false, maxOutputCount: 1,
    batchPolicy: { fps: 12, maxPromptLength: 12000, maxConcurrent: 2, budgetCurrency: 'USD', reservationQuote: null } }) : null
  const adapter = (): VideoApiTool => profile ? new VideoApiAdapter(profile, async () => 'LOCAL_ONLY', new ImageHttpTransport({ fixtureOrigin: server.origin, timeoutMs: 500 }))
    : new CompShareMiniMaxH3Adapter({ adapter: 'compshare-minimax-h3', toolId: 'compshare.minimax-h3', modelId: 'MiniMax-H3', credentialRef: null }, async () => 'sk-ml-FIXTURE_ONLY', new ImageHttpTransport({ fixtureOrigin: server.origin, timeoutMs: 500 }))
  let visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(root, 'media')))
  let video = new VideoApiGenerationService(visual, [adapter()]), batch = new VideoBatchService(video)
  return { root, server, local, project, shots, old, adapter, get db() { return db }, get visual() { return visual }, get video() { return video }, get batch() { return batch },
    restart(adapters?: VideoApiTool[]) { db.close(); db = new ProjectDatabase(path); visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(root, 'media'))); video = new VideoApiGenerationService(visual, adapters ?? [adapter()]); batch = new VideoBatchService(video) },
    async close() { db.close(); await server.close(); await rm(root, { recursive: true, force: true }) } }
}
test('7-shot batch stays offline until one scope/budget approval; serial results are independent, export uses adopted order and survives restart', async () => {
  const f = await fixture()
  try {
    const prepared = await prepareTechnical(f.batch, f.project.id, f.shots.map(s => s.id).reverse())
    assert.equal(f.server.counts.submit, 0)
    await f.video.preview(prepared.nativeVideo!.items[0].input)
    assert.deepEqual(prepared.nativeVideo!.items.map(i => i.shotNumber), [1, 2, 3, 4, 5, 6, 7])
    assert(!prepared.nativeVideo!.items.some(i => i.shotId === f.old.id))
    assert.throws(() => f.batch.authorize(f.project.id, prepared.id, 1, 139, 7000000))
    f.batch.authorize(f.project.id, prepared.id, 1, 140, null)
    assert.equal(f.batch.get(f.project.id, prepared.id).nativeVideo!.maxCostMicro, null)
    assert.throws(() => f.batch.authorize(f.project.id, prepared.id, 1, 140, 7000000))
    await assert.rejects(f.batch.export(f.project.id, prepared.id), /采用/)
    for (let i = 0; i < 7; i++) {
      await Promise.all([f.batch.tick(), f.batch.tick()])
      const row = f.batch.get(f.project.id, prepared.id).nativeVideo!.items[i]
      assert(row.taskId); await f.video.wait(row.taskId)
      assert.equal(f.video.generation.task(f.project.id, row.taskId).error, null)
      assert.equal(f.server.counts.submit, i + 1)
    }
    await f.batch.tick()
    const finished = f.batch.get(f.project.id, prepared.id)
    assert.equal(finished.nativeVideo!.state, 'completed')
    assert(finished.nativeVideo!.items.every(i => i.status === 'succeeded'))
    for (const item of finished.nativeVideo!.items) {
      const record = f.video.generation.findByTask(f.project.id, item.taskId!)!
      const version = f.visual.version(f.project.id, record.outputAssetVersionIds[0])
      assert.equal(version.status, 'draft'); assert.equal(record.actualCost, null)
      assert.equal(record.currency, 'PTS')
      assert(record.sourceRevisions[f.shots[0].sceneId])
      const shot = f.video.generation.entity(f.project.id, item.shotId)
      f.video.review(f.project.id, version.id, version.revision, false, shot.revision)
      const approved = f.visual.version(f.project.id, version.id)
      f.video.review(f.project.id, approved.id, approved.revision, true, shot.revision)
    }
    const clips = f.shots.map((s, i) => { const shot = f.video.generation.entity(f.project.id, s.id); assert.equal(shot.kind, 'shot'); return { shotId: s.id, versionId: shot.kind === 'shot' ? shot.confirmedVideoAssetVersionId! : '', inSeconds: 0, outSeconds: i === 4 || i === 5 ? 3.5 : 4 } })
    const revision = f.batch.get(f.project.id, prepared.id).nativeVideo!.revision
    assert.throws(() => f.batch.saveTimeline(f.project.id, prepared.id, revision, [...clips].reverse()), /顺序/)
    assert.throws(() => f.batch.saveTimeline(f.project.id, prepared.id, revision, clips.map((c, i) => i ? c : { ...c, outSeconds: 6 })), /区间/)
    f.batch.saveTimeline(f.project.id, prepared.id, revision, clips)
    assert.throws(() => f.batch.saveTimeline(f.project.id, prepared.id, revision, clips), /已更新/)
    const exportVersion = await f.batch.export(f.project.id, prepared.id)
    assert(Math.abs(exportVersion.duration! - 27) < 0.1)
    assert.deepEqual((exportVersion.metadata.sequence as { shotId: string }[]).map(i => i.shotId), f.shots.map(s => s.id))
    f.restart()
    assert.deepEqual(f.batch.get(f.project.id, prepared.id).nativeVideo!.timeline, clips)
    assert.equal(f.batch.get(f.project.id, prepared.id).nativeVideo!.exportVersionIds[0], exportVersion.id)
    assert(f.shots.every(s => { const shot = f.video.generation.entity(f.project.id, s.id); return shot.kind === 'shot' && shot.confirmedVideoAssetVersionId }))
    await f.batch.tick(); assert.equal(f.server.counts.submit, 7)
    const rework = await f.batch.rework(f.project.id, prepared.id, f.shots[2].id)
    assert.equal(rework.nativeVideo!.state, 'awaiting-budget'); assert.equal(rework.nativeVideo!.items.length, 1)
    await f.batch.tick(); assert.equal(f.server.counts.submit, 7)
  } finally { await f.close() }
})

test('pause/restart/resume persist; failed shot does not stop subsequent shots; unknown never resubmits', async () => {
  const f = await fixture()
  try {
    const p = await prepareTechnical(f.batch, f.project.id, f.shots.map(s => s.id))
    f.batch.authorize(f.project.id, p.id, 1, 140, 7000000)
    f.batch.pause(f.project.id, p.id); await f.batch.tick(); assert.equal(f.server.counts.submit, 0)
    f.restart(); assert.equal(f.batch.get(f.project.id, p.id).nativeVideo!.state, 'paused')
    await f.batch.tick(); assert.equal(f.server.counts.submit, 0)
    f.batch.resume(f.project.id, p.id); f.server.setMode('failed')
    await f.batch.tick(); await f.video.wait(f.batch.get(f.project.id, p.id).nativeVideo!.items[0].taskId!)
    f.server.setMode('ok'); await f.batch.tick()
    assert.equal(f.batch.get(f.project.id, p.id).nativeVideo!.items[0].status, 'failed')
    const second = f.batch.get(f.project.id, p.id).nativeVideo!.items[1]
    await f.video.wait(second.taskId!); assert.equal(f.server.counts.submit, 2)
    f.server.setMode('unknown-submit'); await f.batch.tick()
    const third = f.batch.get(f.project.id, p.id).nativeVideo!.items[2]
    await f.video.wait(third.taskId!); await f.batch.tick()
    assert.equal(f.batch.get(f.project.id, p.id).nativeVideo!.items[2].status, 'unknown')
    assert.throws(() => f.batch.rework(f.project.id, p.id, third.shotId))
    f.restart(); await f.batch.tick()
    assert.equal(f.server.counts.submit, 3)
    assert.throws(() => f.batch.resume(f.project.id, p.id))
  } finally { await f.close() }
})

test('duplicate selection, overlapping authorization, stale source and restored history cannot submit', async () => {
  const f = await fixture()
  try {
    await assert.rejects(prepareTechnical(f.batch, f.project.id, [f.shots[0].id, f.shots[0].id]))
    const a = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id]), b = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
    f.batch.authorize(f.project.id, a.id, 1, 20, 1000000)
    assert.throws(() => f.batch.authorize(f.project.id, b.id, 1, 20, 1000000))
    f.db.connection.prepare("UPDATE entities SET data=json_set(data,'$.revision',2) WHERE id=?").run(f.shots[0].id)
    await f.batch.tick(); assert.equal(f.server.counts.submit, 0)
    assert.equal(f.batch.get(f.project.id, a.id).nativeVideo!.items[0].status, 'failed')
    f.db.connection.prepare("UPDATE production_batches SET data=json_set(data,'$.nativeVideo.executionAllowed',json('false')) WHERE id=?").run(a.id)
    assert.throws(() => f.batch.resume(f.project.id, a.id))
  } finally { await f.close() }
})

test('accepted remote job survives restart: query original identity and finish queue without duplicate POST', async () => {
  const f = await fixture()
  try {
    const batch = await prepareTechnical(f.batch, f.project.id, f.shots.slice(0, 2).map(s => s.id))
    f.batch.authorize(f.project.id, batch.id, 1, 40, 2000000)
    f.server.setMode('status-500'); await f.batch.tick()
    const first = f.batch.get(f.project.id, batch.id).nativeVideo!.items[0]
    await f.video.wait(first.taskId!)
    assert(f.video.generation.task(f.project.id, first.taskId!).providerTaskId)
    f.restart(); assert.equal(f.batch.get(f.project.id, batch.id).nativeVideo!.state, 'paused')
    f.server.setMode('ok'); await f.batch.tick()
    assert.equal(f.batch.get(f.project.id, batch.id).nativeVideo!.items[0].status, 'succeeded')
    assert.equal(f.server.counts.submit, 1)
    f.batch.resume(f.project.id, batch.id); await f.batch.tick()
    const second = f.batch.get(f.project.id, batch.id).nativeVideo!.items[1]
    await f.video.wait(second.taskId!); await f.batch.tick()
    assert.equal(f.server.counts.submit, 2)
    assert.equal(f.batch.get(f.project.id, batch.id).nativeVideo!.state, 'completed')
  } finally { await f.close() }
})

test('backup/restore retains batch scope but strips paid execution authority', async () => {
  const f = await fixture()
  try {
    const batch = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
    f.batch.authorize(f.project.id, batch.id, 1, 20, 1000000)
    const path = await backupProject(f.visual, f.project.id, f.root)
    const restored = await restoreProject(f.visual, path)
    const history = f.batch.list(restored.id)[0]
    assert.equal(history.nativeVideo!.executionAllowed, false)
    assert.equal(history.nativeVideo!.state, 'paused')
    assert.notEqual(history.nativeVideo!.items[0].shotId, f.shots[0].id)
    assert.throws(() => f.batch.resume(restored.id, history.id))
    assert.throws(() => f.batch.authorize(restored.id, history.id, history.nativeVideo!.revision, 20, 1000000))
    f.batch.pause(f.project.id, batch.id); await f.batch.tick()
    assert.equal(f.server.counts.submit, 0)
  } finally { await f.close() }
})

test('independent schedulers use one persisted provider slot and do not overwrite a shot task', async () => {
  const f = await fixture()
  try {
    const batch = await prepareTechnical(f.batch, f.project.id, f.shots.slice(0, 2).map(s => s.id))
    const second = new VideoBatchService(f.video)
    f.batch.authorize(f.project.id, batch.id, f.batch.get(f.project.id, batch.id).nativeVideo!.revision, 40, null)
    await Promise.all([f.batch.tick(), second.tick()])
    const items = f.batch.get(f.project.id, batch.id).nativeVideo!.items
    assert.equal(items.filter(i => i.taskId).length, 1)
    await f.video.wait(items[0].taskId!)
    assert.equal(f.server.counts.submit, 1)
    assert.equal(f.video.generation.list('generation_records', f.project.id).length, 1)
    f.batch.pause(f.project.id, batch.id)
    await second.tick(); assert.equal(f.server.counts.submit, 1)
  } finally { await f.close() }
})

test('local output reconciliation queries the same accepted task, retains failure evidence and never creates another POST or approval', async () => {
  const f = await fixture()
  try {
    const batch = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
    f.batch.authorize(f.project.id, batch.id, 1, 20, null)
    f.server.setMode('html'); await f.batch.tick()
    const item = f.batch.get(f.project.id, batch.id).nativeVideo!.items[0]
    await f.video.wait(item.taskId!); await f.batch.tick()
    assert.equal(f.video.generation.findByTask(f.project.id, item.taskId!)!.outcome, 'malformed-output')
    const approvalCount = f.video.approvals.listApprovals(f.project.id).length
    f.server.setMode('ok'); await f.batch.recoverOutput(f.project.id, batch.id, item.shotId)
    const result = await f.video.query(f.project.id, item.taskId!)
    assert.equal(result.record.outcome, 'succeeded')
    assert.match(String(result.versions[0].metadata.outputReconciliation), /malformed-output/)
    assert.equal(result.versions[0].status, 'draft')
    assert.equal(f.server.counts.submit, 1)
    assert.equal(f.video.approvals.listApprovals(f.project.id).length, approvalCount)
    assert.equal(f.video.generation.list('generation_records', f.project.id).length, 1)
    await assert.rejects(f.batch.recoverOutput(f.project.id, batch.id, item.shotId))
  } finally { await f.close() }
})


test('narrative production blocks absent/draft/foreign/stale references and invalid fees before any provider generation call', async () => {
  const f = await fixture()
  try {
    const shot = f.shots[0], projectId = f.project.id
    await assert.rejects(f.batch.prepare(projectId, [shot.id]), /主参考/)
    assert.equal(f.server.counts.submit, 0)
    const path = join(f.root, 'reference.png')
    await writeFile(path, await sharp({ create: { width: 480, height: 480, channels: 3, background: '#ccaa88' } }).png().toBuffer())
    const ref = await f.visual.importFile(projectId, path, 'offline reference', null)
    const input = { ...(await prepareTechnical(f.batch, projectId, [shot.id])).nativeVideo!.items[0].input, purpose: 'narrative-production' as const, mode: 'image-to-video' as const, firstFrameAssetVersionId: ref.id }
    await assert.rejects(f.video.preview(input), /主参考/)
    for (const id of shot.characterIds) {
      const character = f.video.generation.entity(projectId, id)
      const version = await f.visual.importFile(projectId, path, 'local-only character', null)
      f.visual.review(projectId, version.id, version.revision, 'approved', id, character.revision)
    }
    await assert.rejects(f.video.preview(input), /场景主参考/)
    const location = f.video.generation.entity(projectId, shot.locationId!)
    const locationRef = await f.visual.importFile(projectId, path, 'local-only scene', null)
    f.visual.review(projectId, locationRef.id, locationRef.revision, 'approved', location.id, location.revision)
    await assert.rejects(f.video.preview(input), /关键帧/)
    f.visual.review(projectId, ref.id, ref.revision, 'approved', shot.id, shot.revision)
    const preview = await f.video.preview(input)
    assert.match(preview.disclosure, /叙事生产/)
    assert.equal(f.server.counts.submit, 0)
    assert.throws(() => f.video.confirm(projectId, preview.id, 0, true), /正数费用/)
    assert.throws(() => f.video.confirm(projectId, preview.id, -1, true), /正数费用/)
    assert.throws(() => f.video.confirm(projectId, preview.id, 20000000, false))
    assert.equal(f.server.counts.submit, 0)
    const next = await f.video.preview(input)
    const approved = f.visual.version(projectId, ref.id)
    f.db.connection.prepare("UPDATE asset_versions SET data=json_set(data,'$.revision',?) WHERE id=?").run(approved.revision + 1, ref.id)
    assert.throws(() => f.video.confirm(projectId, next.id, 20000000, true), /版本已变化/)
    assert.equal(f.server.counts.submit, 0)
    const foreign = f.db.create({ name: 'foreign', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '1:1' })
    await assert.rejects(f.video.preview({ ...input, projectId: foreign.id }))
    assert.equal(f.server.counts.submit, 0)
    // Race after confirmation but before backend execution: revocation must still stop POST.
    const last = await f.video.preview(input), originalRead = f.visual.storage.read.bind(f.visual.storage)
    let changed = false
    f.visual.storage.read = async key => {
      if (!changed) { changed = true; f.db.connection.prepare("UPDATE asset_versions SET data=json_set(data,'$.status','rejected') WHERE id=?").run(ref.id) }
      return originalRead(key)
    }
    const task = f.video.confirm(projectId, last.id, 20000000, true)
    await f.video.wait(task.id)
    assert.equal(f.video.generation.task(projectId, task.id).status, 'failed')
    assert.equal(f.server.counts.submit, 0)
    assert.equal(f.video.generation.task(projectId, task.id).providerTaskId ?? null, null)
  } finally { await f.close() }
})

for (const kind of ['h3', 'reference'] as const) test(`capability-driven ${kind}: same formal scope, adapter parameters, enqueue, recovery and result association`, async () => {
  const f = await fixture(kind, 1)
  try {
    const prepared = await prepareTechnical(f.batch, f.project.id, f.shots.slice(0, 2).map(s => s.id).reverse())
    const n = prepared.nativeVideo!
    assert.deepEqual(n.items.map(i => i.shotId), f.shots.slice(0, 2).map(s => s.id))
    assert.equal(n.items[0].input.durationSeconds, kind === 'h3' ? 4 : 1)
    assert.equal(n.items[0].input.resolution.width, kind === 'h3' ? 480 : 32)
    assert.equal(n.items[0].input.fps, kind === 'h3' ? 24 : 12)
    assert.equal(n.concurrency, kind === 'h3' ? 1 : 2)
    assert.equal(n.budgetCurrency, kind === 'h3' ? 'PTS' : 'USD')
    assert.equal(n.quoteKnown, kind === 'h3')
    assert.equal(f.server.counts.submit, 0)
    assert.throws(() => f.batch.authorize(f.project.id, prepared.id, n.revision, 0, null))
    f.batch.authorize(f.project.id, prepared.id, n.revision, kind === 'h3' ? 40 : 2, null)
    f.server.setMode('status-500')
    await f.batch.tick()
    const first = f.batch.get(f.project.id, prepared.id).nativeVideo!.items[0]
    await f.video.wait(first.taskId!)
    const binding = f.video.bindings.get(f.video.generation.findByTask(f.project.id, first.taskId!)!)
    assert.equal(binding.configuration.descriptor.id, n.toolId)
    assert.equal(binding.authorization.currency, n.budgetCurrency)
    f.restart()
    f.server.setMode('ok')
    await f.batch.tick()
    assert.equal(f.server.counts.submit, 1)
    assert.equal(f.batch.get(f.project.id, prepared.id).nativeVideo!.items[0].status, 'succeeded')
    f.batch.resume(f.project.id, prepared.id)
    await f.batch.tick()
    const second = f.batch.get(f.project.id, prepared.id).nativeVideo!.items[1]
    await f.video.wait(second.taskId!)
    await f.batch.tick()
    const complete = f.batch.get(f.project.id, prepared.id).nativeVideo!
    assert.equal(complete.state, 'completed')
    assert.equal(f.server.counts.submit, 2)
    for (const item of complete.items) {
      const record = f.video.generation.findByTask(f.project.id, item.taskId!)!
      assert.equal(record.targetObjectId, item.shotId)
      assert.equal(record.modelId, n.model)
      assert.deepEqual(record.actualCost, kind === 'h3' ? null : { amountMicros: 7, currency: 'USD' })
      assert.equal(record.outcome, 'succeeded')
      assert.equal(record.outputAssetVersionIds.length, 1)
      const output = f.visual.version(f.project.id, record.outputAssetVersionIds[0])
      assert.equal(output.metadata.targetId, item.shotId)
      assert.equal(output.status, 'draft')
    }
    f.restart(); await f.batch.tick()
    assert.equal(f.server.counts.submit, 2)
    assert.equal(f.db.connection.prepare('PRAGMA user_version').get()!.user_version, 11)
    assert.deepEqual(f.db.connection.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { await f.close() }
})

test('different adapters reject illegal parameters and incompatible reference modes before submit', async () => {
  for (const kind of ['h3', 'reference'] as const) {
    const f = await fixture(kind, 1)
    try {
      const batch = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
      const input = batch.nativeVideo!.items[0].input
      for (const change of [{ durationSeconds: 2 }, { fps: 11 }, { resolution: { width: 48, height: 32 } }, { prompt: 'x'.repeat(kind === 'h3' ? 7001 : 12001) }])
        await assert.rejects(f.video.preview({ ...input, ...change }))
      const frames = { ...input, mode: 'image-to-video' as const, firstFrameAssetVersionId: randomUUID(), lastFrameAssetVersionId: randomUUID() }
      if (kind === 'reference') await assert.rejects(f.video.planBatch([frames]), /没有满足/)
      else assert.equal((await f.video.planBatch([frames])).inputs[0].lastFrameAssetVersionId, frames.lastFrameAssetVersionId)
      await assert.rejects(f.video.preview({ ...input, referenceImages: [randomUUID()] }))
      assert.equal(f.server.counts.submit, 0)
    } finally { await f.close() }
  }
})

test('model switch cannot inherit budget, change historical execution binding or resubmit an accepted job', async () => {
  const f = await fixture('reference', 1)
  try {
    const prepared = await prepareTechnical(f.batch, f.project.id, f.shots.slice(0, 2).map(s => s.id))
    f.batch.authorize(f.project.id, prepared.id, 1, 2, null)
    f.server.setMode('status-500'); await f.batch.tick()
    const first = f.batch.get(f.project.id, prepared.id).nativeVideo!.items[0]
    await f.video.wait(first.taskId!)
    const oldRecord = f.video.generation.findByTask(f.project.id, first.taskId!)!
    const bindingBefore = f.db.connection.prepare('SELECT data FROM execution_bindings WHERE record_id=?').get(oldRecord.id)!.data
    const original = f.adapter().profile
    const replacement = () => new VideoApiAdapter({ ...original, modelId: 'reference-video-v2' }, async () => 'LOCAL_ONLY', new ImageHttpTransport({ fixtureOrigin: f.server.origin }))
    f.restart([replacement()])
    f.video.bindings.resolver = async config => config.profile.modelId === original.modelId ? f.adapter() : null
    f.server.setMode('ok'); await f.batch.tick()
    assert.equal(f.server.counts.submit, 1)
    assert.equal(f.batch.get(f.project.id, prepared.id).nativeVideo!.items[0].status, 'succeeded')
    assert.throws(() => f.batch.resume(f.project.id, prepared.id), /原执行配置/)
    const next = await prepareTechnical(f.batch, f.project.id, [f.shots[2].id])
    assert.equal(next.nativeVideo!.model, 'reference-video-v2')
    assert.equal(next.nativeVideo!.authorizedAt, null)
    await f.batch.tick(); assert.equal(f.server.counts.submit, 1)
    f.batch.authorize(f.project.id, next.id, 1, 1, null)
    await f.batch.tick()
    const nextItem = f.batch.get(f.project.id, next.id).nativeVideo!.items[0]
    await f.video.wait(nextItem.taskId!)
    const newRecord = f.video.generation.findByTask(f.project.id, nextItem.taskId!)!
    assert.notEqual(newRecord.approvalId, oldRecord.approvalId)
    assert.equal(newRecord.modelId, 'reference-video-v2')
    assert.equal(f.db.connection.prepare('SELECT data FROM execution_bindings WHERE record_id=?').get(oldRecord.id)!.data, bindingBefore)
    assert.equal(f.video.generation.findByTask(f.project.id, oldRecord.taskId)!.modelId, original.modelId)
    assert.equal(f.server.counts.submit, 2)
  } finally { await f.close() }
})

test('unknown reference-adapter submission survives restart without a second call; modified batch approval is rejected', async () => {
  const f = await fixture('reference', 1)
  try {
    const prepared = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
    f.batch.authorize(f.project.id, prepared.id, 1, 1, null)
    f.server.setMode('unknown-submit'); await f.batch.tick()
    const task = f.batch.get(f.project.id, prepared.id).nativeVideo!.items[0].taskId!
    await f.video.wait(task); await f.batch.tick()
    f.restart(); await f.batch.tick()
    assert.equal(f.server.counts.submit, 1)
    assert.equal(f.batch.get(f.project.id, prepared.id).nativeVideo!.items[0].status, 'unknown')
    assert.throws(() => f.batch.resume(f.project.id, prepared.id), /未知/)
    const next = await prepareTechnical(f.batch, f.project.id, [f.shots[1].id])
    f.batch.authorize(f.project.id, next.id, 1, 1, null)
    f.db.connection.prepare("UPDATE production_batches SET data=json_set(data,'$.nativeVideo.items[0].input.prompt','changed') WHERE id=?").run(next.id)
    await f.batch.tick()
    assert.equal(f.server.counts.submit, 1)
    assert.equal(f.batch.get(f.project.id, next.id).nativeVideo!.items[0].status, 'failed')
  } finally { await f.close() }
})

test('legacy H3 batch JSON remains readable without new fields and cannot acquire new execution authority', async () => {
  const f = await fixture()
  try {
    const batch = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
    const legacy = { ...batch.nativeVideo! }
    delete legacy.executionConfiguration; delete legacy.budgetCurrency; delete legacy.quoteKnown; delete legacy.quoteBasis; delete legacy.scopeFingerprint
    assert.equal(nativeVideoBatchSchema.parse(legacy).model, 'MiniMax-H3')
    f.db.connection.prepare('UPDATE production_batches SET data=? WHERE id=?').run(JSON.stringify({ ...batch, nativeVideo: legacy }), batch.id)
    assert.throws(() => f.batch.authorize(f.project.id, batch.id, 1, 20, null), /原执行配置/)
    const before = f.db.connection.prepare('SELECT data FROM production_batches WHERE id=?').get(batch.id)!.data
    f.restart()
    assert.equal(f.db.connection.prepare('SELECT data FROM production_batches WHERE id=?').get(batch.id)!.data, before)
    assert.equal(f.server.counts.submit, 0)
  } finally { await f.close() }
})

test('Broker selects one whole-scope compatible adapter; frame and prompt limits remain adapter-owned', async () => {
  const f = await fixture('reference', 1), h3 = await compshareServer()
  try {
    f.video.register(new CompShareMiniMaxH3Adapter({ adapter: 'compshare-minimax-h3', toolId: 'compshare.minimax-h3', modelId: 'MiniMax-H3', credentialRef: null }, async () => 'LOCAL_ONLY', new ImageHttpTransport({ fixtureOrigin: h3.origin })))
    const initial = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
    assert.equal(initial.nativeVideo!.toolId, 'compshare.minimax-h3')
    const input = initial.nativeVideo!.items[0].input
    const longer = await f.video.planBatch([{ ...input, durationSeconds: 1, prompt: 'x'.repeat(8000) }])
    assert.equal(longer.toolId, 'reference.video')
    assert.equal(longer.inputs[0].durationSeconds, 1)
    const frames = await f.video.planBatch([{ ...input, mode: 'image-to-video', firstFrameAssetVersionId: randomUUID(), lastFrameAssetVersionId: randomUUID() }])
    assert.equal(frames.toolId, 'compshare.minimax-h3')
    assert.equal(f.server.counts.submit + h3.counts.submit, 0)
  } finally { await f.close(); await h3.close() }
})

test('persisted scheduler honors the second adapter concurrency of two, not H3 global serial semantics', async () => {
  const f = await fixture('reference', 1)
  try {
    const other = new VideoBatchService(f.video)
    const prepared = await prepareTechnical(f.batch, f.project.id, f.shots.slice(0, 3).map(s => s.id))
    f.batch.authorize(f.project.id, prepared.id, 1, 3, null)
    f.local!.setMode('always-running')
    await f.batch.tick()
    let items = f.batch.get(f.project.id, prepared.id).nativeVideo!.items
    await f.video.wait(items[0].taskId!)
    await Promise.all([f.batch.tick(), other.tick()])
    items = f.batch.get(f.project.id, prepared.id).nativeVideo!.items
    await f.video.wait(items[1].taskId!)
    await Promise.all([f.batch.tick(), other.tick()])
    items = f.batch.get(f.project.id, prepared.id).nativeVideo!.items
    assert.equal(f.server.counts.submit, 2)
    assert.equal(items.filter(i => i.taskId).length, 2)
    assert.equal(items[2].status, 'queued')
    assert.notEqual(items[0].taskId, items[1].taskId)
    f.batch.pause(f.project.id, prepared.id)
  } finally { await f.close() }
})

test('reference adapter uses the same character, scene and keyframe approval gates, including revocation', async () => {
  const f = await fixture('reference', 1)
  try {
    const shot = f.shots[0], projectId = f.project.id
    await assert.rejects(f.batch.prepare(projectId, [shot.id]), /主参考/)
    const path = join(f.root, 'frame.png')
    await writeFile(path, await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ccaa88' } }).png().toBuffer())
    for (const id of [...shot.characterIds, shot.locationId!]) {
      const target = f.video.generation.entity(projectId, id)
      const version = await f.visual.importFile(projectId, path, 'local main reference', null)
      f.visual.review(projectId, version.id, version.revision, 'approved', id, target.revision)
    }
    await assert.rejects(f.batch.prepare(projectId, [shot.id]), /关键帧/)
    const frame = await f.visual.importFile(projectId, path, 'local approved keyframe', null)
    f.visual.review(projectId, frame.id, frame.revision, 'approved', shot.id, shot.revision)
    const prepared = await f.batch.prepare(projectId, [shot.id])
    assert.equal(prepared.nativeVideo!.items[0].input.firstFrameAssetVersionId, frame.id)
    f.batch.authorize(projectId, prepared.id, 1, 1, null)
    const location = f.video.generation.entity(projectId, shot.locationId!)
    assert.equal(location.kind, 'location')
    if (location.kind !== 'location') throw new Error('location expected')
    f.db.connection.prepare("UPDATE entities SET data=json_set(data,'$.revision',?,'$.visualReferences',json('[]')) WHERE id=?").run(location.revision + 1, location.id)
    await f.batch.tick()
    assert.equal(f.batch.get(projectId, prepared.id).nativeVideo!.items[0].status, 'failed')
    assert.equal(f.server.counts.submit, 0)
  } finally { await f.close() }
})

test('pre-policy H3 configuration can still be reconstructed byte-for-byte for historical bound recovery', async () => {
  const f = await fixture()
  try {
    const legacy = () => new CompShareMiniMaxH3Adapter({ adapter: 'compshare-minimax-h3', toolId: 'compshare.minimax-h3', modelId: 'MiniMax-H3', credentialRef: null }, async () => 'sk-ml-FIXTURE_ONLY', new ImageHttpTransport({ fixtureOrigin: f.server.origin, timeoutMs: 500 }), null, null)
    const initial = await prepareTechnical(f.batch, f.project.id, [f.shots[0].id])
    f.video.registry.unregister('compshare.minimax-h3', '1.0.0')
    f.video.register(legacy())
    const preview = await f.video.preview(initial.nativeVideo!.items[0].input)
    f.server.setMode('status-500')
    const task = f.video.confirm(f.project.id, preview.id, 20000000, true)
    await f.video.wait(task.id)
    const original = f.video.bindings.get(f.video.generation.findByTask(f.project.id, task.id)!)
    assert(!('batchPolicy' in original.configuration.profile))
    f.restart()
    f.video.bindings.resolver = async config => {
      const adapter = legacy()
      assert.equal(configurationHash(f.video.bindings.describe(adapter)), configurationHash(config))
      return adapter
    }
    f.server.setMode('ok')
    const result = await f.video.query(f.project.id, task.id)
    assert.equal(result.record.outcome, 'succeeded')
    assert.equal(f.server.counts.submit, 1)
  } finally { await f.close() }
})
