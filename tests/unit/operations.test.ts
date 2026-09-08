import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { AITaskQueue } from '../../electron/main/intelligence/queue.js'
import { MockTextProvider } from '../../electron/main/intelligence/mock-provider.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { VisualService } from '../../electron/main/visual/service.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { ImageTaskExecutor } from '../../electron/main/visual/executor.js'
import {
  ProductionMediaExecutor,
  VideoTaskExecutor,
} from '../../electron/main/video/executor.js'
import { MockVideoProvider } from '../../electron/main/video/providers.js'
import { ProductionService } from '../../electron/main/video/service.js'
import { ProductionIntelligenceService } from '../../electron/main/production/service.js'
import { defaultVideoProfile } from '../../src/shared/video.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import {
  OperationsService,
  explainError,
} from '../../electron/main/operations/service.js'
import {
  backupProject,
  restoreProject,
  publicCopy,
} from '../../electron/main/operations/backup.js'
import { parseRange, MediaBroker } from '../../electron/main/media-broker.js'
import {
  operationsCommandSchema,
  nextAction,
  validationRecordSchema,
  operationsSnapshotSchema,
} from '../../src/shared/operations.js'
import { projectSchema, entitySchema } from '../../src/shared/domain.js'
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'director-pilot-')),
    db = new ProjectDatabase(join(dir, 'workspace.sqlite')),
    project = db.seed(buildSeed),
    repo = new IntelligenceRepository(db),
    visual = new VisualRepository(repo, new MediaStorage(join(dir, 'media'))),
    factory = () =>
      new MockVideoProvider(
        join(dir, 'work'),
        defaultVideoProfile.capabilities,
      ),
    queue = new AITaskQueue(
      repo,
      new MockTextProvider(),
      new ProductionMediaExecutor(
        new ImageTaskExecutor(visual),
        new VideoTaskExecutor(visual, factory),
      ),
    ),
    images = new VisualService(visual, queue, {
      images: async () => [],
      workflow: async () => null,
    }),
    production = new ProductionService(
      visual,
      images,
      queue,
      {
        get: async () => 'unit-key',
        set: async () => undefined,
        has: async () => true,
      },
      factory,
      { credential: async () => null, video: async () => null },
    ),
    manifest = join(dir, 'manifest.json'),
    pilot = new ProductionIntelligenceService(
      production,
      queue,
      async () => manifest,
    )
  return {
    dir,
    db,
    project,
    repo,
    visual,
    queue,
    production,
    pilot,
    manifest,
    close: async () => {
      queue.close()
      await delay(100)
      if (db.connection.isOpen) db.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
type App = Awaited<ReturnType<typeof setup>>
function shots(app: App) {
  return app.db
    .workspace(app.project.id)
    .entities.filter((e) => e.kind === 'shot')
}
async function keyframe(app: App, id = shots(app)[0]!.id) {
  const s = app.pilot.shot(app.project.id, id)
  app.repo.updateEntity(app.project.id, id, s.revision, { durationSeconds: 1 })
  const path = join(app.dir, randomUUID() + '.png')
  await writeFile(
    path,
    await sharp({
      create: { width: 320, height: 320, channels: 3, background: '#557799' },
    })
      .png()
      .toBuffer(),
  )
  const v = await app.visual.importFile(app.project.id, path, 'frame', null),
    shot = app.pilot.shot(app.project.id, id)
  app.visual.review(
    app.project.id,
    v.id,
    v.revision,
    'approved',
    shot.id,
    shot.revision,
  )
  return app.visual.version(app.project.id, v.id)
}
async function settled(app: App, id: string) {
  for (let i = 0; i < 1000; i++) {
    const t = app.repo.task(app.project.id, id)
    if (!['running', 'queued'].includes(t.status)) return t
    await delay(10)
  }
  throw Error('timeout')
}

function operations(app: App) {
  return new OperationsService(app.pilot, {
    version: 'test',
    build: 'test',
    platform: process.platform,
    directory: async () => app.dir,
    save: async () => join(app.dir, 'diagnostics.json'),
    restart: () => undefined,
  })
}
test('next action preserves production order and handles stale QC', () => {
  const s = {
    complete: false,
    keyframe: 'missing' as const,
    video: 'missing' as const,
    qc: 'missing' as const,
  }
  assert.equal(nextAction(s), '生成关键帧')
  assert.equal(nextAction({ ...s, keyframe: 'review' }), '审核关键帧')
  assert.equal(nextAction({ ...s, keyframe: 'confirmed' }), '生成视频')
  assert.equal(
    nextAction({ ...s, keyframe: 'confirmed', video: 'review' }),
    '审核视频',
  )
  assert.match(
    nextAction({
      ...s,
      keyframe: 'confirmed',
      video: 'confirmed',
      qc: 'stale',
    }),
    /连续性/,
  )
  assert.equal(nextAction({ ...s, complete: true }), '生产完成')
  assert.match(explainError('AUTH').fix, /凭据/)
  assert.equal(
    operationsCommandSchema.safeParse({
      operation: 'paid.submit',
      projectId: randomUUID(),
      previewId: randomUUID(),
      confirmed: false,
    }).success,
    false,
  )
})
test('range requests validate suffix, bounds, malformed ranges and methods', async () => {
  assert.deepEqual(parseRange('bytes=-4', 10), {
    start: 6,
    end: 9,
    partial: true,
  })
  assert.deepEqual(parseRange('bytes=4-', 10), {
    start: 4,
    end: 9,
    partial: true,
  })
  for (const r of [
    'bytes=10-',
    'bytes=4-2',
    'bytes=-0',
    'bytes=1-2,4-6',
    'bytes=',
    'bytes=99999999999999999-',
  ])
    assert.equal(parseRange(r, 10), null)
  const app = await setup()
  try {
    const v = await keyframe(app),
      broker = new MediaBroker(app.visual),
      url = broker.issue(app.project.id, v.id)
    assert.equal((await broker.handle(new Request(url))).status, 403)
    assert.equal(
      (
        await broker.handle(
          new Request('director-media://asset/../../workspace.sqlite'),
        )
      ).status,
      404,
    )
    assert.equal(
      (await broker.handle(new Request(url, { method: 'POST' }))).status,
      405,
    )
    app.db.delete(app.project.id)
    assert.equal((await broker.handle(new Request(url))).status, 404)
  } finally {
    await app.close()
  }
})
test('validation creates one scene and three shots, paid preview consumes once without auto approval', async () => {
  const app = await setup()
  try {
    const ops = operations(app),
      p = projectSchema.parse(
        await ops.execute({ operation: 'validation.create' }),
      ),
      entities = app.db.workspace(p.id).entities
    assert.equal(entities.filter((e) => e.kind === 'scene').length, 1)
    assert.equal(entities.filter((e) => e.kind === 'shot').length, 3)
    assert.equal(entities.filter((e) => e.kind === 'character').length, 2)
    const shot = shots(app)[0]!
    await keyframe(app, shot.id)
    const preview = validationRecordSchema.parse(
      await ops.execute({
        operation: 'paid.preview',
        projectId: app.project.id,
        shotId: shot.id,
        profileId: defaultVideoProfile.id,
      }),
    )
    assert.equal(preview.details.duration, 1)
    assert.equal(preview.details.resolution, '480p')
    assert.equal(
      app.repo.list(app.project.id, 'ai_tasks', aiTaskSchema).length,
      0,
    )
    const result = validationRecordSchema.parse(
      await ops.execute({
        operation: 'paid.submit',
        projectId: app.project.id,
        previewId: preview.id,
        confirmed: true,
      }),
    )
    await assert.rejects(
      () =>
        ops.execute({
          operation: 'paid.submit',
          projectId: app.project.id,
          previewId: preview.id,
          confirmed: true,
        }),
      /预览已消费/,
    )
    const task = await settled(app, String(result.details.taskId))
    assert.equal(task.status, 'succeeded', task.error?.message)
    assert.equal(
      app.visual.version(app.project.id, task.outputAssetVersionIds[0]!).status,
      'draft',
    )
    const snapshot = await ops.snapshot(app.project.id, 0)
    assert.equal(
      snapshot.checklist.find((c) => c.label.startsWith('Seedance'))?.done,
      false,
    )
  } finally {
    await app.close()
  }
})
test('backup restore verifies media, remaps project and references, rejects tampering before writes', async () => {
  const app = await setup()
  try {
    const v = await keyframe(app),
      backup = await backupProject(app.visual, app.project.id, app.dir),
      before = app.db.list().length
    const p = await restoreProject(app.visual, backup)
    assert.notEqual(p.id, app.project.id)
    assert.equal(app.db.list().length, before + 1)
    const copy = app.visual.versions(p.id)[0]!
    assert.equal(copy.hash, v.hash)
    assert.notEqual(copy.id, v.id)
    assert.ok(copy.storageKey.startsWith(p.id + '/'))
    assert.deepEqual(
      await app.visual.storage.read(copy.storageKey),
      await app.visual.storage.read(v.storageKey),
    )
    assert.equal(
      app.db.connection.prepare('PRAGMA foreign_key_check').all().length,
      0,
    )
    await writeFile(join(backup, 'media', v.storageKey), 'broken')
    await assert.rejects(() => restoreProject(app.visual, backup), /integrity/)
    assert.equal(app.db.list().length, before + 1)
    const serialized = JSON.stringify(
      publicCopy({
        credentialRef: 'private',
        api_key: 'key',
        nested: { Authorization: 'Bearer private' },
        url: 'https://u:pass@example.com/path?key=secret',
      }),
    )
    assert.ok(!serialized.includes('private'))
    assert.ok(!serialized.includes('secret'))
    assert.ok(!serialized.includes('pass'))
    assert.deepEqual(
      publicCopy({ content: 'https://example.com/script?id=original' }),
      { content: 'https://example.com/script?id=original' },
    )
  } finally {
    await app.close()
  }
})
test('diagnostics allowlist excludes script, prompt, raw error and secrets; QC failures join tasks', async () => {
  const app = await setup()
  try {
    const ops = operations(app),
      shot = shots(app)[0]!,
      old = app.repo.entity(app.project.id, shot.id)
    app.repo.updateEntity(app.project.id, shot.id, old.revision, {
      description: 'PRIVATE_SCRIPT_SENTINEL',
    })
    await assert.rejects(() =>
      app.pilot.execute({
        operation: 'qc.run',
        projectId: app.project.id,
        shotId: shot.id,
        versionId: randomUUID(),
      }),
    )
    const snapshot = operationsSnapshotSchema.parse(
      await ops.snapshot(app.project.id, 0),
    )
    assert.equal(snapshot.tasks[0]?.kind, 'qc')
    assert.equal(snapshot.tasks[0]?.status, 'failed')
    assert.ok(snapshot.errors.some((e) => e.reason === 'QC 未完成'))
    const diagnostic = JSON.stringify(await ops.diagnostics(app.project.id))
    assert.ok(!diagnostic.includes('PRIVATE_SCRIPT_SENTINEL'))
    assert.ok(!diagnostic.includes('unit-key'))
    assert.ok(!diagnostic.includes('credentialRef'))
  } finally {
    await app.close()
  }
})
test('100 shots, 20 scenes, 500 versions and 500 tasks remain queryable with bounded task pages', async () => {
  const app = await setup()
  try {
    app.queue.close()
    const p = app.project.id,
      v = await keyframe(app),
      baseShot = shots(app)[0]!,
      baseScene = app.repo.entity(p, baseShot.sceneId)
    assert.equal(baseScene.kind, 'scene')
    if (baseScene.kind !== 'scene') return
    const all = app.db.workspace(p).entities,
      episode = all.find((e) => e.kind === 'episode')!
    const scenes = Array.from({ length: 18 }, (_, i) =>
      entitySchema.parse({
        ...baseScene,
        ...metadata(),
        name: '性能场次 ' + i,
        order: i + 2,
      }),
    )
    app.db.insertEntities(p, scenes)
    const sceneIds = [
      ...all.filter((e) => e.kind === 'scene').map((e) => e.id),
      ...scenes.map((e) => e.id),
    ]
    app.db.insertEntities(
      p,
      Array.from({ length: 94 }, (_, i) =>
        entitySchema.parse({
          ...baseShot,
          ...metadata(),
          name: '性能镜头 ' + i,
          sceneId: sceneIds[i % 20],
          order: i + 6,
          approvedKeyframeAssetId: null,
          approvedKeyframeVersionId: null,
        }),
      ),
    )
    app.db.transaction(() => {
      for (let i = 1; i < 500; i++) {
        const copy = { ...v, ...metadata(), versionNumber: i + 1 }
        app.db.connection
          .prepare('INSERT INTO asset_versions VALUES (?,?,?,?,?,?)')
          .run(
            copy.id,
            p,
            copy.assetId,
            copy.versionNumber,
            copy.hash,
            JSON.stringify(copy),
          )
      }
      for (let i = 0; i < 500; i++) {
        const t = aiTaskSchema.parse({
          ...metadata(),
          projectId: p,
          input: { type: 'breakdown', targetId: baseScene.id },
          status: 'succeeded',
          attempt: 1,
          error: null,
          resultIds: [],
          sourceRevisions: {},
        })
        app.db.connection
          .prepare('INSERT INTO ai_tasks VALUES (?,?,?)')
          .run(t.id, p, JSON.stringify(t))
      }
    })
    const started = performance.now(),
      snapshot = await operations(app).snapshot(p, 0)
    assert.equal(snapshot.totalTasks, 500)
    assert.equal(snapshot.tasks.length, 50)
    assert.equal((await app.pilot.snapshot(p)).statuses.length, 100)
    assert.equal(
      app.db.workspace(p).entities.filter((e) => e.kind === 'episode').length,
      1,
    )
    assert.ok(episode)
    assert.equal(app.visual.versions(p).length, 500)
    assert.ok(performance.now() - started < 10000)
    const plan = app.db.connection
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM ai_tasks WHERE project_id=? AND json_extract(data,'$.status')='failed'",
      )
      .all(p)
    assert.match(JSON.stringify(plan), /tasks_project_status/)
  } finally {
    await app.close()
  }
})

test('offline Comfy reports Not validated and does not submit generation', async () => {
  const app = await setup(),
    server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  assert.ok(addr && typeof addr === 'object')
  const port = addr.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  try {
    app.visual.saveSettings(app.project.id, {
      ...app.visual.settings(app.project.id),
      baseUrl: `http://127.0.0.1:${port}`,
    })
    const report = validationRecordSchema.parse(
      await operations(app).execute({
        operation: 'comfy.test',
        projectId: app.project.id,
      }),
    )
    assert.equal(report.result, 'Not validated')
    assert.equal(report.details.connection, false)
    assert.equal(
      app.repo.list(app.project.id, 'ai_tasks', aiTaskSchema).length,
      0,
    )
  } finally {
    await app.close()
  }
})
test('v5 database appends v6 indexes and preserves UUID and prior data on reopen', async () => {
  const app = await setup()
  app.queue.close()
  try {
    const before = app.db.workspace(app.project.id)
    app.db.connection.exec(
      'DROP TABLE validation_records; DROP TABLE qc_jobs; DROP INDEX tasks_project_status; DROP INDEX versions_project_created; DROP INDEX qc_project_shot; PRAGMA user_version=5',
    )
    app.db.close()
    const next = new ProjectDatabase(join(app.dir, 'workspace.sqlite'))
    try {
      assert.equal(
        next.connection.prepare('PRAGMA user_version').get()?.user_version,
        6,
      )
      assert.deepEqual(next.workspace(app.project.id), before)
    } finally {
      next.close()
    }
  } finally {
    await app.close()
  }
})

test('restore rolls back database and staged media when semantic references fail', async () => {
  const app = await setup()
  try {
    await keyframe(app)
    const folder = await backupProject(app.visual, app.project.id, app.dir),
      path = join(folder, 'project.sqlite')
    const raw = new DatabaseSync(path),
      shot = shots(app)[0]!
    raw
      .prepare(
        "UPDATE entities SET data=json_set(data,'$.characterIds',json(?)) WHERE id=?",
      )
      .run(JSON.stringify([randomUUID()]), shot.id)
    raw.close()
    const manifest = JSON.parse(
      await readFile(join(folder, 'manifest.json'), 'utf8'),
    ) as { files: Record<string, string> }
    manifest.files['project.sqlite'] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest))
    const projects = app.db.list().map((p) => p.id),
      dirs = await readdir(app.visual.storage.root)
    await assert.rejects(
      () => restoreProject(app.visual, folder),
      /restored relationship/,
    )
    assert.deepEqual(
      app.db.list().map((p) => p.id),
      projects,
    )
    assert.deepEqual(await readdir(app.visual.storage.root), dirs)
  } finally {
    await app.close()
  }
})
