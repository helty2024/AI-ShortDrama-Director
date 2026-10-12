import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { CompShareMiniMaxH3Adapter, compshareProfileSchema } from '../../electron/main/tools/adapters/compshare-minimax-h3.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'
import { requestFingerprint } from '../../electron/main/tools/fingerprint.js'
import { ToolRegistry } from '../../electron/main/tools/registry.js'
import { toolReadiness } from '../../electron/main/tools/readiness.js'
import { videoApiCommandSchema } from '../../src/shared/video-api.js'
import type { ToolExecutionContext } from '../../src/shared/tools.js'
import type { VideoTextToVideoInput } from '../../src/shared/capabilities/video.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { VideoApiGenerationService } from '../../electron/main/generation/video-api-service.js'
import { importCompShareCredential, loadVideoProfiles, videoAdapters } from '../../electron/main/generation/video-profiles.js'
import { compshareServer } from '../fixtures/compshare-http.js'

const profile = { adapter: 'compshare-minimax-h3' as const, toolId: 'compshare.minimax-h3' as const, modelId: 'MiniMax-H3' as const, credentialRef: null }
const input: VideoTextToVideoInput = { prompt: 'A blue sea', negativePrompt: '', durationSeconds: 4, fps: 24, resolution: { width: 480, height: 480 }, aspectRatio: '1:1', seed: null, outputMime: 'video/mp4', audio: 'none' }
function context(value: VideoTextToVideoInput = input): ToolExecutionContext {
  return { projectId: randomUUID(), taskId: randomUUID(), estimateId: randomUUID(), approvalId: randomUUID(), model: profile.modelId, routingDecisionId: null,
    requestFingerprint: requestFingerprint({ fingerprintVersion: '1', snapshot: { capability: 'video.textToVideo', contractVersion: '1.0.0', input: value }, toolId: profile.toolId, toolVersion: '1.0.0', model: profile.modelId, sourceRevisions: {}, routing: null }) }
}
async function fixture() {
  const server = await compshareServer()
  const adapter = new CompShareMiniMaxH3Adapter(profile, async () => 'sk-ml-FIXTURE_ONLY', new ImageHttpTransport({ fixtureOrigin: server.origin, timeoutMs: 500 }))
  const directory = await mkdtemp(join(tmpdir(), 'h3-service-test-'))
  const path = join(directory, 'workspace.sqlite')
  const database = new ProjectDatabase(path)
  let closed = false
  const closeDatabase = () => { if (!closed) { database.close(); closed = true } }
  const project = database.create({ name: 'H3 fixture', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '1:1' })
  database.insertEntities(project.id, buildSeed(project.id))
  const target = database.workspace(project.id).entities.find(e => e.kind === 'shot')!
  const visual = new VisualRepository(new IntelligenceRepository(database), new MediaStorage(join(directory, 'media')))
  const service = new VideoApiGenerationService(visual, [adapter])
  const previewInput = { projectId: project.id, targetId: target.id, toolId: profile.toolId, mode: 'text-to-video' as const, prompt: input.prompt, durationSeconds: 4, fps: 24, resolution: input.resolution, aspectRatio: input.aspectRatio, seed: null, firstFrameAssetVersionId: null, lastFrameAssetVersionId: null, allowAssetUpload: true, localOnly: false }
  return { server, adapter, directory, path, database, closeDatabase, project, target, visual, service, previewInput, close: async () => { closeDatabase(); await server.close(); await rm(directory, { recursive: true, force: true }) } }
}
const signal = () => AbortSignal.timeout(10000)

test('production H3 has hard non-paid gate even with approval, credential and authorized inputs', async () => {
  let reads = 0
  const adapter = new CompShareMiniMaxH3Adapter(profile, async () => { reads++; return 'sk-ml-FIXTURE_ONLY' })
  const ctx = context()
  adapter.authorizeInputs(ctx, { frames: [], ingest: async () => { throw new Error() }, billing: () => { throw new Error() }, diagnostic: () => {} })
  await assert.rejects(adapter.submit('video.textToVideo', input, ctx, signal()), error => Boolean(error && typeof error === 'object' && 'sent' in error && error.sent === false))
  assert.equal(reads, 0)
  assert.equal((await adapter.health(signal())).availability, 'unknown')
  assert.equal(adapter.generationEnabled, false)
  assert.ok(adapter.describe().capabilities.every(c => c.seed === 'unsupported'))
  assert.throws(() => new CompShareMiniMaxH3Adapter(profile, async () => '', new ImageHttpTransport({ fixtureOrigin: 'https://cp.compshare.cn' })))
})

