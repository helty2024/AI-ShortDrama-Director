import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
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
import {
  capabilityMatrix,
  routeGeneration,
  aggregateCost,
  estimate,
} from '../../electron/main/production/router.js'
import {
  MockMediaQCProvider,
  planRegeneration,
} from '../../electron/main/production/qc.js'
import { defaultVideoProfile } from '../../src/shared/video.js'
import {
  defaultProductionSettings,
  batchPreviewSchema,
  qcReportSchema,
  qcOutputSchema,
  regenerationPlanSchema,
} from '../../src/shared/production.js'
import type { CostLine } from '../../src/shared/production.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
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
async function batch(app: App, ids: string[]) {
  const preview = batchPreviewSchema.parse(
    await app.pilot.execute({
      operation: 'batch.preview',
      projectId: app.project.id,
      shotIds: ids,
      profileId: defaultVideoProfile.id,
    }),
  )
  await app.pilot.execute({
    operation: 'batch.confirm',
    projectId: app.project.id,
    id: preview.id,
    expectedRevision: preview.revision,
    costAccepted: true,
  })
  const group = (await app.pilot.snapshot(app.project.id)).batches.at(-1)!
  const tasks = []
  for (const e of group.entries)
    if (e.taskId) tasks.push(await settled(app, e.taskId))
  return { preview, group, tasks }
}

test('continuity mutation inherits across shots, overrides Bible and protects revisions and scope', async () => {
  const a = await setup()
  try {
    const [first, second] = shots(a),
      p = a.project.id
    const base = a.pilot.context(p, first!.id)
    const state = structuredClone(base.state)
    state.characters[0]!.costume = '雨后湿透的红外套'
    state.characters[0]!.injuries = ['左臂擦伤']
    const saved = await a.pilot.execute({
      operation: 'continuity.save',
      projectId: p,
      targetId: first!.id,
      expectedRevision: 0,
      source: 'plot',
      state,
    })
    assert.ok(saved)
    const next = a.pilot.context(p, second!.id)
    assert.equal(next.state.characters[0]!.costume, '雨后湿透的红外套')
    assert.deepEqual(next.state.characters[0]!.injuries, ['左臂擦伤'])
    assert.notEqual(next.fingerprint, base.fingerprint)
    assert.match(
      a.visual.compile(p, second!.id, true).positivePrompt,
      /雨后湿透的红外套/,
    )
    await assert.rejects(
      a.pilot.execute({
        operation: 'continuity.save',
        projectId: p,
        targetId: first!.id,
        expectedRevision: 0,
        source: 'manual',
        state,
      }),
      /已更新/,
    )
    state.characters[0]!.characterId = randomUUID()
    await assert.rejects(
      a.pilot.execute({
        operation: 'continuity.save',
        projectId: p,
        targetId: first!.id,
        expectedRevision: 1,
        source: 'manual',
        state,
      }),
    )
  } finally {
    await a.close()
  }
})

test('production status is derived and Episode aggregates independent video tasks without auto confirmation', async () => {
  const a = await setup()
  try {
    const ids = shots(a)
      .slice(0, 2)
      .map((s) => s.id)
    for (const id of ids) await keyframe(a, id)
    const { tasks, preview } = await batch(a, ids)
    assert.equal(tasks.length, 2)
    assert.ok(tasks.every((t) => t.status === 'succeeded'))
    assert.equal(new Set(tasks.map((t) => t.resultIds[0])).size, 2)
    const s = await a.pilot.snapshot(a.project.id)
    assert.equal(s.episodes[0]!.videos, 0)
    assert.equal(s.episodes[0]!.keyframes, 2)
    assert.equal(s.statuses.filter((v) => v.video === 'review').length, 2)
    const before = s.costLines.length
    await a.pilot.execute({
      operation: 'batch.confirm',
      projectId: a.project.id,
      id: preview.id,
      expectedRevision: 1,
      costAccepted: true,
    })
    assert.equal(
      (await a.pilot.snapshot(a.project.id)).costLines.length,
      before,
    )
  } finally {
    await a.close()
  }
})

