import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  PackyImage25Adapter,
  packyImage25ProfileSchema,
  type PackyPaidValidationGate,
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
function context(cap: ImageCapability, data: CapabilityInput<ImageCapability>) {
  return {
    projectId: randomUUID(),
    taskId: randomUUID(),
    approvalId: randomUUID(),
    estimateId: randomUUID(),
    routingDecisionId: null,
    model: profile.modelId,
    requestFingerprint: requestFingerprint({
      fingerprintVersion: '1',
      snapshot: { capability: cap, contractVersion: '1.0.0', input: data },
      toolId: profile.toolId,
      toolVersion: '1.0.0',
      model: profile.modelId,
      sourceRevisions: {},
      routing: null,
    }),
  }
}
async function fixture(mode = 'ok', generatedBytes = Buffer.from('fixture-image-bytes')) {
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
            { id: mode === 'missing' ? 'different-model' : profile.modelId },
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
    profile,
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

test('Packy paid gate prepares one known-cost image attempt in a sparse workspace', async () => {
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
  const http = await fixture('ok', image)
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
      profile,
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
    const preview = await service.preview({
      projectId: project.id,
      targetId: target.id,
      toolId: profile.toolId,
      resolution: { width: 1024, height: 1024 },
      aspectRatio: '1:1',
      count: 1,
      references: [],
      allowAssetUpload: true,
      localOnly: false,
    })
    const task = service.confirm(project.id, preview.id, 400_000, false)
    await service.wait(task.id)
    const result = service.query(project.id, task.id)
    assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
    assert.equal(result.record.outcome, 'succeeded')
    assert.equal(result.versions.length, 1)
    assert.equal(result.reservationStatus, 'submitted')
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
          assert.equal(bytes.toString(), 'fixture-image-bytes')
          assert.equal(mime, 'image/png')
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
          ? '/v1/image-generation'
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
          size: '1024x1024',
          quality: 'low',
          output_format: 'png',
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
