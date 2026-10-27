import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  PackyImage25Adapter,
  packyImage25ProfileSchema,
  type PackyPaidValidationGate,
  type PackyOutputDiagnostic,
} from '../../electron/main/tools/adapters/packy-image-25.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'
import { requestFingerprint } from '../../electron/main/tools/fingerprint.js'
import type { CapabilityInput } from '../../src/shared/capabilities/index.js'
import type { ImageCapability } from '../../electron/main/tools/adapters/image-api.js'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { entitySchema } from '../../src/shared/domain.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { ImageGenerationService } from '../../electron/main/generation/image-service.js'
import { packyImageModelNames } from '../../src/shared/packy-models.js'
const profile = packyImage25ProfileSchema.parse({
  adapter: 'packy-image-25',
  toolId: 'packy.image-25',
  displayName: 'PackyAPI · GPT Image 2.5 Sunburst',
  modelId: 'gpt-image-2.5-sunburst',
  tokenGroup: 'image',
  credentialRef: randomUUID(),
  currency: 'USD',
})
const input: CapabilityInput<'image.generate'> = {
  prompt: 'test',
  negativePrompt: 'blur',
  resolution: { width: 1024, height: 1024 },
  aspectRatio: '1:1',
  seed: null,
  count: 1,
  outputMime: 'image/png',
}

test('Flare keeps its exact model, unknown pricing and conservative single-image capability', async () => {
  const p = packyImage25ProfileSchema.parse({ ...profile, modelId: 'gpt-image-2.5-flare', displayName: 'PackyAPI · GPT Image 2.5 Flare' })
  assert.equal(packyImage25ProfileSchema.safeParse({ ...p, displayName: profile.displayName }).success, false)
  const a = new PackyImage25Adapter(p, async () => 'FIXTURE_SECRET')
  assert.deepEqual(a.describe().capabilities.map(c => c.capability), ['image.generate'])
  const ctx = context('image.generate', input, p.modelId)
  assert.equal((await a.estimate('image.generate', input, ctx, AbortSignal.timeout(1000))).cost.status, 'unknown')
  assert.equal((await a.validate('image.referenceGenerate', { ...input, references: [] }, ctx, AbortSignal.timeout(1000))).valid, false)
})
function context(cap: ImageCapability, data: CapabilityInput<ImageCapability>, model: string = profile.modelId) {
  return {
    projectId: randomUUID(),
    taskId: randomUUID(),
    approvalId: randomUUID(),
    estimateId: randomUUID(),
    routingDecisionId: null,
    model,
    requestFingerprint: requestFingerprint({
      fingerprintVersion: '1',
      snapshot: { capability: cap, contractVersion: '1.0.0', input: data },
      toolId: profile.toolId,
      toolVersion: '1.0.0',
      model,
      sourceRevisions: {},
      routing: null,
    }),
  }
}

