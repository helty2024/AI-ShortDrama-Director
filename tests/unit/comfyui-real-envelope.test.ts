import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { entitySchema } from '../../src/shared/domain.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { ImageGenerationService } from '../../electron/main/generation/image-service.js'
import { builtinComfyProfile } from '../../electron/main/tools/adapters/comfyui-template.js'
import { ComfyUIToolAdapter } from '../../electron/main/tools/adapters/comfyui.js'
import { ComfyUIRuntime } from '../../electron/main/tools/adapters/comfyui-runtime.js'
import { ComfyValidationTransport } from '../../electron/main/tools/comfyui-validation-transport.js'

test('real ComfyUI envelope replay: candidate/review/adopt and fresh service recover keep exactly one submit', async () => {
  const fixture = z.object({
    submitResponse: z.object({ prompt_id: z.uuid(), number: z.number(), node_errors: z.record(z.string(), z.unknown()) }),
    historyEntry: z.record(z.string(), z.unknown()),
    submitResponseFields: z.array(z.string()), historyEnvelopeFields: z.array(z.string()),
    outputNodeFields: z.array(z.string()), outputImageFields: z.array(z.string()),
    viewMime: z.literal('image/png'), width: z.literal(1024), height: z.literal(1024),
  }).parse(JSON.parse(await readFile(new URL('../fixtures/comfyui-real-envelope.json', import.meta.url), 'utf8')))
  // Only the real response structure is replayed. No real image is committed.
  const bytes = await sharp({ create: { width: fixture.width, height: fixture.height, channels: 3, background: 'red' } }).png().toBuffer()
  const dir = await mkdtemp(join(tmpdir(), 'comfy-real-replay-'))
  let db = new ProjectDatabase(join(dir, 'db.sqlite'))
  try {
    const profile = builtinComfyProfile({ checkpoint: 'sd_xl_base_1.0.safetensors' })
    let submissions = 0
    const fetcher: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname
      if (init?.method === 'POST') {
        assert.equal(path, '/prompt')
        submissions++
        return Response.json(fixture.submitResponse)
      }
      if (path === '/system_stats') return Response.json({ system: {} })
      if (path === '/object_info') return Response.json(Object.fromEntries(profile.template.requiredNodes.map((name) => [name, {
        output_node: name === 'SaveImage',
        input: { required: name === 'CheckpointLoaderSimple' ? { ckpt_name: [[profile.modelId]] } : {} },
      }])))
      if (path === '/history/' + fixture.submitResponse.prompt_id)
        return Response.json({ [fixture.submitResponse.prompt_id]: fixture.historyEntry })
      if (path === '/view') return new Response(bytes, { headers: { 'content-type': fixture.viewMime } })
      throw new Error('Unexpected fixture request')
    }
    const instrument = new ComfyValidationTransport(join(dir, 'intent.json'), profile.baseUrl, profile.modelId, false, fetcher)
    const visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(dir, 'media')))
    const service = new ImageGenerationService(visual, [new ComfyUIToolAdapter(profile, new ComfyUIRuntime(profile.baseUrl, instrument.fetch))])
    const project = db.create({ name: 'Replay', description: '', genre: 'test', language: 'en', aspectRatio: '1:1' })
    const target = entitySchema.parse({ ...metadata(), projectId: project.id, kind: 'character', name: 'Replay target', description: '', appearance: '', assetIds: [] })
    db.insertEntities(project.id, [target])
    const preview = await service.preview({
      projectId: project.id, targetId: target.id, toolId: profile.toolId,
      routingMode: 'fixed', resolution: { width: 1024, height: 1024 }, aspectRatio: '1:1',
      count: 1, references: [], allowAssetUpload: false, localOnly: true,
    }, { positivePrompt: 'A red apple on a white table', compilerVersion: 'real-envelope-replay' })
    const task = service.confirm(project.id, preview.id, 0, false)
    await service.wait(task.id)
    const query = service.query(project.id, task.id), candidate = query.versions[0]
    assert.equal(query.task.status, 'succeeded', JSON.stringify(query.task.error))
    assert.equal(candidate.status, 'draft')
    assert.equal(candidate.width, 1024)
    assert.equal(candidate.height, 1024)
    assert.match(candidate.hash, /^[a-f0-9]{64}$/)
    assert.equal(query.record.outputAssetVersionIds[0], candidate.id)
    assert.ok(query.record.startedAt && query.record.completedAt)
    assert.equal(query.reservationStatus, 'consumed')
    const reviewed = service.review(project.id, candidate.id, candidate.revision, false, target.revision)
    const adopted = service.review(project.id, reviewed.id, reviewed.revision, true, target.revision)
    assert.equal(adopted.status, 'approved')
    assert.deepEqual(instrument.observed.submitResponseFields, fixture.submitResponseFields)
    assert.deepEqual(instrument.observed.historyEnvelopeFields, fixture.historyEnvelopeFields)
    assert.deepEqual(instrument.observed.outputNodeFields, fixture.outputNodeFields)
    assert.deepEqual(instrument.observed.outputImageFields, fixture.outputImageFields)
    db.close()
    db = new ProjectDatabase(join(dir, 'db.sqlite'))
    const recoveryTransport = new ComfyValidationTransport(join(dir, 'intent.json'), profile.baseUrl, profile.modelId, true, fetcher)
    const nextVisual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(dir, 'media')))
    const next = new ImageGenerationService(nextVisual, [new ComfyUIToolAdapter(profile, new ComfyUIRuntime(profile.baseUrl, recoveryTransport.fetch))])
    const persisted = next.query(project.id, task.id), record = persisted.record
    const handle = { toolId: record.toolId, toolVersion: record.toolVersion, externalTaskId: persisted.task.providerTaskId! }
    const context = { projectId: project.id, taskId: task.id, estimateId: record.estimateId, approvalId: record.approvalId, routingDecisionId: record.routingDecisionId, model: record.modelId, requestFingerprint: record.requestFingerprint }
    const execution = next.broker.restoreExecution(record.parameters, context, record.toolId, record.toolVersion, handle)
    const recovered = await next.broker.recover(context, execution, handle, new AbortController().signal)
    assert.equal(recovered.state, 'recovered')
    if (recovered.state === 'recovered') assert.equal(recovered.status.state, 'succeeded')
    assert.equal(persisted.versions[0].id, candidate.id)
    assert.equal(persisted.versions[0].status, 'approved')
    const bound = nextVisual.repo.entity(project.id, target.id)
    assert.ok('visualReferences' in bound && bound.visualReferences.some((ref) => ref.primary && ref.assetId === candidate.assetId))
    assert.equal(submissions, 1)
    assert.equal(recoveryTransport.observed.submitCount, 0)
  } finally {
    db.close()
    await rm(dir, { recursive: true, force: true })
  }
})
