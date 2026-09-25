import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { ImageGenerationService } from '../../electron/main/generation/image-service.js'
import { ComfyUIToolAdapter } from '../../electron/main/tools/adapters/comfyui.js'
import { comfyServer } from '../fixtures/comfyui-http.js'
import { imageServer } from '../fixtures/image-http.js'
import { ImageApiAdapter } from '../../electron/main/tools/adapters/image-api.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'

async function fixture(mode: 'ok' | 'missing-model' = 'ok') {
  const dir = await mkdtemp(join(tmpdir(), 'comfy-routing-')),
    db = new ProjectDatabase(join(dir, 'db.sqlite')),
    project = db.create({ name: 'Comfy', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '1:1' })
  db.insertEntities(project.id, buildSeed(project.id))
  const target = db.workspace(project.id).entities.find((e) => e.kind === 'character')!
  const visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(dir, 'media')))
  const server = await comfyServer(mode), adapter = new ComfyUIToolAdapter(server.profile)
  const service = new ImageGenerationService(visual, [adapter])
  const input = {
    projectId: project.id, targetId: target.id, toolId: adapter.profile.toolId,
    routingMode: 'fixed' as const, resolution: { width: 32, height: 32 }, aspectRatio: '1:1' as const,
    count: 1, references: [], allowAssetUpload: false, localOnly: true,
  }
  return { dir, db, project, target, visual, server, adapter, service, input, close: async () => { db.close(); await server.close(); await rm(dir, { recursive: true, force: true }) } }
}

test('FIXED Comfy follows approval, AITask, provenance, candidate, review and adopt', async () => {
  const f = await fixture()
  try {
    const preview = await f.service.preview(f.input)
    assert.equal(preview.executionMode, 'local-service')
    assert.equal(preview.knownFree, true)
    assert.match(preview.disclosure, /本机 ComfyUI/)
    const task = f.service.confirm(f.project.id, preview.id, 0, false)
    await f.service.wait(task.id)
    const result = f.service.query(f.project.id, task.id)
    assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
    assert.equal(result.record.toolId, 'comfyui.local')
    assert.equal(result.record.workflowTemplateId, 'fixture-image')
    assert.equal(result.record.workflowVersion, '1.0.0')
    assert.equal(result.record.outputAssetVersionIds.length, 1)
    assert.equal(result.reservationStatus, 'consumed')
    assert.deepEqual(result.record.actualCost, { amountMicros: 0, currency: 'USD' })
    assert.equal(result.versions[0].status, 'draft')
    const approved = f.service.review(f.project.id, result.versions[0].id, result.versions[0].revision, true, f.target.revision)
    assert.equal(approved.status, 'approved')
    const updated = f.visual.repo.entity(f.project.id, f.target.id)
    assert.equal('visualReferences' in updated && updated.visualReferences.some((v) => v.assetId === approved.assetId && v.primary), true)
  } finally { await f.close() }
})

test('AUTO selects ready local tool and local-only never selects cloud', async () => {
  const f = await fixture()
  const cloud = await imageServer()
  try {
    f.service.register(new ImageApiAdapter(cloud.profile, async () => 'FIXTURE', new ImageHttpTransport({ fixtureOrigin: cloud.origin })))
    const preview = await f.service.preview({ ...f.input, routingMode: 'AUTO' })
    assert.equal(preview.tool, 'ComfyUI Fixture')
    const task = f.service.confirm(f.project.id, preview.id, 0, false)
    await f.service.wait(task.id)
    assert.equal(f.service.query(f.project.id, task.id).record.toolId, 'comfyui.local')
    assert.equal(cloud.counts.submit, 0)
  } finally { await cloud.close(); await f.close() }
})

test('AUTO excludes unready ComfyUI and can select the cloud tool before submit', async () => {
  const f = await fixture('missing-model'), cloud = await imageServer()
  try {
    f.service.register(new ImageApiAdapter(cloud.profile, async () => 'FIXTURE', new ImageHttpTransport({ fixtureOrigin: cloud.origin })))
    const preview = await f.service.preview({
      ...f.input,
      toolId: cloud.profile.toolId,
      routingMode: 'AUTO',
      localOnly: false,
      allowAssetUpload: true,
    })
    assert.equal(preview.tool, cloud.profile.displayName)
    assert.equal(f.server.counts.submit, 0)
    assert.equal(cloud.counts.submit, 0)
  } finally { await cloud.close(); await f.close() }
})

test('offline ComfyUI is unavailable and FIXED does not fall back or submit', async () => {
  const f = await fixture()
  await f.server.close()
  try {
    await assert.rejects(f.service.preview(f.input), /预检未通过/)
    assert.equal(f.server.counts.submit, 0)
  } finally {
    f.db.close()
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('FIXED missing model blocks during validation without submit', async () => {
  const f = await fixture('missing-model')
  try {
    await assert.rejects(f.service.preview(f.input), /预检未通过/)
    assert.equal(f.server.counts.submit, 0)
  } finally { await f.close() }
})