test('Flare submits its selected native model once and ingests a decoded PNG', async () => {
  const f = await fixture()
  try {
    const p = packyImage25ProfileSchema.parse({ ...profile, modelId: 'gpt-image-2.5-flare', displayName: 'PackyAPI · GPT Image 2.5 Flare' })
    const a = new PackyImage25Adapter(p, async () => 'FIXTURE_SECRET', new ImageHttpTransport({ fixtureOrigin: f.origin, timeoutMs: 1000 }))
    const ctx = context('image.generate', input, p.modelId)
    let ingested = 0
    a.authorizeInputs(ctx, { references: [], billing: () => assert.fail('Not billing evidence'), ingest: async (bytes, mime) => {
      ingested++
      const metadata = await sharp(bytes).metadata()
      assert.equal(mime, 'image/png')
      return { handle: 'fixture-handle', mime: 'image/png', resolution: { width: metadata.width!, height: metadata.height! } }
    } })
    assert.equal((await a.submit('image.generate', input, ctx, AbortSignal.timeout(2000))).state, 'completed')
    assert.equal(ingested, 1)
    assert.equal(f.calls.length, 1)
    const body = JSON.parse(f.calls[0]!.body.toString())
    assert.equal(body.model, 'gpt-image-2.5-flare')
    assert.equal(body.n, 1)
  } finally { await f.close() }
})
async function fixture(mode = 'ok', generatedBytes?: Buffer, selectedProfile = profile) {
  generatedBytes ??= await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 180, g: 20, b: 20 },
    },
  })
    .png()
    .toBuffer()
  const calls: { method: string; path: string; mime: string; body: Buffer }[] =
    []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    calls.push({
      method: req.method!,
      path: req.url!,
      mime: req.headers['content-type'] ?? '',
      body: Buffer.concat(chunks),
    })
    assert.equal(req.headers.authorization, 'Bearer FIXTURE_SECRET')
    res.setHeader('Content-Type', 'application/json')
    if (/^\d+$/.test(mode)) {
      res.statusCode = Number(mode)
      res.end('{"error":"DO_NOT_LOG"}')
      return
    }
    if (mode === 'malformed') {
      res.end('not json DO_NOT_LOG')
      return
    }
    if (req.url === '/v1/models') {
      res.end(
        JSON.stringify({
          data: [
            { id: mode === 'missing' ? 'different-model' : selectedProfile.modelId },
          ],
        }),
      )
      return
    }
    if (mode === 'private-url') {
      res.end(JSON.stringify({ data: [{ url: 'https://127.0.0.1/secret' }] }))
      return
    }
    res.end(
      JSON.stringify({
        data: [
          { b64_json: generatedBytes.toString('base64') },
        ],
        usage: { total_tokens: 12345 },
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const a = server.address()
  assert.ok(a && typeof a !== 'string')
  const origin = `http://127.0.0.1:${a.port}`
  const adapter = new PackyImage25Adapter(
    selectedProfile,
    async () => 'FIXTURE_SECRET',
    new ImageHttpTransport({
      fixtureOrigin: origin,
      timeoutMs: 1000,
    }),
  )
  return {
    adapter,
    origin,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

type OutputMode =
  | 'url'
  | 'redirect-one'
  | 'redirect-multiple'
  | 'unsafe-redirect'
  | 'octet-png'
  | 'octet-jpeg'
  | 'wrong-content-valid'
  | 'image-content-invalid'
  | 'b64'
  | 'automatic-dimensions'
  | 'automatic-dimensions-b64'
  | 'unexpected-envelope'
  | 'missing-data'
  | 'unknown-fields'

async function outputFixture(mode: OutputMode) {
  const dimensions =
    mode === 'automatic-dimensions' || mode === 'automatic-dimensions-b64'
      ? { width: 1312, height: 1199 }
      : { width: 1024, height: 1024 }
  const png = await sharp({
    create: {
      ...dimensions,
      channels: 3,
      background: { r: 180, g: 20, b: 20 },
    },
  })
    .png()
    .toBuffer()
  const jpeg = await sharp(png).jpeg().toBuffer()
  const diagnostics: PackyOutputDiagnostic[] = []
  const requests: { path: string; authorization: string | undefined }[] = []
  let origin = ''
  const server = createServer(async (req, res) => {
    requests.push({
      path: req.url ?? '',
      authorization: req.headers.authorization,
    })
    if (req.method === 'GET' && req.url === '/v1/models') {
      assert.equal(req.headers.authorization, 'Bearer FIXTURE_SECRET')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: profile.modelId }] }))
      return
    }
    if (req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer FIXTURE_SECRET')
      for await (const _chunk of req) {
        // Drain the bounded fixture request.
      }
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('X-Request-Id', 'fixture-generation-request')
      if (mode === 'unexpected-envelope') {
        res.end(JSON.stringify({ result: [{ location: 'hidden' }] }))
        return
      }
      if (mode === 'missing-data') {
        res.end(JSON.stringify({ created: 1, data: [] }))
        return
      }
      const item =
        mode === 'b64' || mode === 'automatic-dimensions-b64'
          ? { b64_json: png.toString('base64'), revised_prompt: 'safe fixture' }
          : {
              url: `${origin}/asset/start?signature=DO_NOT_LOG`,
              revised_prompt: 'safe fixture',
              ...(mode === 'unknown-fields'
                ? { provider_trace: { private: 'DO_NOT_LOG' }, future_field: 1 }
                : {}),
            }
      res.end(
        JSON.stringify({
          created: 1,
          data: [item],
          ...(mode === 'unknown-fields' ? { future_top_level: true } : {}),
        }),
      )
      return
    }
    assert.equal(req.headers.authorization, undefined)
    if (req.url?.startsWith('/asset/start')) {
      if (mode === 'redirect-one' || mode === 'redirect-multiple') {
        res.writeHead(302, { Location: '/asset/cdn-one?signature=DO_NOT_LOG' })
        res.end()
        return
      }
      if (mode === 'unsafe-redirect') {
        res.writeHead(302, { Location: 'http://127.0.0.1:1/private?secret=DO_NOT_LOG' })
        res.end()
        return
      }
    }
    if (req.url?.startsWith('/asset/cdn-one') && mode === 'redirect-multiple') {
      res.writeHead(307, { Location: '/asset/cdn-two?signature=DO_NOT_LOG' })
      res.end()
      return
    }
    const contentType =
      mode === 'octet-png' || mode === 'octet-jpeg'
        ? 'application/octet-stream'
        : mode === 'wrong-content-valid'
          ? 'text/html'
          : 'image/png'
    const bytes =
      mode === 'image-content-invalid'
        ? Buffer.from('<html>not an image DO_NOT_LOG</html>')
        : mode === 'octet-jpeg'
          ? jpeg
          : png
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'X-Request-Id': 'fixture-download-request',
    })
    res.end(bytes)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
  const adapter = new PackyImage25Adapter(
    profile,
    async () => 'FIXTURE_SECRET',
    new ImageHttpTransport({ fixtureOrigin: origin, timeoutMs: 1000 }),
    { consume: async () => {} },
    (event) => diagnostics.push(event),
  )
  return {
    adapter,
    diagnostics,
    requests,
    dimensions,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function submitOutputFixture(value: Awaited<ReturnType<typeof outputFixture>>) {
  const ctx = context('image.generate', input)
  const captured: { ingested?: { bytes: Buffer; mime: string } } = {}
  value.adapter.authorizeInputs(ctx, {
    references: [],
    billing: () => assert.fail('response metadata is not billing evidence'),
    ingest: async (bytes, mime) => {
      captured.ingested = { bytes, mime }
      const metadata = await sharp(bytes).metadata()
      return {
        handle: 'fixture-host-handle',
        mime: 'image/png',
        resolution: { width: metadata.width!, height: metadata.height! },
      }
    },
  })
  const result = await value.adapter.submit(
    'image.generate',
    input,
    ctx,
    new AbortController().signal,
  )
  return { result, ingested: captured.ingested ?? null }
}

for (const modelId of [profile.modelId, 'gpt-image-2'] as const)
test(`Packy ${modelId} prepares one image candidate without adopting it in a sparse workspace`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'packy-paid-chain-'))
  const image = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 180, g: 20, b: 20, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  const selectedProfile = packyImage25ProfileSchema.parse({ ...profile, modelId, displayName: packyImageModelNames[modelId], tokenGroup: modelId === 'gpt-image-2' ? 'sora' : 'image' })
  const http = await fixture('ok', image, selectedProfile)
  const database = new ProjectDatabase(join(dir, 'workspace.sqlite'))
  try {
    const project = database.create({
      name: 'Packy paid validation',
      description: '',
      genre: 'validation',
      language: 'en',
      aspectRatio: '1:1',
    })
    const target = entitySchema.parse({
      ...metadata(),
      projectId: project.id,
      kind: 'character',
      name: 'Packy paid validation target',
      description: 'A matte red sphere on white',
      appearance: '',
      assetIds: [],
    })
    database.insertEntities(project.id, [target])
    const gate: PackyPaidValidationGate = { consume: async () => {} }
    const adapter = new PackyImage25Adapter(
      selectedProfile,
      async () => 'FIXTURE_SECRET',
      new ImageHttpTransport({
        fixtureOrigin: http.origin,
        timeoutMs: 1000,
      }),
      gate,
    )
    const service = new ImageGenerationService(
      new VisualRepository(
        new IntelligenceRepository(database),
        new MediaStorage(join(dir, 'media')),
      ),
      [adapter],
    )
    const exactPrompt = 'A red apple on a white table'
    const preview = await service.preview(
      {
        projectId: project.id,
        targetId: target.id,
        toolId: profile.toolId,
        resolution: { width: 1024, height: 1024 },
        aspectRatio: '1:1',
        count: 1,
        references: [],
        allowAssetUpload: true,
        localOnly: false,
      },
      {
        positivePrompt: exactPrompt,
        compilerVersion: 'packy-paid-validation-v3',
      },
    )
    assert.equal(preview.prompt, exactPrompt)
    const refreshed = await service.refreshForConfirmation(preview.id)
    assert.equal(refreshed.id, preview.id)
    assert.equal(refreshed.prompt, exactPrompt)
    assert.equal(refreshed.estimate, preview.estimate)
    assert.throws(() => service.confirm(project.id, preview.id, 0, true), /正数费用/)
    assert.equal(http.calls.filter(call => call.method === 'POST').length, 0)
    const task = service.confirm(project.id, preview.id, 400_000, modelId === 'gpt-image-2')
    await service.wait(task.id)
    const result = service.query(project.id, task.id)
    assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
    assert.equal(result.record.outcome, 'succeeded')
    assert.equal(result.versions.length, 1)
    assert.equal(result.versions[0].status, 'draft')
    assert.deepEqual(database.workspace(project.id).entities.find(e => e.id === target.id), target)
    if (modelId === 'gpt-image-2') {
      assert.equal(result.record.costStatus, 'unknown')
      assert.equal(result.record.actualCost, null)
      assert.deepEqual(adapter.describe().capabilities.map(c => c.capability), ['image.generate', 'image.referenceGenerate'])
      const denied = await adapter.validate('image.referenceGenerate', { ...input, references: [] }, context('image.generate', input, modelId), AbortSignal.timeout(1000))
      assert.equal(denied.valid, false)
    }
    assert.equal(result.reservationStatus, 'submitted')
    const promptPackage = service.generation.get(
      'prompt_packages',
      project.id,
      result.record.promptPackageId!,
    )
    assert.ok('positivePrompt' in promptPackage.compiledPrompt)
    assert.equal(promptPackage.compiledPrompt.positivePrompt, exactPrompt)
    assert.equal(promptPackage.compiledPrompt.negativePrompt, '')
    assert.equal(promptPackage.targetToolId, profile.toolId)
    assert.equal(promptPackage.targetModel, modelId)
    const generation = http.calls.find(
      (call) => call.path === '/v1/images/generations',
    )
    assert.ok(generation)
    assert.equal(JSON.parse(generation.body.toString()).prompt, exactPrompt)
    assert.deepEqual(JSON.parse(generation.body.toString()), { model: modelId, prompt: exactPrompt, n: 1, ...(modelId === 'gpt-image-2' ? { size: '1024x1024', quality: 'high', output_format: 'png', response_format: 'url' } : {}) })
    assert.equal(http.calls.filter(call => call.method === 'POST').length, 1)
    assert.throws(() => service.confirm(project.id, preview.id, 400_000, true), /预览已失效/)
  } finally {
    database.close()
    await http.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Packy real-envelope replay with 1312x1199 reaches Candidate, Review and Adopt locally', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'packy-real-envelope-replay-'))
  const http = await outputFixture('automatic-dimensions-b64')
  const database = new ProjectDatabase(join(dir, 'workspace.sqlite'))
  try {
    const project = database.create({
      name: 'Packy real envelope replay',
      description: '',
      genre: 'validation',
      language: 'en',
      aspectRatio: '1:1',
    })
    const target = entitySchema.parse({
      ...metadata(),
      projectId: project.id,
      kind: 'character',
      name: 'Packy replay target',
      description: 'A red apple on a white table',
      appearance: '',
      assetIds: [],
    })
    database.insertEntities(project.id, [target])
    const visual = new VisualRepository(
      new IntelligenceRepository(database),
      new MediaStorage(join(dir, 'media')),
    )
    const service = new ImageGenerationService(visual, [http.adapter])
    const preview = await service.preview(
      {
        projectId: project.id,
        targetId: target.id,
        toolId: profile.toolId,
        resolution: { width: 1024, height: 1024 },
        aspectRatio: '1:1',
        count: 1,
        references: [],
        allowAssetUpload: true,
        localOnly: false,
      },
      {
        positivePrompt: 'A red apple on a white table',
        compilerVersion: 'packy-v4-local-replay',
      },
    )
    const task = service.confirm(project.id, preview.id, 400_000, false)
    await service.wait(task.id)
    const result = service.query(project.id, task.id)
    assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
    assert.equal(result.record.outcome, 'succeeded')
    assert.equal(result.versions.length, 1)
    assert.equal(result.versions[0].status, 'draft')
    assert.equal(result.versions[0].width, 1312)
    assert.equal(result.versions[0].height, 1199)
    assert.equal(result.versions[0].mimeType, 'image/png')
    const adopted = service.review(
      project.id,
      result.versions[0].id,
      result.versions[0].revision,
      true,
      target.revision,
    )
    assert.equal(adopted.status, 'approved')
    const updatedTarget = visual.repo.entity(project.id, target.id)
    assert.ok(
      'visualReferences' in updatedTarget &&
        updatedTarget.visualReferences.some(
          (reference) =>
            reference.primary && reference.assetId === adopted.assetId,
        ),
    )
    assert.deepEqual(
      http.diagnostics
        .filter((event) => event.state === 'succeeded')
        .map((event) => event.stage),
      [
        'generation-response',
        'response-envelope',
        'output-reference',
        'mime-detection',
        'image-decode',
        'dimension-validation',
        'contract-match',
        'asset-ingestion',
      ],
    )
    assert.equal(
      http.requests.filter(
        (request) => request.path === '/v1/images/generations',
      ).length,
      1,
    )
  } finally {
    database.close()
    await http.close()
    await rm(dir, { recursive: true, force: true })
  }
})
for (const mode of ['ok', 'missing', '401', '403', '429', '500', 'malformed'])
  test(`Packy connectivity ${mode}: models only, sanitized, no generation capability claim`, async () => {
    const f = await fixture(mode)
    try {
      const r = await f.adapter.probeConnectivity(new AbortController().signal)
      assert.deepEqual(
        f.calls.map((c) => [c.method, c.path, c.body.length]),
        [['GET', '/v1/models', 0]],
      )
      assert.equal(r.generationValidated, false)
      assert.equal(r.tokenGroupVerified, false)
      assert.equal(
        r.modelVisible,
        mode === 'ok' ? true : mode === 'missing' ? false : null,
      )
      assert.equal(
        r.authentication,
        ['ok', 'missing'].includes(mode)
          ? 'accepted'
          : ['401', '403'].includes(mode)
            ? 'rejected'
            : 'unknown',
      )
      assert.doesNotMatch(JSON.stringify(r), /FIXTURE_SECRET|DO_NOT_LOG/)
    } finally {
      await f.close()
    }
  })