test('batch preview expires after continuity changes and rejects cloud payment without confirmation', async () => {
  const a = await setup()
  try {
    const shot = shots(a)[0]!,
      p = a.project.id
    await keyframe(a)
    const cloud = {
      ...defaultVideoProfile,
      id: randomUUID(),
      name: 'Unit Cloud',
      provider: 'seedance' as const,
      credentialRef: randomUUID(),
    }
    a.db.connection
      .prepare('INSERT INTO video_profiles VALUES (?,?,?)')
      .run(p, cloud.id, JSON.stringify(cloud))
    const preview = batchPreviewSchema.parse(
      await a.pilot.execute({
        operation: 'batch.preview',
        projectId: p,
        shotIds: [shot.id],
        profileId: cloud.id,
      }),
    )
    assert.equal(preview.cost.unknownEstimated, 1)
    await assert.rejects(
      a.pilot.execute({
        operation: 'batch.confirm',
        projectId: p,
        id: preview.id,
        expectedRevision: 1,
        costAccepted: false,
      }),
      /费用确认/,
    )
    assert.equal(a.repo.list(p, 'ai_tasks', aiTaskSchema).length, 0)
    const context = a.pilot.context(p, shot.id)
    await a.pilot.execute({
      operation: 'continuity.save',
      projectId: p,
      targetId: shot.id,
      expectedRevision: 0,
      source: 'plot',
      state: {
        ...context.state,
        characters: context.state.characters.map((c) => ({
          ...c,
          costume: '新装',
        })),
      },
    })
    await assert.rejects(
      a.pilot.execute({
        operation: 'batch.confirm',
        projectId: p,
        id: preview.id,
        expectedRevision: 1,
        costAccepted: true,
      }),
      /重新编译/,
    )
  } finally {
    await a.close()
  }
})

test('batch preparation failures are isolated, queued cancellation does not submit other tasks', async () => {
  const a = await setup()
  try {
    await keyframe(a)
    const { group, tasks } = await batch(a, [shots(a)[0]!.id, randomUUID()])
    assert.equal(tasks[0]!.status, 'succeeded')
    assert.ok(group.entries[1]!.error)
    const preview = batchPreviewSchema.parse(
      await a.pilot.execute({
        operation: 'batch.preview',
        projectId: a.project.id,
        shotIds: [shots(a)[0]!.id],
        profileId: null,
      }),
    )
    await a.pilot.execute({
      operation: 'batch.confirm',
      projectId: a.project.id,
      id: preview.id,
      expectedRevision: 1,
      costAccepted: true,
    })
    const last = (await a.pilot.snapshot(a.project.id)).batches.at(-1)!
    await a.pilot.execute({
      operation: 'batch.cancel',
      projectId: a.project.id,
      id: last.id,
    })
    assert.equal(
      a.repo.task(a.project.id, last.entries[0]!.taskId!).status,
      'cancelled',
    )
  } finally {
    await a.close()
  }
})

