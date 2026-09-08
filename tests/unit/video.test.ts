import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  randomUUID,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { MockTextProvider } from '../../electron/main/intelligence/mock-provider.js'
import { AITaskQueue } from '../../electron/main/intelligence/queue.js'
import { buildSeed } from '../../electron/main/seed.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { VisualService } from '../../electron/main/visual/service.js'
import { ImageTaskExecutor } from '../../electron/main/visual/executor.js'
import {
  ProductionMediaExecutor,
  VideoTaskExecutor,
} from '../../electron/main/video/executor.js'
import type { VideoFactory } from '../../electron/main/video/executor.js'
import { ProductionService } from '../../electron/main/video/service.js'
import {
  MockVideoProvider,
  SeedanceVideoProvider,
  validateVideoUrl,
  validateDownloadUrl,
} from '../../electron/main/video/providers.js'
import type { VideoInputs } from '../../electron/main/video/providers.js'
import { EncryptedCredentialStore } from '../../electron/main/video/credentials.js'
import type { CredentialStore } from '../../electron/main/video/credentials.js'
import { probeVideo } from '../../electron/main/video/ffmpeg.js'
import { compileShotVideoPrompt } from '../../electron/main/video/compiler.js'
import { diagnoseComfy } from '../../electron/main/visual/diagnostics.js'
import { builtinTemplates } from '../../electron/main/visual/workflows.js'
import {
  defaultVideoProfile,
  videoPromptSchema,
  videoProfileSchema,
  batchSchema,
} from '../../src/shared/video.js'
import type { VideoGenerationRequest } from '../../src/shared/video.js'
import { defaultProviderSettings } from '../../src/shared/visual.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import { migrateIntelligence } from '../../electron/main/intelligence/migration.js'
import { migrateVisual } from '../../electron/main/visual/migration.js'
const memorySecrets: CredentialStore = {
  async get() {
    return 'unit-key'
  },
  async set() {},
  async has() {
    return true
  },
}
class CountingProvider extends MockVideoProvider {
  submissions = 0
  uncertain = false
  async submit(r: VideoGenerationRequest, i: VideoInputs, s: AbortSignal) {
    this.submissions++
    if (this.uncertain) throw Error('submit response lost')
    return super.submit(r, i, s)
  }
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'director-video-')),
    db = new ProjectDatabase(join(dir, 'workspace.sqlite')),
    project = db.seed(buildSeed),
    repo = new IntelligenceRepository(db),
    visual = new VisualRepository(repo, new MediaStorage(join(dir, 'media'))),
    provider = new CountingProvider(
      join(dir, 'work'),
      defaultVideoProfile.capabilities,
    ),
    factory: VideoFactory = () => provider,
    executor = new VideoTaskExecutor(visual, factory),
    queue = new AITaskQueue(
      repo,
      new MockTextProvider(),
      new ProductionMediaExecutor(new ImageTaskExecutor(visual), executor),
    ),
    images = new VisualService(visual, queue, {
      images: async () => [],
      workflow: async () => null,
    }),
    service = new ProductionService(
      visual,
      images,
      queue,
      memorySecrets,
      factory,
      { credential: async () => null, video: async () => null },
    )
  return {
    dir,
    db,
    project,
    repo,
    visual,
    provider,
    factory,
    executor,
    queue,
    service,
    close: async () => {
      queue.close()
      await delay(80)
      db.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
async function keyframe(app: Awaited<ReturnType<typeof setup>>) {
  const shot = app.db
    .workspace(app.project.id)
    .entities.find((e) => e.kind === 'shot')!
  const path = join(app.dir, 'frame.png')
  await writeFile(
    path,
    await sharp({
      create: { width: 128, height: 128, channels: 3, background: '#445566' },
    })
      .png()
      .toBuffer(),
  )
  const version = await app.visual.importFile(
    app.project.id,
    path,
    '首帧',
    null,
  )
  app.visual.review(
    app.project.id,
    version.id,
    version.revision,
    'approved',
    shot.id,
    shot.revision,
  )
  return {
    shot: app.repo.entity(app.project.id, shot.id),
    version: app.visual.version(app.project.id, version.id),
  }
}
function params(app: Awaited<ReturnType<typeof setup>>, shotId: string) {
  return {
    projectId: app.project.id,
    shotId,
    profileId: defaultVideoProfile.id,
    assetId: null,
    duration: 1,
    resolution: '480p' as const,
    seed: 42,
    endFrameVersionId: null,
    actionOverride: null,
    costAccepted: false,
  }
}
async function settle(app: Awaited<ReturnType<typeof setup>>, id: string) {
  for (let i = 0; i < 1000; i++) {
    const t = app.repo.task(app.project.id, id)
    if (!['running', 'queued'].includes(t.status)) return t
    await delay(10)
  }
  throw Error('timeout')
}
async function generate(
  app: Awaited<ReturnType<typeof setup>>,
  shotId: string,
) {
  return aiTaskSchema.parse(
    await app.service.execute({
      ...params(app, shotId),
      operation: 'video.generate',
    }),
  )
}

test('Video compiler requires approved keyframe and describes time, motion, performance and continuity', async () => {
  const app = await setup()
  try {
    const old = app.db
      .workspace(app.project.id)
      .entities.find((e) => e.kind === 'shot')!
    if (old.kind !== 'shot') throw Error()
    assert.throws(
      () => compileShotVideoPrompt(old, [], defaultVideoProfile, '9:16', 1),
      /关键帧/,
    )
    const { shot, version } = await keyframe(app)
    if (shot.kind !== 'shot') throw Error()
    const prompt = compileShotVideoPrompt(
      {
        ...shot,
        direction: {
          ...shot.direction,
          startState: '坐在桌旁',
          action: '缓慢抬头',
          endState: '看向门口',
          subjectMovement: '起身',
          performance: '克制',
          cameraMovement: '推近',
        },
      },
      app.db.workspace(app.project.id).entities,
      defaultVideoProfile,
      '9:16',
      1,
    )
    assert.equal(prompt.startFrameAssetVersionId, version.id)
    assert.match(prompt.action, /坐在桌旁.*缓慢抬头.*看向门口/)
    assert.equal(prompt.cameraMovement, '推近')
    assert.equal(prompt.performance, '克制')
    assert.equal(
      videoPromptSchema.safeParse({
        ...prompt,
        startFrameAssetVersionId: 'bad',
      }).success,
      false,
    )
    assert.throws(
      () => compileShotVideoPrompt(shot, [], defaultVideoProfile, '9:16', 59),
      /不支持/,
    )
  } finally {
    await app.close()
  }
})

test('Mock video goes through submit/status/result, FFprobe, draft review and explicit Shot confirm', async () => {
  const app = await setup()
  try {
    const { shot } = await keyframe(app)
    await app.provider.healthCheck()
    const task = await generate(app, shot.id),
      done = await settle(app, task.id)
    assert.equal(done.status, 'succeeded', done.error?.message)
    const v = app.visual.version(app.project.id, done.resultIds[0]!)
    assert.equal(v.mimeType, 'video/mp4')
    assert.equal(v.duration, 1)
    assert.equal(v.fps, 12)
    assert.equal(v.codec, 'h264')
    assert.equal(v.status, 'draft')
    assert.equal(v.sourceKeyframeVersionIds.length, 1)
    assert.equal(done.costMetadata.actualCost, null)
    let s = app.repo.entity(app.project.id, shot.id)
    assert.equal(s.kind === 'shot' && s.confirmedVideoAssetVersionId, null)
    const approved = app.visual.review(
      app.project.id,
      v.id,
      v.revision,
      'approved',
      null,
      null,
    )
    s = app.repo.entity(app.project.id, shot.id)
    assert.equal(s.kind === 'shot' && s.confirmedVideoAssetVersionId, null)
    app.visual.review(
      app.project.id,
      v.id,
      approved.revision,
      'approved',
      shot.id,
      s.revision,
    )
    s = app.repo.entity(app.project.id, shot.id)
    assert.equal(s.kind === 'shot' && s.confirmedVideoAssetVersionId, v.id)
    assert.match(
      await app.visual.media(app.project.id, v.id, false),
      /^data:video\/mp4/,
    )
    const file = join(app.dir, 'copy.mp4')
    await writeFile(file, await app.visual.storage.read(v.storageKey))
    assert.equal((await probeVideo(file)).duration, 1)
  } finally {
    await app.close()
  }
})

test('Mock MP4 is deterministic and validates video storage / import MIME and hash', async () => {
  const app = await setup()
  try {
    const { shot } = await keyframe(app),
      t = await generate(app, shot.id),
      done = await settle(app, t.id),
      v = app.visual.version(app.project.id, done.resultIds[0]!)
    if (t.input.type !== 'shot-video') throw Error()
    const first = app.visual.version(
        app.project.id,
        t.input.request.prompt.startFrameAssetVersionId,
      ),
      inputs = {
        start: await app.visual.storage.read(first.storageKey),
        startMime: first.mimeType,
      }
    const bytes = await app.provider.fetchResult(
      done.providerTaskId!,
      { status: 'succeeded', progress: 1 },
      t.input.request,
      inputs,
      new AbortController().signal,
    )
    const stored = await app.visual.storage.storeVideo(
      app.project.id,
      randomUUID(),
      bytes,
    )
    assert.equal(stored.hash, v.hash)
    await assert.rejects(
      app.visual.storage.storeVideo(
        app.project.id,
        randomUUID(),
        Buffer.from('not video'),
      ),
      /MP4/,
    )
    const file = join(app.dir, 'import.mp4')
    await writeFile(file, bytes)
    const importer = new ProductionService(
      app.visual,
      new VisualService(app.visual, app.queue, {
        images: async () => [],
        workflow: async () => null,
      }),
      app.queue,
      memorySecrets,
      app.factory,
      { credential: async () => null, video: async () => file },
    )
    const imported = await importer.execute({
      operation: 'video.import',
      projectId: app.project.id,
    })
    assert.ok(
      imported &&
        typeof imported === 'object' &&
        'hash' in imported &&
        imported.hash === v.hash,
    )
  } finally {
    await app.close()
  }
})

test('download/persistence retry queries existing remote task and never resubmits', async () => {
  const app = await setup()
  try {
    const { shot } = await keyframe(app),
      store = app.visual.storage.storeVideo.bind(app.visual.storage)
    let fail = true
    app.visual.storage.storeVideo = async (...args) => {
      if (fail) throw Error('disk full')
      return store(...args)
    }
    const task = await generate(app, shot.id),
      failed = await settle(app, task.id)
    assert.equal(failed.status, 'failed')
    assert.ok(failed.providerTaskId)
    assert.equal(app.provider.submissions, 1)
    fail = false
    app.queue.retry(app.project.id, task.id)
    const done = await settle(app, task.id)
    assert.equal(done.status, 'succeeded', done.error?.message)
    assert.equal(app.provider.submissions, 1)
  } finally {
    await app.close()
  }
})

test('ambiguous submit is guarded by durable intent receipt even on explicit retry', async () => {
  const app = await setup()
  try {
    const { shot } = await keyframe(app)
    app.provider.uncertain = true
    const task = await generate(app, shot.id)
    assert.equal((await settle(app, task.id)).status, 'failed')
    app.provider.uncertain = false
    app.queue.retry(app.project.id, task.id)
    const retry = await settle(app, task.id)
    assert.equal(retry.status, 'failed')
    assert.match(retry.error?.message ?? '', /未知/)
    assert.equal(app.provider.submissions, 1)
  } finally {
    await app.close()
  }
})

test('receipt recovers remote ID after database callback failure', async () => {
  const app = await setup()
  try {
    app.queue.close()
    const { shot } = await keyframe(app)
    const queue = new AITaskQueue(
      app.repo,
      new MockTextProvider(),
      app.executor,
    )
    queue.close()
    const asset = app.db.createDraft({
      projectId: app.project.id,
      kind: 'asset',
      name: 'receipt',
    })
    const request = {
      provider: 'mock-video' as const,
      profile: defaultVideoProfile,
      prompt: videoPromptSchema.parse(
        await app.service.execute({
          ...params(app, shot.id),
          operation: 'video.compile',
        }),
      ),
      resolution: '480p' as const,
      seed: 42,
      referenceVersionIds: [],
      providerOptions: {},
    }
    const task = aiTaskSchema.parse({
      ...metadata(),
      projectId: app.project.id,
      input: {
        type: 'shot-video',
        targetId: shot.id,
        assetId: asset.id,
        request,
      },
      status: 'running',
      attempt: 1,
      error: null,
      resultIds: [],
      sourceRevisions: {},
    })
    await assert.rejects(
      app.executor.execute(task, new AbortController().signal, () => {
        throw Error('sqlite unavailable')
      }),
    )
    assert.equal(app.provider.submissions, 1)
    await assert.rejects(
      app.executor.execute(task, new AbortController().signal, () => {
        throw Error('still unavailable')
      }),
    )
    assert.equal(app.provider.submissions, 1)
  } finally {
    await app.close()
  }
})

test('cancelled remote video remains same ID on retry; it cannot create a new paid task', async () => {
  const app = await setup()
  try {
    const { shot } = await keyframe(app),
      task = await generate(app, shot.id)
    for (
      let i = 0;
      i < 100 && !app.repo.task(app.project.id, task.id).providerTaskId;
      i++
    )
      await delay(5)
    const id = app.repo.task(app.project.id, task.id).providerTaskId
    assert.ok(id)
    app.queue.cancel(app.project.id, task.id)
    await delay(100)
    assert.equal(
      app.visual
        .versions(app.project.id)
        .filter((v) => v.mimeType === 'video/mp4').length,
      0,
    )
    const retry = app.queue.retry(app.project.id, task.id)
    assert.equal(retry.providerTaskId, id)
    const result = await settle(app, task.id)
    assert.equal(result.status, 'failed')
    assert.equal(app.provider.submissions, 1)
  } finally {
    await app.close()
  }
})

test('restart restores a submitted video by remote ID without calling submit again', async () => {
  const app = await setup()
  try {
    const { shot } = await keyframe(app),
      task = await generate(app, shot.id)
    for (
      let i = 0;
      i < 100 && !app.repo.task(app.project.id, task.id).providerTaskId;
      i++
    )
      await delay(5)
    app.queue.close()
    await delay(60)
    const queue = new AITaskQueue(
      app.repo,
      new MockTextProvider(),
      app.executor,
    )
    try {
      const done = await settle(app, task.id)
      assert.equal(done.status, 'succeeded', done.error?.message)
      assert.equal(app.provider.submissions, 1)
    } finally {
      queue.close()
    }
  } finally {
    await app.close()
  }
})

test('batch keyframes are independent and preparation failure does not block following shots', async () => {
  const app = await setup()
  try {
    const shots = app.db
      .workspace(app.project.id)
      .entities.filter((e) => e.kind === 'shot')
    const group = batchSchema.parse(
      await app.service.execute({
        operation: 'batch.start',
        projectId: app.project.id,
        shotIds: [shots[0]!.id, randomUUID(), shots[1]!.id],
        provider: 'mock-image',
      }),
    )
    assert.equal(group.entries.length, 3)
    assert.ok(group.entries[1]!.error)
    for (const e of group.entries.filter((e) => e.taskId)) {
      const done = await settle(app, e.taskId!)
      assert.equal(done.status, 'succeeded')
      const v = app.visual.version(app.project.id, done.resultIds[0]!)
      assert.equal(v.metadata.targetId, e.shotId)
      assert.equal(v.status, 'draft')
    }
    const versions = app.visual.versions(app.project.id)
    assert.notEqual(versions[0]!.assetId, versions[1]!.assetId)
  } finally {
    await app.close()
  }
})

test('Comfy diagnostics detects missing nodes, inputs, checkpoints and output before submission', async () => {
  const config = {
    ...defaultProviderSettings,
    provider: 'comfyui' as const,
    checkpoint: 'test.safetensors',
  }
  const info: Record<string, unknown> = {}
  for (const node of Object.values(builtinTemplates[0]!.workflow))
    info[node.class_type] = {
      input: { required: {} },
      output_node: node.class_type === 'SaveImage',
    }
  info.CheckpointLoaderSimple = {
    input: { required: { ckpt_name: [['test.safetensors']] } },
  }
  const fetcher: typeof fetch = async (url) =>
    new Response(
      JSON.stringify(String(url).endsWith('/system_stats') ? {} : info),
    )
  assert.equal(
    (await diagnoseComfy(config, builtinTemplates[0]!, fetcher)).ready,
    true,
  )
  delete info.KSampler
  const d = await diagnoseComfy(config, builtinTemplates[0]!, fetcher)
  assert.equal(d.ready, false)
  assert.ok(d.missingNodes.includes('KSampler'))
  const missing = await diagnoseComfy(
    { ...config, checkpoint: 'missing' },
    builtinTemplates[0]!,
    fetcher,
  )
  assert.match(missing.errors.join(), /Checkpoint/)
  const down = await diagnoseComfy(config, builtinTemplates[0]!, async () => {
    throw Error('offline')
  })
  assert.equal(down.reachable, false)
})

test('credential encryption keeps plaintext out of disk and profile snapshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'director-credentials-'))
  try {
    const key = randomBytes(32)
    const store = new EncryptedCredentialStore(dir, {
      available: () => true,
      encrypt: (value) => {
        const iv = randomBytes(12),
          cipher = createCipheriv('aes-256-gcm', key, iv)
        return Buffer.concat([
          iv,
          cipher.update(value),
          cipher.final(),
          cipher.getAuthTag(),
        ])
      },
      decrypt: (value) => {
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          value.subarray(0, 12),
        )
        decipher.setAuthTag(value.subarray(-16))
        return Buffer.concat([
          decipher.update(value.subarray(12, -16)),
          decipher.final(),
        ]).toString()
      },
    })
    const ref = randomUUID(),
      secret = 'never-renderer-unit-key'
    await store.set(ref, secret)
    assert.equal(await store.get(ref), secret)
    assert.equal(
      (await readFile(join(dir, ref + '.bin'))).includes(Buffer.from(secret)),
      false,
    )
    const blocked = new EncryptedCredentialStore(dir, {
      available: () => false,
      encrypt: () => Buffer.from(''),
      decrypt: () => '',
    })
    await assert.rejects(blocked.set(randomUUID(), secret), /拒绝明文/)
    assert.equal(
      JSON.stringify(
        videoProfileSchema.parse({
          ...defaultVideoProfile,
          credentialRef: ref,
        }),
      ).includes(secret),
      false,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Seedance mocked HTTP verifies submit, status, authenticated API, unauthenticated video download and cancel', async () => {
  const app = await setup()
  let server: ReturnType<typeof createServer> | undefined
  try {
    const { shot } = await keyframe(app),
      t = await generate(app, shot.id),
      done = await settle(app, t.id),
      v = app.visual.version(app.project.id, done.resultIds[0]!)
    const bytes = await app.visual.storage.read(v.storageKey)
    let submitted: unknown,
      authorization = '',
      downloadAuthorization = '',
      deleted = false,
      port = 0
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(Buffer.from(c as Uint8Array))
      if (req.url === '/video.mp4') {
        downloadAuthorization = String(req.headers.authorization ?? '')
        res.setHeader('Content-Type', 'video/mp4')
        res.end(bytes)
        return
      }
      authorization = String(req.headers.authorization)
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST') {
        submitted = JSON.parse(Buffer.concat(chunks).toString()) as unknown
        res.end(JSON.stringify({ id: 'remote-task' }))
      } else if (req.method === 'DELETE') {
        deleted = true
        res.end('{}')
      } else
        res.end(
          JSON.stringify({
            status: 'succeeded',
            content: { video_url: `http://127.0.0.1:${port}/video.mp4` },
            usage: { completion_tokens: 123 },
          }),
        )
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    port = address.port
    const profile = videoProfileSchema.parse({
      ...defaultVideoProfile,
      provider: 'seedance',
      baseUrl: `http://127.0.0.1:${port}`,
      credentialRef: randomUUID(),
    })
    const provider = new SeedanceVideoProvider(profile, memorySecrets)
    if (t.input.type !== 'shot-video') throw Error()
    const request = {
      ...t.input.request,
      provider: 'seedance' as const,
      profile,
    }
    const first = app.visual.version(
        app.project.id,
        request.prompt.startFrameAssetVersionId,
      ),
      inputs = {
        start: await app.visual.storage.read(first.storageKey),
        startMime: first.mimeType,
      }
    const id = await provider.submit(
      request,
      inputs,
      new AbortController().signal,
    )
    assert.equal(id, 'remote-task')
    assert.match(JSON.stringify(submitted), /first_frame/)
    assert.match(JSON.stringify(submitted), /data:image/)
    const status = await provider.getStatus(id, new AbortController().signal)
    assert.equal(status.status, 'succeeded')
    const downloaded = await provider.fetchResult(
      id,
      status,
      request,
      inputs,
      new AbortController().signal,
    )
    assert.equal(downloaded.length, bytes.length)
    assert.equal(authorization, 'Bearer unit-key')
    assert.equal(downloadAuthorization, '')
    await provider.cancel(id)
    assert.equal(deleted, true)
    await assert.rejects(
      validateDownloadUrl('http://10.0.0.1/file', 'https://cloud.example'),
      /HTTPS/,
    )
    assert.throws(() => validateVideoUrl('http://example.com'), /HTTPS/)
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise<void>((r) => server!.close(() => r()))
    }
    await app.close()
  }
})