test('Packy validate/estimate are local, conservative and quote text generation', async () => {
  const f = await fixture()
  try {
    const signal = new AbortController().signal
    assert.equal(
      (
        await f.adapter.validate(
          'image.generate',
          input,
          context('image.generate', input),
          signal,
        )
      ).valid,
      true,
    )
    const estimate = await f.adapter.estimate(
      'image.generate',
      input,
      context('image.generate', input),
      signal,
    )
    assert.deepEqual(estimate.cost, {
      status: 'known',
      estimatedCost: { amountMicros: 400_000, currency: 'USD' },
    })
    for (const patch of [
      { count: 4 },
      { seed: 2 },
      { aspectRatio: '16:9' as const },
      { resolution: { width: 32, height: 32 } },
    ]) {
      const i = { ...input, ...patch }
      assert.equal(
        (
          await f.adapter.validate(
            'image.generate',
            i,
            context('image.generate', i),
            signal,
          )
        ).valid,
        false,
      )
    }
    assert.equal(f.calls.length, 0)
  } finally {
    await f.close()
  }
})
for (const cap of ['image.generate', 'image.referenceGenerate'] as const)
  test(`Packy native ${cap} mapping, controlled input/output, no invented cost`, async () => {
    const f = await fixture()
    try {
      const ref = randomUUID()
      const i =
        cap === 'image.generate'
          ? input
          : {
              ...input,
              references: [
                { assetVersionId: ref, role: 'identity' as const, weight: 1 },
              ],
            }
      const ctx = context(cap, i)
      f.adapter.authorizeInputs(ctx, {
        references: [
          {
            assetVersionId: ref,
            mime: 'image/png',
            bytes: Buffer.from('REFERENCE_BINARY'),
          },
        ],
        billing: () => assert.fail('token usage is not actual cost'),
        ingest: async (bytes, mime) => {
          assert.equal(mime, 'image/png')
          const metadata = await sharp(bytes).metadata()
          assert.equal(metadata.format, 'png')
          assert.equal(metadata.width, 1024)
          assert.equal(metadata.height, 1024)
          return {
            handle: 'issued_by_host',
            mime: 'image/png',
            resolution: input.resolution,
          }
        },
      })
      const r = await f.adapter.submit(
        cap,
        i,
        ctx,
        new AbortController().signal,
      )
      assert.equal(r.state, 'completed')
      assert.equal(f.calls.length, 1)
      const call = f.calls[0]
      assert.equal(
        call.path,
        cap === 'image.generate'
          ? '/v1/images/generations'
          : '/v1/images/edits',
      )
      const body = call.body.toString()
      assert.doesNotMatch(
        body,
        /director-image-reference-v1|assetVersionId|storageKey|FIXTURE_SECRET/,
      )
      if (cap === 'image.generate') {
        assert.equal(call.mime, 'application/json')
        assert.deepEqual(JSON.parse(body), {
          model: profile.modelId,
          prompt: 'test\nAvoid: blur',
          n: 1,
        })
      } else {
        assert.match(call.mime, /^multipart\/form-data; boundary=/)
        assert.match(body, /name="image"; filename="reference.png"/)
        assert.match(body, /Content-Type: image\/png\r\n\r\nREFERENCE_BINARY/)
        assert.match(body, /name="model"\r\n\r\ngpt-image-2.5-sunburst/)
      }
      await assert.rejects(
        f.adapter.submit(cap, i, ctx, new AbortController().signal),
      )
      assert.equal(f.calls.length, 1)
    } finally {
      await f.close()
    }
  })