test('native preview/estimate are side-effect free; disallowed parameters cannot be silently omitted', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.adapter.validate('video.textToVideo', input, context(), signal())).valid, true)
    const estimate = await f.adapter.estimate('video.textToVideo', input, context(), signal())
    assert.equal(estimate.cost.status, 'unknown'); assert.doesNotMatch(estimate.basis, /Reference/)
    for (const value of [{ ...input, seed: 42 }, { ...input, negativePrompt: 'no rain' }, { ...input, durationSeconds: 3 }, { ...input, durationSeconds: 4.5 }, { ...input, durationSeconds: 31 }, { ...input, resolution: { width: 640, height: 480 } }, { ...input, prompt: 'a'.repeat(7001) }, { ...input, audio: 'generated' as const }])
      assert.equal((await f.adapter.validate('video.textToVideo', value, context(value), signal())).valid, false)
    await f.service.preview(f.previewInput)
    assert.deepEqual(f.server.counts, { submit: 0, query: 0, download: 0, cancel: 0, probe: 0 })
  } finally { await f.close() }
})

test('native JSON → one async submit → real MP4 probe → candidate → review/adopt; points never settle currency', async () => {
  const f = await fixture()
  try {
    const preview = await f.service.preview(f.previewInput)
    const task = f.service.confirm(f.project.id, preview.id, 100, true)
    await f.service.wait(task.id)
    const result = await f.service.query(f.project.id, task.id)
    assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
    assert.equal(f.server.counts.submit, 1)
    assert.deepEqual(f.server.body(), { model: 'MiniMax-H3', content: [{ type: 'text', text: input.prompt }], resolution: '480P', duration: 4, ratio: '1:1', mute_audio: true, use_context_ir: false })
    assert.equal(result.versions.length, 1)
    assert.equal(result.versions[0]!.width, 480); assert.equal(result.versions[0]!.height, 480)
    assert.equal(result.versions[0]!.status, 'draft')
    assert.equal(result.record.actualCost, null)
    assert.notEqual(result.reservationStatus, 'consumed')
    assert.deepEqual(f.server.downloadAuth, [undefined])
    assert.doesNotMatch(JSON.stringify(result), /signature=|sk-ml-|SECRET|base64/)
    const adopted = f.service.review(f.project.id, result.versions[0]!.id, result.versions[0]!.revision, true, f.target.revision)
    const shot = f.visual.repo.entity(f.project.id, f.target.id)
    assert.ok(shot.kind === 'shot' && shot.confirmedVideoAssetVersionId === adopted.id)
  } finally { await f.close() }
})

test('image input maps only owned first/last frames to native Data URLs', async () => {
  const f = await fixture()
  try {
    const image = await sharp({ create: { width: 480, height: 480, channels: 3, background: '#111111' } }).png().toBuffer()
    const path = join(f.directory, 'frame.png'); await writeFile(path, image)
    const first = await f.visual.importFile(f.project.id, path, 'first', null)
    const last = await f.visual.importFile(f.project.id, path, 'last', null)
    const value = { ...f.previewInput, mode: 'image-to-video' as const, firstFrameAssetVersionId: first.id, lastFrameAssetVersionId: last.id }
    await assert.rejects(f.service.preview({ ...value, allowAssetUpload: false }))
    assert.equal(f.server.counts.submit, 0)
    const preview = await f.service.preview(value)
    const task = f.service.confirm(f.project.id, preview.id, 100, true)
    await f.service.wait(task.id)
    const body = f.server.body() as { content: { type: string; role?: string; image_url?: { url: string } }[] }
    assert.deepEqual(body.content.map(c => c.role ?? c.type), ['text', 'first_frame', 'last_frame'])
    assert.ok(body.content.slice(1).every(c => c.image_url?.url.startsWith('data:image/png;base64,')))
    assert.doesNotMatch(JSON.stringify(body), /assetVersionId|protocol|frames|fps|seed/)
  } finally { await f.close() }
})

