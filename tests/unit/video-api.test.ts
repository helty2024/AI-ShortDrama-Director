import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { VideoApiAdapter } from '../../electron/main/tools/adapters/video-api.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'
import { VideoApiGenerationService } from '../../electron/main/generation/video-api-service.js'
import { videoApiCommandSchema } from '../../src/shared/video-api.js'
import {
  videoServer,
  type VideoFixtureMode,
} from '../fixtures/video-http.js'

async function fixture(mode: VideoFixtureMode = 'ok') {
  const directory = await mkdtemp(join(tmpdir(), 'video-api-test-'))
  const path = join(directory, 'workspace.sqlite')
  const database = new ProjectDatabase(path)
  const project = database.create({
    name: 'Video API',
    description: '',
    genre: 'drama',
    language: 'zh-CN',
    aspectRatio: '1:1',
  })
  database.insertEntities(project.id, buildSeed(project.id))
  const target = database
    .workspace(project.id)
    .entities.find((entity) => entity.kind === 'shot')!
  const visual = new VisualRepository(
    new IntelligenceRepository(database),
    new MediaStorage(join(directory, 'media')),
  )
  const server = await videoServer(mode)
  const adapter = new VideoApiAdapter(
    server.profile,
    async () => 'VIDEO_FIXTURE_SECRET',
    new ImageHttpTransport({ fixtureOrigin: server.origin, timeoutMs: 300 }),
  )
  const service = new VideoApiGenerationService(visual, [adapter])
  const input = {
    projectId: project.id,
    targetId: target.id,
    toolId: server.profile.toolId,
    mode: 'text-to-video' as const,
    prompt: 'A locked-off shot of rain on a window',
    durationSeconds: 1,
    fps: 12,
    resolution: { width: 32, height: 32 },
    aspectRatio: '1:1' as const,
    seed: 42,
    firstFrameAssetVersionId: null,
    lastFrameAssetVersionId: null,
    allowAssetUpload: true,
    localOnly: false,
  }
  return {
    directory,
    path,
    database,
    project,
    target,
    visual,
    server,
    adapter,
    service,
    input,
    close: async () => {
      database.close()
      await server.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test('Reference Video Adapter describes both public video capabilities without provider claims', async () => {
  const value = await fixture()
  try {
    const description = value.adapter.describe()
    assert.deepEqual(
      description.capabilities.map((item) => item.capability),
      ['video.textToVideo', 'video.imageToVideo'],
    )
    assert.equal(description.kind, 'api')
    assert.equal(description.executionMode, 'cloud')
    assert.equal(JSON.stringify(description).includes('seedance'), false)
  } finally {
    await value.close()
  }
})

test('text-to-video follows approval, one async submit, probe, candidate, review and adopt', async () => {
  const value = await fixture()
  try {
    const preview = await value.service.preview(value.input)
    assert.equal(value.server.counts.submit, 0)
    assert.match(preview.disclosure, /上传/)
    const task = value.service.confirm(value.project.id, preview.id, 100, true)
    await value.service.wait(task.id)
    const result = await value.service.query(value.project.id, task.id)
    assert.equal(value.server.counts.submit, 1)
    assert.ok(value.server.counts.status >= 3)
    assert.equal(value.server.counts.result, 1)
    assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
    assert.equal(result.record.outcome, 'succeeded')
    assert.equal(result.versions.length, 1)
    assert.equal(result.versions[0]!.mimeType, 'video/mp4')
    assert.equal(result.versions[0]!.width, 32)
    assert.equal(result.versions[0]!.height, 32)
    assert.ok(Math.abs(result.versions[0]!.duration! - 1) <= 0.2)
    assert.equal(result.versions[0]!.status, 'draft')
    assert.equal(result.record.actualCost?.amountMicros, 7)
    assert.equal(result.reservationStatus, 'consumed')
    assert.deepEqual(result.diagnostic?.stage, 'asset-ingestion')
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /signature|DO_NOT_LOG/)
    const reviewed = value.service.review(
      value.project.id,
      result.versions[0]!.id,
      result.versions[0]!.revision,
      true,
      value.target.revision,
    )
    assert.equal(reviewed.status, 'approved')
    const target = value.visual.repo.entity(value.project.id, value.target.id)
    assert.ok(
      target.kind === 'shot' &&
        target.confirmedVideoAssetVersionId === reviewed.id,
    )
    assert.equal(JSON.stringify(result).includes('VIDEO_FIXTURE_SECRET'), false)
    const persisted = value.database.connection
      .prepare(
        "SELECT group_concat(data, '') AS data FROM generation_records WHERE project_id=?",
      )
      .get(value.project.id)
    assert.doesNotMatch(String(persisted?.data ?? ''), /signature|DO_NOT_LOG/)
  } finally {
    await value.close()
  }
})

test('renderer Video API command cannot inject endpoint, adapter, URL or reservation mutations', () => {
  const base = {
    op: 'preview',
    input: {
      projectId: crypto.randomUUID(),
      targetId: crypto.randomUUID(),
      toolId: 'reference.video',
      mode: 'text-to-video',
      prompt: 'safe prompt',
      durationSeconds: 1,
      fps: 12,
      resolution: { width: 32, height: 32 },
      aspectRatio: '1:1',
      seed: null,
      firstFrameAssetVersionId: null,
      lastFrameAssetVersionId: null,
      allowAssetUpload: true,
      localOnly: false,
    },
  }
  assert.equal(videoApiCommandSchema.safeParse(base).success, true)
  for (const field of ['endpoint', 'adapter', 'outputUrl', 'reservationStatus'])
    assert.equal(
      videoApiCommandSchema.safeParse({ ...base, [field]: 'forbidden' }).success,
      false,
    )
})

test('image-to-video uploads only controlled AssetVersion bytes after explicit cloud permission', async () => {
  const value = await fixture()
  try {
    const imagePath = join(value.directory, 'frame.png')
    await writeFile(
      imagePath,
      await sharp({
        create: { width: 32, height: 32, channels: 3, background: '#123456' },
      })
        .png()
        .toBuffer(),
    )
    const frame = await value.visual.importFile(
      value.project.id,
      imagePath,
      'frame',
      null,
    )
    const input = {
      ...value.input,
      mode: 'image-to-video' as const,
      firstFrameAssetVersionId: frame.id,
      allowAssetUpload: true,
    }
    await assert.rejects(
      value.service.preview({ ...input, allowAssetUpload: false }),
      /允许上传/,
    )
    assert.equal(value.server.counts.submit, 0)
    const preview = await value.service.preview(input)
    assert.equal(preview.inputImageCount, 1)
    const task = value.service.confirm(value.project.id, preview.id, 100, true)
    await value.service.wait(task.id)
    assert.equal(
      (await value.service.query(value.project.id, task.id)).task.status,
      'succeeded',
    )
    const body = JSON.stringify(value.server.body())
    assert.match(body, /base64/)
    assert.doesNotMatch(body, /storageKey|file:\/\/|VIDEO_FIXTURE_SECRET/)
  } finally {
    await value.close()
  }
})

test('one remote submission can create multiple candidate video versions in one GenerationRecord', async () => {
  const value = await fixture('multiple')
  try {
    const preview = await value.service.preview(value.input)
    const task = value.service.confirm(value.project.id, preview.id, 100, true)
    await value.service.wait(task.id)
    const result = await value.service.query(value.project.id, task.id)
    assert.equal(value.server.counts.submit, 1)
    assert.equal(result.versions.length, 2)
    assert.equal(result.record.outputAssetVersionIds.length, 2)
    assert.equal(new Set(result.versions.map((version) => version.assetId)).size, 1)
  } finally {
    await value.close()
  }
})

test('restart recovers the accepted provider task and submit count remains exactly one', async () => {
  const value = await fixture('always-running')
  let reopened: ProjectDatabase | undefined
  try {
    const preview = await value.service.preview(value.input)
    const task = value.service.confirm(value.project.id, preview.id, 100, true)
    await value.service.wait(task.id)
    const before = await value.service.query(value.project.id, task.id)
    assert.equal(before.task.status, 'running')
    assert.equal(before.record.outcome, 'pending')
    assert.equal(value.server.counts.submit, 1)
    value.database.close()
    value.server.setMode('ok')
    reopened = new ProjectDatabase(value.path)
    const visual = new VisualRepository(
      new IntelligenceRepository(reopened),
      new MediaStorage(join(value.directory, 'media')),
    )
    const adapter = new VideoApiAdapter(
      value.server.profile,
      async () => 'VIDEO_FIXTURE_SECRET',
      new ImageHttpTransport({ fixtureOrigin: value.server.origin, timeoutMs: 300 }),
    )
    const service = new VideoApiGenerationService(visual, [adapter])
    const after = await service.query(value.project.id, task.id)
    assert.equal(after.task.status, 'succeeded', JSON.stringify(after.task.error))
    assert.equal(after.versions.length, 1)
    assert.equal(value.server.counts.submit, 1)
    reopened.close()
    reopened = undefined
    await value.server.close()
    await rm(value.directory, { recursive: true, force: true })
  } finally {
    reopened?.close()
  }
})

test('unknown submission is held, archived and never automatically retried', async () => {
  const value = await fixture('unknown-submit')
  try {
    const preview = await value.service.preview(value.input)
    const task = value.service.confirm(value.project.id, preview.id, 100, true)
    await value.service.wait(task.id)
    const result = await value.service.query(value.project.id, task.id)
    assert.equal(result.task.status, 'failed')
    assert.equal(result.record.outcome, 'unknown-submission')
    assert.equal(result.reservationStatus, 'pending-unknown')
    assert.equal(result.versions.length, 0)
    assert.equal(value.server.counts.submit, 1)
    await value.service.query(value.project.id, task.id)
    assert.equal(value.server.counts.submit, 1)
  } finally {
    await value.close()
  }
})

for (const mode of ['failed', 'cancelled'] as const)
  test(`${mode} remote status is terminal without output or resubmission`, async () => {
    const value = await fixture(mode)
    try {
      const preview = await value.service.preview(value.input)
      const task = value.service.confirm(value.project.id, preview.id, 100, true)
      await value.service.wait(task.id)
      const result = await value.service.query(value.project.id, task.id)
      assert.equal(result.task.status, mode === 'cancelled' ? 'cancelled' : 'failed')
      assert.equal(result.versions.length, 0)
      assert.equal(result.reservationStatus, 'submitted')
      assert.equal(value.server.counts.submit, 1)
    } finally {
      await value.close()
    }
  })

for (const mode of [
  'status-401',
  'status-429',
  'status-500',
  'malformed-status',
  'unknown-status',
  'missing-remote',
] as const)
  test(`${mode} keeps known remote identity recoverable and never resubmits`, async () => {
    const value = await fixture(mode)
    try {
      const preview = await value.service.preview(value.input)
      const task = value.service.confirm(value.project.id, preview.id, 100, true)
      await value.service.wait(task.id)
      const result = await value.service.query(value.project.id, task.id)
      assert.equal(result.task.status, 'running')
      assert.ok(result.task.providerTaskId)
      assert.equal(result.record.outcome, 'pending')
      assert.equal(result.reservationStatus, 'submitted')
      assert.equal(value.server.counts.submit, 1)
    } finally {
      await value.close()
    }
  })

for (const mode of [
  'html',
  'truncated',
  'wrong-duration',
  'wrong-resolution',
  'unsafe-redirect',
] as const)
  test(`${mode} output is rejected after billing without creating AssetVersion`, async () => {
    const value = await fixture(mode)
    try {
      const preview = await value.service.preview(value.input)
      const task = value.service.confirm(value.project.id, preview.id, 100, true)
      await value.service.wait(task.id)
      const result = await value.service.query(value.project.id, task.id)
      assert.equal(result.task.status, 'failed')
      assert.equal(result.record.outcome, 'malformed-output')
      assert.equal(result.versions.length, 0)
      assert.equal(result.reservationStatus, 'consumed')
      assert.equal(result.record.actualCost?.amountMicros, 7)
      assert.equal(value.server.counts.submit, 1)
    } finally {
      await value.close()
    }
  })

for (const mode of ['redirect', 'octet-stream'] as const)
  test(`${mode} output succeeds after safe download and real FFprobe`, async () => {
    const value = await fixture(mode)
    try {
      const preview = await value.service.preview(value.input)
      const task = value.service.confirm(value.project.id, preview.id, 100, true)
      await value.service.wait(task.id)
      const result = await value.service.query(value.project.id, task.id)
      assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
      assert.equal(result.versions[0]?.codec, 'h264')
      assert.equal(value.server.counts.submit, 1)
    } finally {
      await value.close()
    }
  })

test('remote cancel is separate from local wait and does not release the submitted budget', async () => {
  const value = await fixture('always-running')
  try {
    const preview = await value.service.preview(value.input)
    const task = value.service.confirm(value.project.id, preview.id, 100, true)
    await value.service.wait(task.id)
    const cancelled = await value.service.cancel(value.project.id, task.id)
    assert.equal(cancelled.state, 'cancelled')
    const result = await value.service.query(value.project.id, task.id)
    assert.equal(result.task.status, 'cancelled')
    assert.equal(result.record.outcome, 'cancelled')
    assert.equal(result.reservationStatus, 'submitted')
    assert.equal(value.server.counts.cancel, 1)
    assert.equal(value.server.counts.submit, 1)
  } finally {
    await value.close()
  }
})