test('Packy production submit stays closed even with approval and credential', async () => {
  const a = new PackyImage25Adapter(profile, async () => 'FIXTURE_SECRET')
  const ctx = context('image.generate', input)
  a.authorizeInputs(ctx, {
    references: [],
    billing: () => assert.fail(),
    ingest: async () => {
      throw new Error()
    },
  })
  await assert.rejects(
    a.submit('image.generate', input, ctx, new AbortController().signal),
    (e) => !!e && typeof e === 'object' && 'sent' in e && e.sent === false,
  )
})
test('Packy refused output URL does not retroactively prove generation unsent', async () => {
  const f = await fixture('private-url')
  try {
    const ctx = context('image.generate', input)
    f.adapter.authorizeInputs(ctx, {
      references: [],
      billing: () => assert.fail(),
      ingest: async () => {
        throw new Error()
      },
    })
    await assert.rejects(
      f.adapter.submit(
        'image.generate',
        input,
        ctx,
        new AbortController().signal,
      ),
      (e) => !!e && typeof e === 'object' && 'sent' in e && e.sent === true,
    )
    assert.equal(f.calls.length, 1)
  } finally {
    await f.close()
  }
})

test('Packy health reports model visibility without claiming generation available', async () => {
  const f = await fixture()
  try {
    const health = await f.adapter.health(new AbortController().signal)
    assert.equal(health.availability, 'unknown')
    assert.equal(f.calls[0].path, '/v1/models')
    assert.equal(f.calls.length, 1)
  } finally {
    await f.close()
  }
})
test('Packy missing credential probe stays local and sanitized', async () => {
  const a = new PackyImage25Adapter(profile, async () => {
    throw new Error('DO_NOT_LOG')
  })
  const r = await a.probeConnectivity(new AbortController().signal)
  assert.equal(r.authentication, 'unknown')
  assert.equal(r.modelVisible, null)
  assert.match(r.message, /未发出请求/)
  assert.doesNotMatch(JSON.stringify(r), /DO_NOT_LOG/)
})