test('v3 to v4 migration preserves images, adds video fields and does not leak credential content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'director-migrate-v4-'))
  try {
    const path = join(dir, 'old.sqlite'),
      raw = new DatabaseSync(path)
    raw.exec(
      await readFile(
        new URL('../fixtures/phase1.sql', import.meta.url),
        'utf8',
      ),
    )
    const p = {
      ...metadata(),
      name: '旧库',
      description: '',
      genre: '悬疑',
      aspectRatio: '9:16',
      language: 'zh-CN',
      lastOpenedAt: null,
    }
    raw
      .prepare('INSERT INTO projects VALUES (?,?)')
      .run(p.id, JSON.stringify(p))
    for (const e of buildSeed(p.id))
      raw
        .prepare('INSERT INTO entities VALUES (?,?,?,?)')
        .run(e.id, p.id, e.kind, JSON.stringify(e))
    migrateIntelligence(raw)
    migrateVisual(raw)
    const legacyTask = aiTaskSchema.parse({
      ...metadata(),
      projectId: p.id,
      input: { type: 'parse', name: '旧任务', rawText: '旧原文' },
      status: 'succeeded',
      attempt: 1,
      error: null,
      resultIds: [],
      sourceRevisions: {},
    })
    raw
      .prepare('INSERT INTO ai_tasks VALUES (?,?,?)')
      .run(
        legacyTask.id,
        p.id,
        JSON.stringify({
          ...legacyTask,
          costMetadata: { tokens: 71, vendorNote: 'legacy' },
        }),
      )
    const asset = buildSeed(p.id).find((e) => e.kind === 'asset')!
    // Choose the ID actually in the old database; buildSeed uses fresh UUIDs.
    const assetRow = raw
      .prepare("SELECT id FROM entities WHERE kind='asset' LIMIT 1")
      .get()!
    const version = {
      ...metadata(),
      projectId: p.id,
      assetId: String(assetRow.id),
      versionNumber: 1,
      status: 'draft',
      sourceType: 'imported',
      mimeType: 'image/png',
      width: 96,
      height: 128,
      fileSize: 99,
      hash: 'a'.repeat(64),
      storageKey: 'legacy/image.png',
      thumbnailPath: 'legacy/thumb.webp',
      provider: null,
      model: null,
      prompt: '',
      negativePrompt: '',
      generationTaskId: null,
      sourceAssetIds: [],
      metadata: { name: asset.name },
    }
    raw
      .prepare('INSERT INTO asset_versions VALUES (?,?,?,?,?,?)')
      .run(
        version.id,
        p.id,
        version.assetId,
        1,
        version.hash,
        JSON.stringify(version),
      )
    raw.close()
    const db = new ProjectDatabase(path)
    assert.equal(
      db.connection.prepare('PRAGMA user_version').get()?.user_version,
      4,
    )
    const migrated = JSON.parse(
      String(
        db.connection
          .prepare('SELECT data FROM asset_versions WHERE id=?')
          .get(version.id)?.data,
      ),
    ) as Record<string, unknown>
    assert.equal(migrated.storageKey, version.storageKey)
    assert.equal(migrated.hash, version.hash)
    assert.equal(migrated.duration, null)
    assert.deepEqual(
      new IntelligenceRepository(db).task(p.id, legacyTask.id).costMetadata
        .billingMetadata,
      { legacy: { tokens: 71, vendorNote: 'legacy' } },
    )
    const shot = db.workspace(p.id).entities.find((e) => e.kind === 'shot')!
    assert.equal(
      shot.kind === 'shot' && shot.confirmedVideoAssetVersionId,
      null,
    )
    assert.equal(
      db.workspace(p.id).entities.filter((e) => e.kind === 'asset').length,
      2,
    )
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
