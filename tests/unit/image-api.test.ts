import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ImageApiAdapter } from '../../electron/main/tools/adapters/image-api.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'
import { imageServer } from '../fixtures/image-http.js'
import { requestFingerprint } from '../../electron/main/tools/fingerprint.js'
import { imageApiProfileSchema } from '../../src/shared/image-api.js'
const input = {
  prompt: 'test',
  negativePrompt: '',
  resolution: { width: 32, height: 32 },
  aspectRatio: '1:1' as const,
  seed: null,
  count: 1,
  outputMime: 'image/png' as const,
}
test('reference Adapter health/validate/estimate perform zero HTTP, uploads or billing', async () => {
  const f = await imageServer(),
    a = new ImageApiAdapter(
      f.profile,
      async () => 'SECRET',
      new ImageHttpTransport({ fixtureOrigin: f.origin }),
    ),
    signal = new AbortController().signal
  try {
    const ctx = {
      projectId: randomUUID(),
      model: f.profile.modelId,
      routingDecisionId: null,
      requestFingerprint: requestFingerprint({
        fingerprintVersion: '1',
        snapshot: {
          capability: 'image.generate',
          contractVersion: '1.0.0',
          input,
        },
        toolId: f.profile.toolId,
        toolVersion: '1.0.0',
        model: f.profile.modelId,
        sourceRevisions: {},
        routing: null,
      }),
    }
    assert.equal((await a.health(signal)).availability, 'available')
    assert.equal(
      (await a.validate('image.generate', input, ctx, signal)).valid,
      true,
    )
    for (const patch of [
      { resolution: { width: 64, height: 64 } },
      { count: 8 },
      { aspectRatio: '16:9' as const },
    ])
      assert.equal(
        (
          await a.validate(
            'image.generate',
            { ...input, ...patch },
            ctx,
            signal,
          )
        ).valid,
        false,
      )
    assert.equal(
      (
        await a.validate(
          'image.generate',
          input,
          { ...ctx, model: 'other' },
          signal,
        )
      ).valid,
      false,
    )
    assert.equal(
      (await a.estimate('image.generate', input, ctx, signal)).cost.status,
      'unknown',
    )
    assert.deepEqual(f.counts, {
      submit: 0,
      billing: 0,
      reference: 0,
      download: 0,
    })
    assert.doesNotMatch(
      JSON.stringify(a.describe()),
      /SECRET|credentialRef|endpoint/,
    )
    const bad = new ImageApiAdapter(
      f.profile,
      async () => {
        throw new Error('SECRET')
      },
      a.transport,
    )
    assert.equal((await bad.health(signal)).availability, 'unavailable')
    assert.equal(
      (await bad.validate('image.generate', input, ctx, signal)).valid,
      false,
    )
  } finally {
    await f.close()
  }
})
for (const url of [
  'file:///secret',
  'http://127.0.0.1:1',
  'https://127.0.0.1',
  'https://10.0.0.1',
  'https://192.168.1.1',
  'https://[::1]',
  'https://169.254.169.254',
  'https://user:secret@example.com',
])
  test(`bounded transport refuses unsafe URL ${url}`, async () => {
    const transport = new ImageHttpTransport({ timeoutMs: 100 })
    await assert.rejects(
      transport.bytes(url, new AbortController().signal, { limit: 100 }),
      (raw) =>
        !!raw && typeof raw === 'object' && 'sent' in raw && raw.sent === false,
    )
  })
test('abort before send produces explicit unsent evidence and cannot submit without scoped access', async () => {
  const f = await imageServer(),
    signal = new AbortController()
  signal.abort()
  try {
    const t = new ImageHttpTransport({ fixtureOrigin: f.origin })
    await assert.rejects(
      t.bytes(f.origin, signal.signal, { limit: 100 }),
      (raw) =>
        !!raw && typeof raw === 'object' && 'sent' in raw && raw.sent === false,
    )
    assert.equal(f.counts.submit, 0)
  } finally {
    await f.close()
  }
})
test('reference profile refuses invented supported billing/cancel/recover capabilities', () => {
  assert.equal(
    imageApiProfileSchema.safeParse({
      estimateSupport: 'reliable',
      cancelSupport: true,
      recoverSupport: true,
    }).success,
    false,
  )
})