for (const mode of ['url', 'b64', 'unknown-fields'] as const)
  test(`Packy ${mode} response envelope records structure without payload data`, async () => {
    const f = await outputFixture(mode)
    try {
      const { result, ingested } = await submitOutputFixture(f)
      assert.equal(result.state, 'completed')
      assert.ok(ingested)
      const envelope = f.diagnostics.find(
        (event) => event.stage === 'response-envelope',
      )
      assert.equal(envelope?.state, 'succeeded')
      assert.deepEqual(envelope?.topLevelKeys, [
        'created',
        'data',
        ...(mode === 'unknown-fields' ? ['future_top_level'] : []),
      ])
      assert.equal(envelope?.dataCount, 1)
      assert.equal(envelope?.hasUrl, mode !== 'b64')
      assert.equal(envelope?.hasB64Json, mode === 'b64')
      assert.equal(envelope?.hasRevisedPrompt, true)
      const serialized = JSON.stringify(f.diagnostics)
      assert.doesNotMatch(serialized, /DO_NOT_LOG|signature=|b64_json":"/)
      if (mode === 'unknown-fields') {
        assert.ok(envelope?.itemKeys?.includes('future_field'))
        assert.ok(envelope?.itemKeys?.includes('provider_trace'))
      }
    } finally {
      await f.close()
    }
  })