test('Mock QC is deterministic, schema validates scores, reports remain bound to a version and Strict completion needs reviewed media', async () => {
  const a = await setup()
  try {
    const key = await keyframe(a),
      shot = shots(a)[0]!,
      p = a.project.id,
      { tasks } = await batch(a, [shot.id]),
      video = a.visual.version(p, tasks[0]!.resultIds[0]!)
    const qc = new MockMediaQCProvider(),
      input = {
        version: video,
        shot: a.pilot.shot(p, shot.id),
        approvedKeyframe: key,
        references: [],
        continuity: a.pilot.context(p, shot.id),
        media: await a.visual.storage.read(video.storageKey),
      }
    assert.deepEqual(
      await qc.evaluate(input, new AbortController().signal),
      await qc.evaluate(input, new AbortController().signal),
    )
    assert.equal(
      qcOutputSchema.safeParse({
        ...(await qc.evaluate(input, new AbortController().signal)),
        overallScore: 101,
      }).success,
      false,
    )
    for (const version of [key, video]) {
      const report = qcReportSchema.parse(
        await a.pilot.execute({
          operation: 'qc.run',
          projectId: p,
          shotId: shot.id,
          versionId: version.id,
        }),
      )
      assert.equal(report.versionId, version.id)
      assert.equal(a.visual.version(p, video.id).status, 'draft')
      await a.pilot.execute({
        operation: 'qc.review',
        projectId: p,
        id: report.id,
        expectedRevision: 1,
        decision: 'accepted',
      })
    }
    const current = a.pilot.shot(p, shot.id)
    a.visual.review(
      p,
      video.id,
      video.revision,
      'approved',
      shot.id,
      current.revision,
    )
    await a.pilot.execute({
      operation: 'settings.save',
      projectId: p,
      settings: { ...defaultProductionSettings, qcMode: 'strict' },
    })
    assert.equal(
      (await a.pilot.snapshot(p)).statuses.find((s) => s.shotId === shot.id)
        ?.complete,
      true,
    )
    const context = a.pilot.context(p, shot.id)
    context.state.characters[0]!.physicalState = '受伤'
    await a.pilot.execute({
      operation: 'continuity.save',
      projectId: p,
      targetId: shot.id,
      expectedRevision: 0,
      source: 'plot',
      state: context.state,
    })
    const stale = (await a.pilot.snapshot(p)).statuses.find(
      (s) => s.shotId === shot.id,
    )!
    assert.equal(stale.qc, 'stale')
    assert.equal(stale.complete, false)
    assert.equal(a.pilot.reports(p).at(-1)!.versionId, video.id)
  } finally {
    await a.close()
  }
})

test('QC Reject is explicit, regeneration plan executes once and cannot loop or replace confirmed media', async () => {
  const a = await setup()
  try {
    await keyframe(a)
    const shot = shots(a)[0]!,
      p = a.project.id,
      { tasks } = await batch(a, [shot.id]),
      v = a.visual.version(p, tasks[0]!.resultIds[0]!)
    const current = a.pilot.shot(p, shot.id)
    a.repo.updateEntity(p, shot.id, current.revision, { durationSeconds: 2 })
    const r = qcReportSchema.parse(
      await a.pilot.execute({
        operation: 'qc.run',
        projectId: p,
        shotId: shot.id,
        versionId: v.id,
      }),
    )
    assert.ok(r.output.issues.some((i) => i.severity === 'severe'))
    assert.equal(a.visual.version(p, v.id).status, 'draft')
    await a.pilot.execute({
      operation: 'qc.review',
      projectId: p,
      id: r.id,
      expectedRevision: 1,
      decision: 'rejected',
    })
    assert.equal(a.visual.version(p, v.id).status, 'rejected')
    const plan = regenerationPlanSchema.parse(
      await a.pilot.execute({
        operation: 'regeneration.plan',
        projectId: p,
        reportId: r.id,
      }),
    )
    assert.match(plan.instructions.join(), /动作/)
    await Promise.all([
      a.pilot.execute({
        operation: 'regeneration.confirm',
        projectId: p,
        id: plan.id,
        expectedRevision: 1,
        costAccepted: true,
      }),
      a.pilot.execute({
        operation: 'regeneration.confirm',
        projectId: p,
        id: plan.id,
        expectedRevision: 1,
        costAccepted: true,
      }),
    ])
    assert.equal(a.repo.list(p, 'ai_tasks', aiTaskSchema).length, 2)
    const next = a.repo.list(p, 'ai_tasks', aiTaskSchema).at(-1)!
    assert.equal((await settled(a, next.id)).status, 'succeeded')
    assert.equal(a.pilot.shot(p, shot.id).confirmedVideoAssetVersionId, null)
  } finally {
    await a.close()
  }
})

