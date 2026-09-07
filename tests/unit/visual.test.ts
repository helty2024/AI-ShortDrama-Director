import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { MockTextProvider } from '../../electron/main/intelligence/mock-provider.js'
import { AITaskQueue } from '../../electron/main/intelligence/queue.js'
import { migrateIntelligence } from '../../electron/main/intelligence/migration.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { ImageTaskExecutor } from '../../electron/main/visual/executor.js'
import { VisualService } from '../../electron/main/visual/service.js'
import {
  MockImageProvider,
  ComfyUIImageProvider,
  validateComfyUrl,
} from '../../electron/main/visual/providers.js'
import {
  substituteWorkflow,
  builtinTemplates,
} from '../../electron/main/visual/workflows.js'
import {
  compileCharacterPrompt,
  compileLocationPrompt,
  compilePropPrompt,
  compileShotKeyframePrompt,
} from '../../electron/main/visual/prompt-compiler.js'
import {
  assetVersionSchema,
  imageRequestSchema,
} from '../../src/shared/visual.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import type { Shot } from '../../src/shared/domain.js'
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'director-visual-'))
  const db = new ProjectDatabase(':memory:')
  const project = db.seed(buildSeed),
    repo = new IntelligenceRepository(db),
    storage = new MediaStorage(join(directory, 'media')),
    visual = new VisualRepository(repo, storage),
    executor = new ImageTaskExecutor(visual),
    queue = new AITaskQueue(repo, new MockTextProvider(), executor),
    service = new VisualService(visual, queue, {
      images: async () => [],
      workflow: async () => null,
    })
  return {
    directory,
    db,
    project,
    repo,
    storage,
    visual,
    executor,
    queue,
    service,
    close: async () => {
      queue.close()
      await delay(30)
      db.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}
async function settled(app: Awaited<ReturnType<typeof setup>>, id: string) {
  for (let i = 0; i < 400; i++) {
    const task = app.repo.task(app.project.id, id)
    if (!['queued', 'running'].includes(task.status)) return task
    await delay(10)
  }
  throw new Error('queue timeout')
}
async function image() {
  return sharp({
    create: { width: 640, height: 480, channels: 3, background: '#aabbcc' },
  })
    .png()
    .toBuffer()
}
async function importImage(
  app: Awaited<ReturnType<typeof setup>>,
  assetId: string | null = null,
) {
  const path = join(app.directory, 'test.png')
  await writeFile(path, await image())
  return app.visual.importFile(app.project.id, path, '测试图片', assetId)
}
function target(app: Awaited<ReturnType<typeof setup>>, kind: string) {
  return app.db.workspace(app.project.id).entities.find((e) => e.kind === kind)!
}
async function generate(
  app: Awaited<ReturnType<typeof setup>>,
  targetId: string,
  assetId: string | null = null,
) {
  return aiTaskSchema.parse(
    await app.service.execute({
      operation: 'generate',
      projectId: app.project.id,
      targetId,
      assetId,
      provider: 'mock-image',
      positivePrompt: null,
      negativePrompt: null,
      previousShot: false,
    }),
  )
}

test('image import validates MIME, copies originals, hashes duplicates and creates a real thumbnail', async () => {
  const app = await setup()
  try {
    const version = await importImage(app)
    assert.equal(
      version.hash,
      createHash('sha256')
        .update(await image())
        .digest('hex'),
    )
    assert.equal(version.width, 640)
    assert.equal(version.status, 'draft')
    assert.equal(
      (await sharp(await app.storage.read(version.thumbnailPath)).metadata())
        .width,
      320,
    )
    const duplicate = await importImage(app)
    assert.equal(duplicate.id, version.id)
    assert.equal(app.visual.versions(app.project.id).length, 1)
    await rm(join(app.directory, 'test.png'))
    assert.ok((await app.storage.read(version.storageKey)).length)
    assert.ok((await app.visual.scan()).length >= 2)
    await assert.rejects(app.storage.read('../../external.png'))
    await assert.rejects(
      app.storage.store(app.project.id, version.assetId, Buffer.from('<svg/>')),
    )
    assert.equal(
      assetVersionSchema.safeParse({ ...version, hash: 'bad' }).success,
      false,
    )
  } finally {
    await app.close()
  }
})

test('JPG and WEBP imports decode with real MIME and no original path dependence', async () => {
  const app = await setup()
  try {
    for (const format of ['jpeg', 'webp'] as const) {
      const bytes = await sharp(await image())
        .toFormat(format)
        .toBuffer()
      const stored = await app.storage.store(
        app.project.id,
        randomUUID(),
        bytes,
      )
      assert.equal(stored.mimeType, 'image/' + format)
      assert.equal(stored.width, 640)
    }
  } finally {
    await app.close()
  }
})

test('Prompt Compiler injects stable Bible identity, camera, lighting and optional pinned prior keyframe', async () => {
  const app = await setup()
  try {
    const entities = app.db.workspace(app.project.id).entities,
      char = entities.find((e) => e.kind === 'character')!,
      location = entities.find((e) => e.kind === 'location')!,
      prop = entities.find((e) => e.kind === 'prop')!
    assert.equal(char.kind, 'character')
    if (
      char.kind !== 'character' ||
      location.kind !== 'location' ||
      prop.kind !== 'prop'
    )
      throw Error()
    const c = compileCharacterPrompt(
      {
        ...char,
        bible: {
          ...char.bible,
          facialFeatures: '左眼下痣',
          costume: '深蓝风衣',
        },
      },
      '黑色电影',
    )
    assert.match(c.positivePrompt, /左眼下痣/)
    assert.match(c.positivePrompt, /深蓝风衣/)
    assert.match(
      compileLocationPrompt(location).positivePrompt,
      /empty location/,
    )
    assert.match(compilePropPrompt(prop).positivePrompt, /prop master/)
    const shots = entities.filter((e): e is Shot => e.kind === 'shot')
    const prior = {
      ...shots[0]!,
      approvedKeyframeAssetId: randomUUID(),
      approvedKeyframeVersionId: randomUUID(),
    }
    const shot = { ...shots[1]!, order: prior.order + 1 }
    const prompt = compileShotKeyframePrompt(
      shot,
      [...entities.filter((e) => e.id !== prior.id), prior],
      'cinematic',
      true,
    )
    assert.ok(prompt.referenceAssetIds.includes(prior.approvedKeyframeAssetId))
    assert.match(prompt.continuity, /same costume/)
    assert.equal(
      prompt.providerHints.previousKeyframeVersionId,
      prior.approvedKeyframeVersionId,
    )
  } finally {
    await app.close()
  }
})

test('workflow variable replacement preserves numeric slots, arbitrary custom nodes, and rejects missing slots', () => {
  const raw = {
    one: {
      class_type: 'UnknownCustomNode',
      inputs: {
        text: '{{positive_prompt}}',
        width: '{{width}}',
        embedded: 'seed={{seed}}',
      },
    },
  }
  const value = substituteWorkflow(raw, {
    positive_prompt: 'a "quoted" subject',
    width: 512,
    seed: 2,
  })
  assert.equal(value.one!.inputs.width, 512)
  assert.equal(value.one!.class_type, 'UnknownCustomNode')
  assert.equal(value.one!.inputs.text, 'a "quoted" subject')
  assert.throws(() => substituteWorkflow(raw, {}), /缺少模板变量/)
  assert.throws(() => substituteWorkflow({ nodes: [] }, {}))
  assert.throws(() => validateComfyUrl('file:///etc/passwd'))
  assert.throws(() => validateComfyUrl('https://user:secret@example.test'))
})

test('Mock image provider is deterministic and the full queue creates draft versions for all four target types', async () => {
  const app = await setup()
  try {
    for (const kind of ['character', 'location', 'prop', 'shot']) {
      const task = await generate(app, target(app, kind).id)
      const complete = await settled(app, task.id)
      assert.equal(complete.status, 'succeeded')
      assert.equal(complete.progress, 1)
      assert.ok(complete.startedAt)
      assert.ok(complete.completedAt)
      const v = app.visual.version(
        app.project.id,
        complete.outputAssetVersionIds[0]!,
      )
      assert.equal(v.status, 'draft')
      assert.equal(v.generationTaskId, task.id)
      assert.equal(
        app.visual.asset(app.project.id, v.assetId).approvedVersionId,
        null,
      )
      if (kind === 'character') {
        const request = 'request' in task.input ? task.input.request : null
        assert.ok(request)
        const provider = new MockImageProvider()
        const output = await provider.generate(request, {
          signal: new AbortController().signal,
          providerTaskId: null,
          update: () => undefined,
          references: [],
        })
        assert.equal(
          createHash('sha256').update(output[0]!.bytes).digest('hex'),
          v.hash,
        )
      }
    }
  } finally {
    await app.close()
  }
})

test('Promote is atomic; Shot pins approved version while later asset promotion preserves that frame', async () => {
  const app = await setup()
  try {
    const shot = target(app, 'shot')
    const task = await generate(app, shot.id)
    const completed = await settled(app, task.id)
    const first = app.visual.version(app.project.id, completed.resultIds[0]!)
    assert.throws(
      () =>
        app.visual.review(
          app.project.id,
          first.id,
          first.revision,
          'approved',
          shot.id,
          999,
        ),
      /数据已更新/,
    )
    assert.equal(
      app.visual.asset(app.project.id, first.assetId).approvedVersionId,
      null,
    )
    app.visual.review(
      app.project.id,
      first.id,
      first.revision,
      'approved',
      shot.id,
      shot.revision,
    )
    const secondTask = await generate(app, shot.id, first.assetId)
    const secondDone = await settled(app, secondTask.id)
    const second = app.visual.version(app.project.id, secondDone.resultIds[0]!)
    assert.equal(second.versionNumber, 2)
    app.visual.review(
      app.project.id,
      second.id,
      second.revision,
      'approved',
      null,
      null,
    )
    const pinned = app.repo.entity(app.project.id, shot.id)
    assert.equal(
      pinned.kind === 'shot' && pinned.approvedKeyframeVersionId,
      first.id,
    )
    assert.equal(
      app.visual.asset(app.project.id, first.assetId).approvedVersionId,
      second.id,
    )
    assert.ok((await app.storage.read(first.storageKey)).length)
    const current = app.visual.version(app.project.id, first.id)
    assert.throws(
      () =>
        app.visual.review(
          app.project.id,
          first.id,
          current.revision,
          'rejected',
          null,
          null,
        ),
      /已确认关键帧/,
    )
  } finally {
    await app.close()
  }
})

test('Bible main references require approval, multiple roles are saved, removing a reference preserves Asset', async () => {
  const app = await setup()
  try {
    const c = target(app, 'character'),
      v = await importImage(app)
    assert.throws(
      () =>
        app.visual.saveReferences(app.project.id, c.id, c.revision, [
          { assetId: v.assetId, role: 'faceReference', primary: true },
        ]),
      /批准/,
    )
    app.visual.review(
      app.project.id,
      v.id,
      v.revision,
      'approved',
      c.id,
      c.revision,
    )
    let character = app.repo.entity(app.project.id, c.id)
    assert.equal(
      character.kind === 'character' && character.visualReferences[0]!.primary,
      true,
    )
    app.visual.saveReferences(app.project.id, c.id, character.revision, [])
    character = app.repo.entity(app.project.id, c.id)
    assert.equal(
      character.kind === 'character' && character.visualReferences.length,
      0,
    )
    assert.ok(app.visual.asset(app.project.id, v.assetId))
    assert.match(
      await app.visual.media(app.project.id, v.id, true),
      /^data:image\/webp/,
    )
  } finally {
    await app.close()
  }
})

test('Reject and archive keep immutable image content; deletion never unlinks files', async () => {
  const app = await setup()
  try {
    const v = await importImage(app)
    const rejected = app.visual.review(
      app.project.id,
      v.id,
      1,
      'rejected',
      null,
      null,
    )
    const archived = app.visual.review(
      app.project.id,
      v.id,
      rejected.revision,
      'archived',
      null,
      null,
    )
    assert.equal(archived.hash, v.hash)
    assert.equal(archived.storageKey, v.storageKey)
    const asset = app.visual.asset(app.project.id, v.assetId)
    app.visual.deleteAsset(app.project.id, asset.id, asset.revision)
    assert.equal(app.visual.versions(app.project.id).length, 0)
    assert.ok((await app.storage.read(v.storageKey)).length)
  } finally {
    await app.close()
  }
})

test('cancel and explicit retry preserve request snapshot and prevent cancelled version writes', async () => {
  const app = await setup()
  try {
    const task = await generate(app, target(app, 'shot').id)
    for (
      let i = 0;
      i < 30 && app.repo.task(app.project.id, task.id).status === 'queued';
      i++
    )
      await delay(5)
    app.queue.cancel(app.project.id, task.id)
    await delay(120)
    assert.equal(app.visual.versions(app.project.id).length, 0)
    const retry = app.queue.retry(app.project.id, task.id)
    assert.deepEqual(retry.input, task.input)
    const final = await settled(app, retry.id)
    assert.equal(final.status, 'succeeded')
    assert.equal(final.attempt, 2)
  } finally {
    await app.close()
  }
})

test('file staging failure never marks task successful or writes an AssetVersion', async () => {
  const app = await setup()
  try {
    app.storage.store = async () => {
      throw Error('disk full')
    }
    const task = await generate(app, target(app, 'prop').id)
    const final = await settled(app, task.id)
    assert.equal(final.status, 'failed')
    assert.equal(app.visual.versions(app.project.id).length, 0)
    assert.ok(final.error)
  } finally {
    await app.close()
  }
})

test('v2 migration preserves legacy assets and adds v3 fields without inventing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'director-v3-'))
  try {
    const path = join(dir, 'v2.sqlite'),
      raw = new DatabaseSync(path)
    raw.exec(
      await readFile(
        new URL('../fixtures/phase1.sql', import.meta.url),
        'utf8',
      ),
    )
    const project = {
      ...metadata(),
      name: '旧项目',
      description: '',
      genre: '悬疑',
      aspectRatio: '9:16',
      language: 'zh-CN',
      lastOpenedAt: null,
    }
    raw
      .prepare('INSERT INTO projects VALUES (?,?)')
      .run(project.id, JSON.stringify(project))
    const entities = buildSeed(project.id)
    for (const e of entities)
      raw
        .prepare('INSERT INTO entities VALUES (?,?,?,?)')
        .run(e.id, project.id, e.kind, JSON.stringify(e))
    migrateIntelligence(raw)
    raw.close()
    const db = new ProjectDatabase(path)
    assert.equal(
      db.connection.prepare('PRAGMA user_version').get()?.user_version,
      3,
    )
    assert.equal(db.workspace(project.id).entities.length, entities.length)
    const asset = db
      .workspace(project.id)
      .entities.find((e) => e.kind === 'asset')!
    assert.equal(asset.kind === 'asset' && asset.approvedVersionId, null)
    assert.equal(
      db.connection.prepare('SELECT COUNT(*) AS n FROM asset_versions').get()
        ?.n,
      0,
    )
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('restart resumes known image prompt IDs, but unknown submissions require explicit retry', async () => {
  const app = await setup()
  try {
    app.queue.close()
    const t = target(app, 'shot'),
      asset = app.db.createDraft({
        projectId: app.project.id,
        kind: 'asset',
        name: '恢复测试',
      })
    const request = imageRequestSchema.parse({
      prompt: app.visual.compile(app.project.id, t.id, false),
      width: 128,
      height: 128,
      seed: 7,
      provider: 'mock-image',
      providerOptions: {},
      referenceVersionIds: [],
    })
    const known = aiTaskSchema.parse({
      ...metadata(),
      projectId: app.project.id,
      input: {
        type: 'shot-keyframe',
        targetId: t.id,
        assetId: asset.id,
        request,
      },
      status: 'running',
      attempt: 1,
      error: null,
      resultIds: [],
      sourceRevisions: {},
      providerTaskId: 'existing-prompt',
    })
    const unknown = { ...known, id: randomUUID(), providerTaskId: null }
    app.repo.putTask(known)
    app.repo.putTask(unknown)
    const queue = new AITaskQueue(
      app.repo,
      new MockTextProvider(),
      app.executor,
    )
    assert.equal(app.repo.task(app.project.id, known.id).status, 'queued')
    assert.equal(app.repo.task(app.project.id, unknown.id).status, 'failed')
    queue.close()
  } finally {
    await app.close()
  }
})

test('ComfyUI HTTP/WebSocket protocol: submit, upload reference, progress, history, download and resume without resubmit', async () => {
  const bytes = await image()
  let submissions = 0,
    uploads = 0,
    websockets = 0
  let prompt: unknown
  const progress: number[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))
    const body = Buffer.concat(chunks).toString()
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/prompt' && req.method === 'POST') {
      submissions++
      prompt = JSON.parse(body) as unknown
      res.end(JSON.stringify({ prompt_id: 'prompt-1' }))
    } else if (req.url === '/upload/image') {
      uploads++
      res.end(JSON.stringify({ name: 'uploaded.png', subfolder: '' }))
    } else if (req.url?.startsWith('/history/'))
      res.end(
        JSON.stringify({
          'prompt-1': {
            status: { status_str: 'success', completed: true },
            outputs: {
              '7': {
                images: [
                  { filename: 'result.png', subfolder: '', type: 'output' },
                ],
              },
            },
          },
        }),
      )
    else if (req.url?.startsWith('/view?')) {
      await delay(40)
      res.setHeader('Content-Type', 'image/png')
      res.end(bytes)
    } else if (req.url === '/system_stats') res.end('{}')
    else if (req.url?.startsWith('/object_info'))
      res.end(
        JSON.stringify({
          CheckpointLoaderSimple: {
            input: { required: { ckpt_name: [['local.safetensors']] } },
          },
        }),
      )
    else res.end('{}')
  })
  const sockets = new Set<import('node:stream').Duplex>()
  server.on('upgrade', (req, socket) => {
    sockets.add(socket)
    socket.on('error', () => undefined)
    websockets++
    const accept = createHash('sha1')
      .update(
        String(req.headers['sec-websocket-key']) +
          '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
      )
      .digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        accept +
        '\r\n\r\n',
    )
    setTimeout(() => {
      const data = Buffer.from(
        JSON.stringify({
          type: 'progress',
          data: { prompt_id: 'prompt-1', value: 4, max: 10 },
        }),
      )
      socket.write(Buffer.concat([Buffer.from([129, data.length]), data]))
    }, 20)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  assert.ok(addr && typeof addr !== 'string')
  const baseUrl = `http://127.0.0.1:${addr.port}`
  try {
    const app = await setup()
    try {
      const workflow = {
        ...builtinTemplates[0]!.workflow,
        custom: {
          class_type: 'UnknownReferenceNode',
          inputs: { image: '{{reference_image}}' },
        },
      }
      const request = imageRequestSchema.parse({
        prompt: app.visual.compile(
          app.project.id,
          target(app, 'character').id,
          false,
        ),
        width: 128,
        height: 128,
        seed: 4,
        provider: 'comfyui',
        providerOptions: {
          baseUrl,
          workflow,
          checkpoint: 'local.safetensors',
          steps: 20,
          cfg: 7,
        },
        referenceVersionIds: [],
      })
      const provider = new ComfyUIImageProvider(baseUrl)
      assert.match(await provider.healthCheck(), /local.safetensors/)
      const run = {
        signal: new AbortController().signal,
        providerTaskId: null,
        update: (_id: string, p: number) => progress.push(p),
        references: [bytes],
      }
      const result = await provider.generate(request, run)
      assert.equal(result.length, 1)
      assert.equal(result[0]!.bytes.length, bytes.length)
      assert.equal(uploads, 1)
      assert.equal(submissions, 1)
      assert.match(JSON.stringify(prompt), /UnknownReferenceNode/)
      assert.ok(websockets > 0)
      assert.ok(progress.includes(0.4))
      await provider.generate(request, { ...run, providerTaskId: 'prompt-1' })
      assert.equal(submissions, 1)
      await provider.cancel('prompt-1')
    } finally {
      await app.close()
    }
  } finally {
    for (const s of sockets) s.destroy()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('ComfyUI errors are normalized and credentials / external paths are not returned', async () => {
  const provider = new ComfyUIImageProvider(
    'http://127.0.0.1:8188',
    async () => new Response('secret /private/file', { status: 500 }),
  )
  await assert.rejects(provider.healthCheck(), (e: unknown) => {
    const error = provider.normalizeError(e)
    return error.code === 'NETWORK' && !error.message.includes('secret')
  })
  assert.equal(provider.normalizeError(new Error('secret')).code, 'PROVIDER')
})

test('media access and promotion reject cross-project references without partial approval', async () => {
  const app = await setup()
  try {
    const v = await importImage(app)
    const other = app.db.create({
      name: '其他项目',
      description: '',
      genre: '剧情',
      aspectRatio: '9:16',
      language: 'zh-CN',
    })
    const character = app.db.createDraft({
      projectId: other.id,
      kind: 'character',
      name: '其他角色',
    })
    await assert.rejects(app.visual.media(other.id, v.id, false), /不存在/)
    assert.throws(
      () =>
        app.visual.review(
          app.project.id,
          v.id,
          v.revision,
          'approved',
          character.id,
          character.revision,
        ),
      /不属于当前项目/,
    )
    assert.equal(
      app.visual.asset(app.project.id, v.assetId).approvedVersionId,
      null,
    )
    assert.equal(app.visual.version(app.project.id, v.id).status, 'draft')
  } finally {
    await app.close()
  }
})