for (const [mode, redirects] of [
  ['redirect-one', 1],
  ['redirect-multiple', 2],
] as const)
  test(`Packy ${mode} revalidates each safe redirect`, async () => {
    const f = await outputFixture(mode)
    try {
      const { result } = await submitOutputFixture(f)
      assert.equal(result.state, 'completed')
      const validation = f.diagnostics.find(
        (event) => event.stage === 'redirect-validation',
      )
      assert.equal(validation?.state, 'succeeded')
      assert.equal(validation?.redirectCount, redirects)
      assert.equal(
        f.requests.filter((request) => request.path.startsWith('/asset')).length,
        redirects + 1,
      )
      assert.ok(
        f.requests
          .filter((request) => request.path.startsWith('/asset'))
          .every((request) => request.authorization === undefined),
      )
    } finally {
      await f.close()
    }
  })

test('Packy unsafe redirect is refused and records no signed URL', async () => {
  const f = await outputFixture('unsafe-redirect')
  try {
    await assert.rejects(
      submitOutputFixture(f),
      (raw) =>
        !!raw && typeof raw === 'object' && 'sent' in raw && raw.sent === true,
    )
    const failure = f.diagnostics.find(
      (event) =>
        event.stage === 'redirect-validation' && event.state === 'failed',
    )
    assert.equal(failure?.errorCode, 'validation')
    assert.doesNotMatch(JSON.stringify(f.diagnostics), /DO_NOT_LOG|secret=/)
  } finally {
    await f.close()
  }
})