test('regeneration category strategies retain identity, costume, props, camera and seed interventions', () => {
  const issues = [
    'identity',
    'costume',
    'prop',
    'camera',
    'visualIntegrity',
  ] as const
  const r = qcReportSchema.parse({
    ...metadata(),
    projectId: randomUUID(),
    shotId: randomUUID(),
    versionId: randomUUID(),
    provider: 'mock',
    contextFingerprint: 'test',
    status: 'pending',
    output: {
      identityScore: 20,
      costumeScore: 20,
      locationScore: 95,
      propScore: 20,
      actionScore: 95,
      cameraScore: 20,
      visualIntegrityScore: 20,
      continuityScore: 95,
      overallScore: 30,
      issues: issues.map((category) => ({
        category,
        severity: 'severe',
        description: 'issue',
        affectedSubject: 'subject',
        suggestedFix: 'fix',
      })),
      suggestions: [],
    },
  })
  const p = planRegeneration(r)
  assert.equal(p.instructions.length, 5)
  assert.equal(p.newSeed, true)
})

test('router filters actual capabilities and availability; unknown pricing remains unknown and currencies never mix', () => {
  const shot = buildSeed(randomUUID()).find((e) => e.kind === 'shot')!
  if (shot.kind !== 'shot') throw Error()
  const s = { ...shot, durationSeconds: 1 },
    cloud = {
      ...defaultVideoProfile,
      id: randomUUID(),
      name: 'Cloud',
      provider: 'seedance' as const,
    },
    settings = { ...defaultProductionSettings, preferredProfileId: cloud.id }
  const rows = capabilityMatrix([defaultVideoProfile, cloud], {}, settings)
  assert.equal(
    routeGeneration(s, rows, settings, '9:16').recommendedId,
    defaultVideoProfile.id,
  )
  const available = capabilityMatrix(
    [defaultVideoProfile, cloud],
    { [cloud.id]: true },
    settings,
  )
  assert.equal(
    routeGeneration(s, available, settings, '9:16').recommendedId,
    cloud.id,
  )
  assert.equal(
    routeGeneration({ ...s, durationSeconds: 59 }, available, settings, '9:16')
      .recommendedId,
    null,
  )
  assert.equal(available[0]!.textToVideo, false)
  assert.equal(estimate(available[1]!, 1).estimatedMax, null)
  const line: CostLine = {
    id: randomUUID(),
    taskId: null,
    versionId: null,
    shotId: null,
    sceneId: null,
    episodeId: null,
    kind: 'video',
    estimatedMin: null,
    estimatedMax: null,
    actual: null,
    currency: null,
  }
  const cost = aggregateCost([
    line,
    {
      ...line,
      id: randomUUID(),
      currency: 'USD',
      estimatedMin: 1,
      estimatedMax: 3,
      actual: 2,
    },
    {
      ...line,
      id: randomUUID(),
      currency: 'CNY',
      estimatedMin: 5,
      estimatedMax: 8,
      actual: 7,
    },
  ])
  assert.equal(cost.unknownActual, 1)
  assert.equal(cost.unknownEstimated, 1)
  assert.equal(cost.currencies.length, 2)
  assert.equal(cost.currencies.find((c) => c.currency === 'USD')?.actual, 2)
})