for (const mode of ['unknown-submit', 'malformed-submit'] as const) test(`${mode}: submission stays unknown and cannot resubmit`, async () => {
  const f = await fixture()
  try {
    f.server.setMode(mode)
    const preview = await f.service.preview(f.previewInput)
    const task = f.service.confirm(f.project.id, preview.id, 100, true)
    await f.service.wait(task.id)
    const result = await f.service.query(f.project.id, task.id)
    assert.equal(result.record.outcome, 'unknown-submission')
    assert.equal(result.reservationStatus, 'pending-unknown')
    assert.equal(result.versions.length, 0)
    assert.throws(() => f.service.confirm(f.project.id, preview.id, 100, true))
    assert.equal(f.server.counts.submit, 1)
    assert.doesNotMatch(JSON.stringify(result), /SECRET|sk-ml-/)
  } finally { await f.close() }
})

test('restart recovery queries persisted task ID and never submits again', async () => {
  const f = await fixture()
  let reopened: ProjectDatabase | null = null
  try {
    f.server.setMode('status-500')
    const preview = await f.service.preview(f.previewInput)
    const task = f.service.confirm(f.project.id, preview.id, 100, true)
    await f.service.wait(task.id)
    const before = await f.service.query(f.project.id, task.id)
    assert.equal(before.task.providerTaskId, 'remote-h3-1')
    f.closeDatabase()
    reopened = new ProjectDatabase(f.path)
    const visual = new VisualRepository(new IntelligenceRepository(reopened), new MediaStorage(join(f.directory, 'media')))
    const adapter = new CompShareMiniMaxH3Adapter(profile, async () => 'sk-ml-FIXTURE_ONLY', new ImageHttpTransport({ fixtureOrigin: f.server.origin }))
    const service = new VideoApiGenerationService(visual, [adapter])
    f.server.setMode('ok')
    await service.query(f.project.id, task.id); await service.wait(task.id)
    const after = await service.query(f.project.id, task.id)
    assert.equal(after.task.status, 'succeeded')
    assert.equal(after.record.id, before.record.id)
    assert.equal(f.server.counts.submit, 1)
    assert.equal(service.generation.list('generation_records', f.project.id).length, 1)
  } finally { reopened?.close(); await f.close() }
})

for (const mode of ['failed', 'cancelled', 'malformed-status', 'wrong-id', 'missing-url', 'status-401', 'status-429', 'status-500', 'html', 'truncated', 'unsafe-url'] as const) test(`native ${mode} cannot produce an adopted output or a second submit`, async () => {
  const f = await fixture()
  try {
    f.server.setMode(mode)
    const preview = await f.service.preview(f.previewInput)
    const task = f.service.confirm(f.project.id, preview.id, 100, true)
    await f.service.wait(task.id)
    const result = await f.service.query(f.project.id, task.id)
    assert.equal(result.versions.length, 0)
    assert.notEqual(result.task.status, 'succeeded')
    assert.equal(f.server.counts.submit, 1)
    assert.notEqual(result.reservationStatus, 'released')
    assert.doesNotMatch(JSON.stringify(result), /SECRET|sk-ml-|signature=/)
  } finally { await f.close() }
})

test('queued/running status, asynchronous cancel and handle ownership use native semantics', async () => {
  const f = await fixture()
  try {
    const ctx = context()
    f.adapter.authorizeInputs(ctx, { frames: [], ingest: async () => { throw new Error() }, billing: () => {}, diagnostic: () => {} })
    const submitted = await f.adapter.submit('video.textToVideo', input, ctx, signal())
    assert.equal(submitted.state, 'accepted')
    if (submitted.state !== 'accepted') throw new Error()
    const handle = submitted.handle
    for (const mode of ['queued', 'running'] as const) {
      f.server.setMode(mode)
      assert.deepEqual(await f.adapter.status(handle, signal()), { state: mode, progress: null })
    }
    const queries = f.server.counts.query
    await assert.rejects(f.adapter.status({ ...handle, toolId: 'outsider' }, signal()))
    assert.equal(f.server.counts.query, queries)
    f.server.setMode('cancel-running')
    assert.equal((await f.adapter.cancel(handle, signal())).state, 'unknown')
    f.server.setMode('ok')
    assert.equal((await f.adapter.cancel(handle, signal())).state, 'cancelled')
    assert.equal(f.server.counts.submit, 1)
  } finally { await f.close() }
})