for (const [mode, expected] of [
  ['octet-png', 'image/png'],
  ['octet-jpeg', 'image/jpeg'],
  ['wrong-content-valid', 'image/png'],
] as const)
  test(`Packy ${mode} trusts magic bytes plus decode over the HTTP MIME`, async () => {
    const f = await outputFixture(mode)
    try {
      const { result, ingested } = await submitOutputFixture(f)
      assert.equal(result.state, 'completed')
      assert.ok(ingested)
      assert.equal(ingested.mime, 'image/png')
      assert.equal((await sharp(ingested.bytes).metadata()).format, 'png')
      const detection = f.diagnostics.find(
        (event) => event.stage === 'mime-detection',
      )
      assert.equal(detection?.state, 'succeeded')
      assert.equal(detection?.finalMime, expected)
      assert.equal(
        detection?.contentType,
        mode.startsWith('octet') ? 'application/octet-stream' : 'text/html',
      )
    } finally {
      await f.close()
    }
  })

test('Packy image Content-Type with invalid bytes fails before asset ingestion', async () => {
  const f = await outputFixture('image-content-invalid')
  try {
    await assert.rejects(submitOutputFixture(f))
    const detection = f.diagnostics.find(
      (event) => event.stage === 'mime-detection',
    )
    assert.equal(detection?.state, 'failed')
    assert.equal(detection?.magicBytes, 'unknown')
    assert.equal(
      f.diagnostics.some((event) => event.stage === 'asset-ingestion'),
      false,
    )
  } finally {
    await f.close()
  }
})

test('Packy provider-selected automatic dimensions are decoded and preserved', async () => {
  const f = await outputFixture('automatic-dimensions')
  try {
    const { result, ingested } = await submitOutputFixture(f)
    assert.equal(result.state, 'completed')
    assert.ok(ingested)
    const metadata = await sharp(ingested.bytes).metadata()
    assert.deepEqual(
      { width: metadata.width, height: metadata.height },
      f.dimensions,
    )
    const validation = f.diagnostics.find(
      (event) => event.stage === 'dimension-validation',
    )
    assert.equal(validation?.state, 'succeeded')
    assert.deepEqual(
      { width: validation?.width, height: validation?.height },
      f.dimensions,
    )
  } finally {
    await f.close()
  }
})

for (const mode of ['unexpected-envelope', 'missing-data'] as const)
  test(`Packy ${mode} fails specifically at response-envelope`, async () => {
    const f = await outputFixture(mode)
    try {
      await assert.rejects(submitOutputFixture(f))
      const failure = f.diagnostics.find(
        (event) =>
          event.stage === 'response-envelope' && event.state === 'failed',
      )
      assert.equal(failure?.errorCode, 'unexpected-envelope')
      assert.equal(failure?.dataCount, 0)
      assert.equal(
        f.diagnostics.some((event) => event.stage === 'output-reference'),
        false,
      )
    } finally {
      await f.close()
    }
  })

test('Packy profile factory selects a standalone native adapter and never exposes credentials', async () => {
  const { imageAdapters } = await import(
    '../../electron/main/generation/image-profiles.js'
  )
  let reads = 0
  const a = imageAdapters([profile], {
    get: async () => {
      reads++
      return 'FIXTURE_SECRET'
    },
    set: async () => {},
    has: async () => true,
  })[0]
  assert.ok(a instanceof PackyImage25Adapter)
  assert.equal(reads, 0)
  assert.doesNotMatch(
    JSON.stringify(a.describe()),
    /credentialRef|FIXTURE_SECRET|director-image-reference-v1/,
  )
  assert.equal(
    packyImage25ProfileSchema.parse({
      ...profile,
      tokenGroup: 'Image',
    }).tokenGroup,
    'image',
  )
  assert.equal(
    packyImage25ProfileSchema.safeParse({
      ...profile,
      endpoint: 'https://evil.example',
    }).success,
    false,
  )
})


