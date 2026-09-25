import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ComfyUIToolAdapter } from '../../electron/main/tools/adapters/comfyui.js'
import { requestFingerprint } from '../../electron/main/tools/fingerprint.js'
import { comfyServer, type ComfyFixtureMode } from '../fixtures/comfyui-http.js'
import type { ToolExecutionContext } from '../../src/shared/tools.js'

const input = { prompt: 'apple', negativePrompt: '', resolution: { width: 32, height: 32 }, aspectRatio: '1:1' as const, seed: 7, count: 1, outputMime: 'image/png' as const }
function context(toolId: string, capability: 'image.generate' | 'image.referenceGenerate', model: string, value: unknown) {
  const projectId = randomUUID(), taskId = randomUUID(), routingDecisionId = randomUUID(), estimateId = randomUUID(), approvalId = randomUUID()
  const requestFingerprintValue = requestFingerprint({ fingerprintVersion: '1', snapshot: { capability, contractVersion: '1.0.0', input: value }, toolId, toolVersion: '1.0.0', model, sourceRevisions: {}, routing: null })
  return { projectId, taskId, routingDecisionId, estimateId, approvalId, model, requestFingerprint: requestFingerprintValue }
}

test('adapter validates nodes/models without submit and estimates known-zero local cost', async () => {
  const f = await comfyServer(), adapter = new ComfyUIToolAdapter(f.profile), signal = new AbortController().signal
  try {
    const ctx = context(f.profile.toolId, 'image.generate', f.profile.modelId, input)
    assert.equal(adapter.describe().executionMode, 'local-service')
    assert.equal((await adapter.health(signal)).availability, 'available')
    assert.equal((await adapter.validate('image.generate', input, ctx, signal)).valid, true)
    const estimate = await adapter.estimate('image.generate', input, ctx, signal)
    assert.deepEqual(estimate.cost, { status: 'known', estimatedCost: { amountMicros: 0, currency: 'USD' } })
    assert.equal(estimate.estimatedDurationRange.status, 'unknown')
    assert.equal(f.counts.submit, 0)
  } finally { await f.close() }
})

for (const [mode, expected] of [['missing-model', '缺少模型'], ['missing-node', '缺少节点']] as const)
  test(`${mode} blocks before submit with explicit diagnostics`, async () => {
    const f = await comfyServer(mode), adapter = new ComfyUIToolAdapter(f.profile), signal = new AbortController().signal
    try {
      const ctx = context(f.profile.toolId, 'image.generate', f.profile.modelId, input)
      const result = await adapter.validate('image.generate', input, ctx, signal)
      assert.equal(result.valid, false)
      assert.match(result.issues.map((v) => v.message).join('\n'), new RegExp(expected))
      assert.equal(f.counts.submit, 0)
    } finally { await f.close() }
  })

test('submit/status/result ingests only current history output and bills zero', async () => {
  const f = await comfyServer(), adapter = new ComfyUIToolAdapter(f.profile), signal = new AbortController().signal
  try {
    const ctx = context(f.profile.toolId, 'image.generate', f.profile.modelId, input) as ToolExecutionContext
    let ingested = false, billed: number | null = null
    adapter.authorizeInputs(ctx, { references: [], ingest: async (bytes, mime) => { ingested = bytes.equals(f.bytes) && mime === 'image/png'; return { handle: 'fixture_output', mime: 'image/png', resolution: { width: 32, height: 32 } } }, billing: (amount) => { billed = amount } })
    const submitted = await adapter.submit('image.generate', input, ctx, signal)
    assert.equal(submitted.state, 'accepted')
    if (submitted.state !== 'accepted') throw new Error()
    assert.equal((await adapter.status(submitted.handle, signal)).state, 'succeeded')
    assert.equal((await adapter.result('image.generate', submitted.handle, signal)).state, 'completed')
    assert.equal(ingested, true)
    assert.equal(billed, 0)
    assert.equal(f.counts.submit, 1)
  } finally { await f.close() }
})

test('reference input uploads controlled bytes and never passes a local path', async () => {
  const f = await comfyServer('ok', true), adapter = new ComfyUIToolAdapter(f.profile), signal = new AbortController().signal
  const refInput = { ...input, references: [{ assetVersionId: randomUUID(), role: 'identity' as const, weight: 0.8 }] }
  try {
    const ctx = context(f.profile.toolId, 'image.referenceGenerate', f.profile.modelId, refInput) as ToolExecutionContext
    adapter.authorizeInputs(ctx, { references: [{ assetVersionId: refInput.references[0].assetVersionId, mime: 'image/png', bytes: f.bytes }], ingest: async () => ({ handle: 'ref_output', mime: 'image/png', resolution: { width: 32, height: 32 } }), billing: () => undefined })
    const submitted = await adapter.submit('image.referenceGenerate', refInput, ctx, signal)
    assert.equal(submitted.state, 'accepted')
    assert.equal(f.counts.upload, 1)
    assert.equal(JSON.stringify(submitted).includes(':\\'), false)
  } finally { await f.close() }
})

for (const mode of ['history-missing', 'queued', 'running'] as ComfyFixtureMode[])
  test(`recover ${mode} queries existing prompt and never resubmits`, async () => {
    const f = await comfyServer(mode), adapter = new ComfyUIToolAdapter(f.profile), signal = new AbortController().signal
    try {
      const handle = { toolId: f.profile.toolId, toolVersion: '1.0.0', externalTaskId: f.promptId }
      const recovered = await adapter.recover(handle, signal)
      if (mode === 'history-missing') assert.equal(recovered.state, 'unknown')
      else assert.equal(recovered.state, 'recovered')
      assert.equal(f.counts.submit, 0)
    } finally { await f.close() }
  })

test('cancel uses queue API and unsupported cancel never terminates a process', async () => {
  for (const mode of ['ok', 'cancel-unsupported'] as const) {
    const f = await comfyServer(mode), adapter = new ComfyUIToolAdapter(f.profile)
    try {
      const result = await adapter.cancel({ toolId: f.profile.toolId, toolVersion: '1.0.0', externalTaskId: f.promptId }, new AbortController().signal)
      assert.equal(result.state, mode === 'ok' ? 'cancelled' : 'unsupported')
      assert.equal(f.counts.cancel, 1)
    } finally { await f.close() }
  }
})