for (const mode of ['ok', 'probe-401', 'probe-malformed'] as const) test(`read-only probe ${mode} never creates generation/task/cost or leaks provider data`, async () => {
  const f = await fixture()
  try {
    f.server.setMode(mode)
    const result = await f.adapter.probe(signal())
    assert.equal(result.authenticated, mode === 'ok')
    assert.equal(result.generationEnabled, false)
    if (mode === 'ok') assert.deepEqual(result.points, { total: 100, reserved: 20, available: 80 })
    assert.equal(f.server.counts.submit, 0)
    assert.equal(f.service.generation.list('generation_records', f.project.id).length, 0)
    assert.doesNotMatch(JSON.stringify(result), /SECRET|sk-ml-|signature=/)
  } finally { await f.close() }
})

test('configuration persists only credential reference; restart stays non-executable and readiness stays honest', async () => {
  const f = await fixture()
  try {
    const profileFile = join(f.directory, 'video-api-profiles.json'), keyFile = join(f.directory, 'secret.key')
    await writeFile(keyFile, 'sk-ml-FIXTURE_ONLY')
    const secrets = new Map<string, string>()
    const credentials = { get: async (id: string) => secrets.get(id)!, set: async (id: string, secret: string) => { secrets.set(id, secret) }, has: async (id: string) => secrets.has(id) }
    const service = new VideoApiGenerationService(f.visual, [])
    await importCompShareCredential(profileFile, keyFile, credentials, service)
    const stored = await readFile(profileFile, 'utf8')
    assert.doesNotMatch(stored, /sk-ml-|endpoint|baseEndpoint|generationEnabled/)
    assert.equal(secrets.size, 1)
    await assert.rejects(importCompShareCredential(profileFile, keyFile, credentials, service))
    const adapters = videoAdapters(await loadVideoProfiles(profileFile), credentials)
    const restored = new VideoApiGenerationService(f.visual, adapters)
    assert.deepEqual(restored.profiles(), [])
    assert.equal(restored.configuration()[0]!.generationEnabled, false)
    await assert.rejects(restored.preview(f.previewInput))
    assert.equal(restored.generation.list('prompt_packages', f.project.id).length, 0)
    const registry = new ToolRegistry(); registry.register(adapters[0]!)
    const row = (await toolReadiness([registry], async () => true)).find(r => r.toolId === profile.toolId)!
    assert.equal(row.validation, 'simulated-validated'); assert.equal(row.runtime, 'configured-unverified')
    assert.equal(f.server.counts.submit, 0)
    await writeFile(profileFile, JSON.stringify([{ ...profile, baseEndpoint: f.server.origin }]))
    assert.deepEqual(await loadVideoProfiles(profileFile), [])
  } finally { await f.close() }
})

test('concurrent import writes once and malformed existing configuration is preserved', async () => {
  const f = await fixture()
  try {
    const path = join(f.directory, 'video-profiles.json'), key = join(f.directory, 'secret.key')
    await writeFile(key, 'sk-ml-FIXTURE_ONLY')
    let writes = 0
    const credentials = { get: async () => 'sk-ml-FIXTURE_ONLY', set: async () => { writes++ }, has: async () => true }
    const service = new VideoApiGenerationService(f.visual, [])
    const results = await Promise.allSettled([importCompShareCredential(path, key, credentials, service), importCompShareCredential(path, key, credentials, service)])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(writes, 1)
    const malformed = join(f.directory, 'unsupported-profiles.json')
    await writeFile(malformed, '{user config invalid}')
    await assert.rejects(importCompShareCredential(malformed, key, credentials, new VideoApiGenerationService(f.visual, [])))
    assert.equal(await readFile(malformed, 'utf8'), '{user config invalid}')
    assert.equal(writes, 1)
  } finally { await f.close() }
})

test('IPC and native profile schemas reject arbitrary paths, endpoints, secrets and paid toggles', () => {
  for (const value of [{ ...profile, baseEndpoint: 'https://attacker.test' }, { ...profile, apiKey: 'SECRET' }, { ...profile, generationEnabled: true }, { ...profile, modelId: 'MiniMax-H3-Max' }]) assert.equal(compshareProfileSchema.safeParse(value).success, false)
  for (const value of [{ op: 'importCompShareCredential', path: 'C:/secret' }, { op: 'probe', toolId: profile.toolId, endpoint: 'https://attacker.test' }, { op: 'probe', toolId: 'reference.video' }]) assert.equal(videoApiCommandSchema.safeParse(value).success, false)
})