test('gpt-image-2 edits uses sora profile and one real multipart image; decoded output follows ingestion, not adoption', async () => {
  const p = packyImage25ProfileSchema.parse({ ...profile, modelId: 'gpt-image-2', displayName: packyImageModelNames['gpt-image-2'], tokenGroup: 'sora' })
  assert.equal(packyImage25ProfileSchema.safeParse({ ...p, tokenGroup: 'image' }).success, false)
  const f = await fixture('ok', undefined, p)
  try {
    const a = new PackyImage25Adapter(p, async () => 'FIXTURE_SECRET', new ImageHttpTransport({ fixtureOrigin: f.origin, timeoutMs: 1000 }))
    const referenceId = randomUUID(), data = { ...input, references: [{ assetVersionId: referenceId, role: 'identity' as const, weight: 1 }] }
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#abcdef' } }).png().toBuffer()
    const ctx = context('image.referenceGenerate', data, p.modelId)
    let ingested = 0
    a.authorizeInputs(ctx, { references: [{ assetVersionId: referenceId, mime: 'image/png', bytes }], billing: () => assert.fail('unknown fee'), ingest: async (b, mime) => {
      ingested++; assert.equal(mime, 'image/png'); assert.equal((await sharp(b).metadata()).width, 1024)
      return { handle: 'local-test-ingestion', mime: 'image/png', resolution: input.resolution }
    } })
    assert.equal((await a.submit('image.referenceGenerate', data, ctx, AbortSignal.timeout(2000))).state, 'completed')
    assert.equal(ingested, 1); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, '/v1/images/edits')
    const call = f.calls[0]; assert.match(call.mime, /^multipart\/form-data; boundary=/)
    assert(call.body.includes(bytes)); const body = call.body.toString()
    for (const field of ['model', 'prompt', 'n', 'size', 'quality', 'output_format', 'response_format', 'input_fidelity', 'image']) assert(body.includes('name="' + field + '"'))
    assert(body.includes('gpt-image-2')); assert(!body.includes('FIXTURE_SECRET')); assert(!body.includes(referenceId))
    await assert.rejects(a.submit('image.referenceGenerate', data, ctx, AbortSignal.timeout(2000)))
    assert.equal(f.calls.length, 1)
    const invalid = context('image.referenceGenerate', data, p.modelId)
    a.authorizeInputs(invalid, { references: [{ assetVersionId: referenceId, mime: 'image/png', bytes: Buffer.from('not an image') }], billing: () => assert.fail(), ingest: async () => { throw new Error('not reached') } })
    await assert.rejects(a.submit('image.referenceGenerate', data, invalid, AbortSignal.timeout(2000)))
    assert.equal(f.calls.length, 1)
  } finally { await f.close() }
})


test('gpt-image-2 local edits pipeline uploads a registered image and commits exactly one pending candidate with provenance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'packy-edit-pipeline-'))
  const p = packyImage25ProfileSchema.parse({ ...profile, modelId: 'gpt-image-2', displayName: packyImageModelNames['gpt-image-2'], tokenGroup: 'sora' })
  const http = await fixture('ok', undefined, p), database = new ProjectDatabase(join(dir, 'workspace.sqlite'))
  try {
    const project = database.create({ name: 'Offline edit contract', description: '', genre: 'test', language: 'en', aspectRatio: '1:1' })
    const target = entitySchema.parse({ ...metadata(), projectId: project.id, kind: 'character', name: 'Offline character', description: 'Preserve identity, reduce background saturation', appearance: '', assetIds: [] })
    database.insertEntities(project.id, [target])
    const visual = new VisualRepository(new IntelligenceRepository(database), new MediaStorage(join(dir, 'media')))
    const inputPath = join(dir, 'input.png')
    await writeFile(inputPath, await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#987654' } }).png().toBuffer())
    const reference = await visual.importFile(project.id, inputPath, 'Input candidate', null)
    const adapter = new PackyImage25Adapter(p, async () => 'FIXTURE_SECRET', new ImageHttpTransport({ fixtureOrigin: http.origin, timeoutMs: 1000 }), { consume: async () => {} })
    const service = new ImageGenerationService(visual, [adapter])
    const preview = await service.preview({ projectId: project.id, targetId: target.id, toolId: p.toolId, resolution: input.resolution, aspectRatio: '1:1', count: 1, references: [{ assetVersionId: reference.id, role: 'identity', weight: 1 }], allowAssetUpload: true, localOnly: false })
    assert.throws(() => service.confirm(project.id, preview.id, 0, true), /正数费用/)
    assert.equal(http.calls.filter(c => c.method === 'POST').length, 0)
    const task = service.confirm(project.id, preview.id, 1000000, true)
    await service.wait(task.id)
    const result = service.query(project.id, task.id)
    assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
    assert.equal(result.record.generationType, 'image.referenceGenerate')
    assert.deepEqual(result.record.inputAssetVersionIds, [reference.id])
    assert.equal(result.record.actualCost, null); assert.equal(result.record.costStatus, 'unknown')
    assert.equal(result.versions.length, 1); assert.equal(result.versions[0].status, 'draft')
    assert.deepEqual(result.versions[0].sourceAssetIds, [reference.assetId])
    assert.equal(visual.asset(project.id, result.versions[0].assetId).approvedVersionId, null)
    assert.deepEqual(visual.repo.entity(project.id, target.id), target)
    assert.equal(http.calls.filter(c => c.method === 'POST' && c.path === '/v1/images/edits').length, 1)
  } finally { database.close(); await http.close(); await rm(dir, { recursive: true, force: true }) }
})