test('manifest exports only pinned confirmed video references and costs, independent of latest draft', async () => {
  const a = await setup()
  try {
    await keyframe(a)
    const shot = shots(a)[0]!,
      p = a.project.id,
      { tasks } = await batch(a, [shot.id]),
      v = a.visual.version(p, tasks[0]!.resultIds[0]!)
    a.visual.review(
      p,
      v.id,
      v.revision,
      'approved',
      shot.id,
      a.pilot.shot(p, shot.id).revision,
    )
    await batch(a, [shot.id])
    const episode = a.db
      .workspace(p)
      .entities.find((e) => e.kind === 'episode')!
    await a.pilot.execute({
      operation: 'manifest.export',
      projectId: p,
      episodeId: episode.id,
    })
    const data = JSON.parse(await readFile(a.manifest, 'utf8')) as {
      shots: {
        shotId: string
        confirmedVideoAssetVersionId: string
        media: { reference: string; hash: string }
      }[]
    }
    const exported = data.shots.find((s) => s.shotId === shot.id)!
    assert.equal(exported.confirmedVideoAssetVersionId, v.id)
    assert.equal(exported.media.reference, v.storageKey)
    assert.equal(exported.media.hash, v.hash)
    assert.equal(
      (await a.pilot.snapshot(p)).costLines.filter((l) => l.kind === 'video')
        .length,
      2,
    )
  } finally {
    await a.close()
  }
})

test('v4 upgrades to v5 without altering images, video pins or old task provider IDs', async () => {
  const a = await setup()
  try {
    await keyframe(a)
    const shot = shots(a)[0]!,
      { tasks } = await batch(a, [shot.id]),
      v = a.visual.version(a.project.id, tasks[0]!.resultIds[0]!)
    a.visual.review(
      a.project.id,
      v.id,
      v.revision,
      'approved',
      shot.id,
      a.pilot.shot(a.project.id, shot.id).revision,
    )
    a.queue.close()
    await delay(80)
    a.db.close()
    const path = join(a.dir, 'workspace.sqlite'),
      raw = new DatabaseSync(path)
    raw.exec(
      'DROP TABLE validation_records; DROP TABLE qc_jobs; DROP INDEX tasks_project_status; DROP INDEX versions_project_created; DROP INDEX qc_project_shot; DROP TABLE continuity_snapshots; DROP TABLE qc_reports; DROP TABLE production_preferences; DROP TABLE production_previews; DROP TABLE regeneration_plans; PRAGMA user_version=4',
    )
    raw.close()
    const db = new ProjectDatabase(path)
    try {
      assert.equal(
        db.connection.prepare('PRAGMA user_version').get()?.user_version,
        6,
      )
      const restored = db
        .workspace(a.project.id)
        .entities.find((e) => e.id === shot.id)
      assert.equal(
        restored?.kind === 'shot' && restored.confirmedVideoAssetVersionId,
        v.id,
      )
      assert.equal(
        new IntelligenceRepository(db).task(a.project.id, tasks[0]!.id)
          .providerTaskId,
        tasks[0]!.providerTaskId,
      )
    } finally {
      db.close()
    }
  } finally {
    await a.close()
  }
})
test('advisory can explicitly ignore severe QC while strict refuses completion and invalid provider output writes nothing', async () => {
  const a = await setup()
  try {
    await keyframe(a)
    const shot = shots(a)[0]!,
      p = a.project.id,
      { tasks } = await batch(a, [shot.id]),
      v = a.visual.version(p, tasks[0]!.resultIds[0]!)
    a.repo.updateEntity(p, shot.id, a.pilot.shot(p, shot.id).revision, {
      durationSeconds: 2,
    })
    a.visual.review(
      p,
      v.id,
      v.revision,
      'approved',
      shot.id,
      a.pilot.shot(p, shot.id).revision,
    )
    const report = qcReportSchema.parse(
      await a.pilot.execute({
        operation: 'qc.run',
        projectId: p,
        shotId: shot.id,
        versionId: v.id,
      }),
    )
    await a.pilot.execute({
      operation: 'qc.review',
      projectId: p,
      id: report.id,
      expectedRevision: 1,
      decision: 'ignored',
    })
    assert.equal(
      (await a.pilot.snapshot(p)).statuses.find((s) => s.shotId === shot.id)
        ?.complete,
      true,
    )
    await a.pilot.execute({
      operation: 'settings.save',
      projectId: p,
      settings: { ...defaultProductionSettings, qcMode: 'strict' },
    })
    assert.equal(
      (await a.pilot.snapshot(p)).statuses.find((s) => s.shotId === shot.id)
        ?.complete,
      false,
    )
    const oldReports = a.pilot.reports(p).length
    const broken = new ProductionIntelligenceService(
      a.production,
      a.queue,
      async () => null,
      {
        id: 'broken',
        evaluate: async (input) => {
          const valid = await new MockMediaQCProvider().evaluate(
            input,
            new AbortController().signal,
          )
          return { ...valid, overallScore: 999 }
        },
      },
    )
    await assert.rejects(
      broken.execute({
        operation: 'qc.run',
        projectId: p,
        shotId: shot.id,
        versionId: v.id,
      }),
    )
    assert.equal(a.pilot.reports(p).length, oldReports)
    assert.equal(a.visual.version(p, v.id).status, 'approved')
  } finally {
    await a.close()
  }
})

test('router refuses unmet end-frame and text-to-video requirements instead of substituting a model', () => {
  const shot = buildSeed(randomUUID()).find((e) => e.kind === 'shot')!
  if (shot.kind !== 'shot') throw Error()
  const rows = capabilityMatrix(
    [defaultVideoProfile],
    {},
    defaultProductionSettings,
  )
  assert.equal(
    routeGeneration(shot, rows, defaultProductionSettings, '9:16', null, {
      taskType: 'text-to-video',
      endFrame: false,
      referenceImages: 0,
    }).recommendedId,
    null,
  )
  assert.equal(
    routeGeneration(shot, rows, defaultProductionSettings, '9:16', null, {
      taskType: 'image-to-video',
      endFrame: true,
      referenceImages: 0,
    }).recommendedId,
    null,
  )
})
test('quoted cloud costs persist on Task and AssetVersion without converting unknown actual charges to zero', async () => {
  const a = await setup()
  try {
    await keyframe(a)
    const p = a.project.id,
      shot = shots(a)[0]!,
      profile = {
        ...defaultVideoProfile,
        id: randomUUID(),
        name: 'Cloud protocol stub',
        provider: 'seedance' as const,
        credentialRef: randomUUID(),
      }
    a.db.connection
      .prepare('INSERT INTO video_profiles VALUES (?,?,?)')
      .run(p, profile.id, JSON.stringify(profile))
    await a.pilot.execute({
      operation: 'settings.save',
      projectId: p,
      settings: {
        ...defaultProductionSettings,
        rates: [
          {
            profileId: profile.id,
            currency: 'USD',
            minPerSecond: 0.2,
            maxPerSecond: 0.4,
          },
        ],
      },
    })
    const preview = batchPreviewSchema.parse(
      await a.pilot.execute({
        operation: 'batch.preview',
        projectId: p,
        shotIds: [shot.id],
        profileId: profile.id,
      }),
    )
    assert.equal(preview.cost.currencies[0]!.estimatedMax, 0.4)
    await a.pilot.execute({
      operation: 'batch.confirm',
      projectId: p,
      id: preview.id,
      expectedRevision: 1,
      costAccepted: true,
    })
    const group = (await a.pilot.snapshot(p)).batches.at(-1)!,
      task = await settled(a, group.entries[0]!.taskId!)
    assert.equal(task.status, 'succeeded')
    assert.equal(task.costMetadata.estimatedCost, 0.4)
    assert.equal(task.costMetadata.actualCost, null)
    const v = a.visual.version(p, task.resultIds[0]!)
    assert.equal(v.cost.estimatedCost, 0.4)
    assert.equal(v.cost.actualCost, null)
    const snapshot = await a.pilot.snapshot(p)
    assert.equal(snapshot.categoryCosts.video.unknownActual, 1)
    assert.equal(snapshot.categoryCosts.video.currencies[0]!.estimatedMin, 0.2)
  } finally {
    await a.close()
  }
})
