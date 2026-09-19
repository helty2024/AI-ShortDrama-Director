import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { ToolRegistry } from '../../electron/main/tools/registry.js'
import { ToolBroker, brokerRequestSchema, type BrokerRequest, type PreflightResult } from '../../electron/main/tools/broker.js'
import { MockSyncImageTool } from '../fixtures/tools/sync-image.js'
import { MockAsyncVideoTool } from '../fixtures/tools/async-video.js'
import type { ToolExecutionContext } from '../../src/shared/tools.js'

const signal = new AbortController().signal
function request(video = false): BrokerRequest {
  const input = { prompt: 'Room', negativePrompt: '', resolution: { width: 1024, height: 1024 }, aspectRatio: '1:1', seed: null, outputMime: video ? 'video/mp4' : 'image/png', ...(video ? { durationSeconds: 5, fps: 24, audio: 'none' } : { count: 1 }) }
  return brokerRequestSchema.parse({ projectId: randomUUID(), requestId: randomUUID(), snapshot: { capability: video ? 'video.textToVideo' : 'image.generate', contractVersion: '1.0.0', input }, policy: { version: '1.0.0', selection: { mode: 'AUTO' }, hardConstraints: { locality: 'either', allowAssetUpload: true, budget: null, requiredAvailability: 'available', availableMemoryMB: null, availableGpuMemoryMB: null, networkAvailable: true }, preferences: { order: ['cost'], quality: { status: 'unknown' } }, unknown: { cost: 'allow', duration: 'allow', quality: 'allow', resources: 'allow' } } })
}
function setup(tool = new MockSyncImageTool()) {
  const registry = new ToolRegistry(); registry.register(tool)
  return { registry, broker: new ToolBroker(registry), tool }
}
function execution(req: BrokerRequest, preflight: PreflightResult): ToolExecutionContext {
  assert.equal(preflight.ready, true)
  return { projectId: req.projectId, taskId: req.requestId, requestFingerprint: preflight.requestFingerprint!, model: preflight.routingDecision!.selectedModel, routingDecisionId: preflight.routingDecision!.id, estimateId: preflight.estimate!.id, approvalId: null }
}
async function videoExecution() {
  const registry = new ToolRegistry(), tool = new MockAsyncVideoTool({ recover: true })
  registry.register(tool)
  const broker = new ToolBroker(registry), req = request(true), preflight = await broker.preflight(req, signal), ctx = execution(req, preflight)
  // Trusted Runtime fixture performs submission; Broker intentionally exposes no submit.
  assert.equal(req.snapshot.capability, 'video.textToVideo')
  if (req.snapshot.capability !== 'video.textToVideo') throw new Error('Wrong capability')
  const submitted = await tool.submit('video.textToVideo', req.snapshot.input, ctx, signal)
  assert.equal(submitted.state, 'accepted')
  if (submitted.state !== 'accepted') throw new Error('Expected handle')
  const id = broker.openExecution(req, preflight, ctx, submitted.handle)
  return { registry, broker, tool, req, preflight, ctx, id, handle: submitted.handle }
}

test('Broker performs ordered health/validate/estimate and binds final quote without generating', async () => {
  const { broker, tool } = setup(), calls: string[] = []
  const health = tool.health.bind(tool), validate = tool.validate.bind(tool), estimate = tool.estimate.bind(tool)
  tool.health = s => { calls.push('health'); return health(s) }
  tool.validate = (...args) => { calls.push('validate'); return validate(...args) }
  tool.estimate = (...args) => { calls.push('estimate'); return estimate(...args) }
  const req = request(), result = await broker.preflight(req, signal)
  assert.equal(result.ready, true)
  assert.deepEqual(calls, ['health', 'validate', 'estimate', 'health', 'validate', 'estimate'])
  assert.equal(result.estimate!.routingDecisionId, result.routingDecision!.id)
  assert.equal(result.validation!.requestFingerprint, result.requestFingerprint)
  assert.equal(tool.counts.submitCount, 0); assert.equal(tool.counts.uploadCount, 0); assert.equal(tool.counts.billingCount, 0)
  broker.assertCurrent(req, result)
})

test('real Broker preflight for asynchronous fixture remains free of generation effects', async () => {
  const registry = new ToolRegistry(), tool = new MockAsyncVideoTool()
  registry.register(tool)
  const result = await new ToolBroker(registry).preflight(request(true), signal)
  assert.equal(result.ready, true)
  assert.deepEqual(tool.counts, { validateCount: 2, estimateCount: 2, submitCount: 0, uploadCount: 0, billingCount: 0, cancelCount: 0 })
})

test('privacy static filter does not call adapters; missing fixed tool never falls back', async () => {
  const { broker, tool } = setup(), req = request()
  req.policy.hardConstraints.privacy = 'sensitive-local-only'
  assert.equal((await broker.preflight(req, signal)).ready, false)
  assert.equal(tool.counts.validateCount, 0)
  req.policy.hardConstraints.privacy = 'public'
  req.policy.selection = { mode: 'fixed', toolId: 'missing.tool', model: null }
  assert.equal((await broker.preflight(req, signal)).ready, false)
  assert.equal(tool.counts.validateCount, 0)
})

test('health unavailable and validation invalid stop before estimate', async () => {
  const { broker, tool } = setup(new MockSyncImageTool({ health: 'unavailable' }))
  assert.equal((await broker.preflight(request(), signal)).ready, false)
  assert.equal(tool.counts.validateCount, 0)
  tool.options.health = 'healthy'
  const req = request()
  if (req.snapshot.capability === 'image.generate') req.snapshot.input.resolution = { width: 512, height: 512 }
  assert.equal((await broker.preflight(req, signal)).ready, false)
  assert.equal(tool.counts.estimateCount, 0)
})

test('fingerprint, model, policy, decision identity and adapter replacement invalidate preflight', async () => {
  const { broker, registry } = setup(), req = request(), first = await broker.preflight(req, signal)
  const changed = structuredClone(req)
  if (changed.snapshot.capability === 'image.generate') changed.snapshot.input.prompt = 'Changed'
  assert.throws(() => broker.assertCurrent(changed, first))
  changed.policy.selection = { mode: 'fixed', toolId: 'mock.image', toolVersion: '2.0.0', model: 'changed' }
  assert.throws(() => broker.assertCurrent(changed, first))
  assert.throws(() => broker.assertCurrent(req, { ...first, routingDecision: { ...first.routingDecision!, id: randomUUID() } }))
  const second = await broker.preflight(req, signal)
  assert.notEqual(second.routingDecision!.id, first.routingDecision!.id)
  assert.throws(() => broker.assertCurrent(req, first))
  registry.unregister('mock.image', '1.0.0'); registry.register(new MockSyncImageTool())
  assert.throws(() => broker.assertCurrent(req, second))
})

test('expired final estimate fails readiness even under unknown-allow policy', async () => {
  const { broker, tool } = setup(), estimate = tool.estimate.bind(tool)
  tool.estimate = async (...args) => { const quote = await estimate(...args); quote.createdAt = '2020-01-01T00:00:00.000Z'; quote.validUntil = '2020-01-01T00:01:00.000Z'; return quote }
  assert.equal((await broker.preflight(request(), signal)).ready, false)
})

test('elapsed estimate expiry invalidates stored ready result', async () => {
  const registry = new ToolRegistry(); registry.register(new MockSyncImageTool())
  let now = new Date()
  const broker = new ToolBroker(registry, { now: () => now }), req = request()
  now = new Date(Date.now() + 1000)
  const result = await broker.preflight(req, signal)
  assert.equal(result.ready, true)
  now = new Date(Date.now() + 120000)
  assert.throws(() => broker.assertCurrent(req, result), (e: unknown) => (e as { message: string }).message === 'estimate-expired')
})

test('mismatched validation fingerprint and quote decision are rejected', async () => {
  const { broker, tool } = setup(), validate = tool.validate.bind(tool), estimate = tool.estimate.bind(tool)
  tool.validate = async (...args) => ({ ...await validate(...args), requestFingerprint: `sha256:${'b'.repeat(64)}` })
  assert.equal((await broker.preflight(request(), signal)).ready, false)
  tool.validate = validate
  tool.estimate = async (...args) => ({ ...await estimate(...args), routingDecisionId: randomUUID() })
  assert.equal((await broker.preflight(request(), signal)).ready, false)
})

test('malformed health and provider errors are normalized without secret leakage', async () => {
  const { broker, tool } = setup()
  tool.health = async () => { throw { code: 'network', message: 'SECRET', stack: 'SECRET', headers: { token: 'SECRET' } } }
  let result = await broker.preflight(request(), signal)
  assert.equal(result.ready, false)
  assert.ok(!JSON.stringify(result).includes('SECRET'))
  tool.health = async () => ({ toolId: 'wrong.tool', availability: 'available', checkedAt: new Date().toISOString(), issues: [] })
  result = await broker.preflight(request(), signal)
  assert.equal(result.ready, false)
})

test('Broker timeout and abort terminate waiting without cancel/submit', async () => {
  const { registry, tool } = setup()
  tool.health = () => new Promise(() => {})
  const broker = new ToolBroker(registry, { timeoutMs: 5 })
  const result = await broker.preflight(request(), signal)
  assert.equal(result.ready, false)
  assert.equal(result.blockingIssues[0].code, 'timeout')
  const controller = new AbortController(), pending = broker.preflight(request(), controller.signal)
  controller.abort()
  await assert.rejects(pending)
  assert.equal(tool.counts.cancelCount, 0); assert.equal(tool.counts.submitCount, 0)
})

test('concurrent preflights cannot resurrect a superseded decision', async () => {
  const { broker, tool } = setup(new MockSyncImageTool({ delayMs: 5 })), req = request()
  const first = broker.preflight(req, signal)
  tool.options.delayMs = 0
  const second = await broker.preflight(req, signal)
  assert.equal(second.ready, true)
  assert.equal((await first).ready, false)
  broker.assertCurrent(req, second)
})

test('project/task/fingerprint/tool handle ownership enforced on all lifecycle calls', async () => {
  const { broker, ctx, id, handle, tool } = await videoExecution()
  const callers = [{ ...ctx, projectId: randomUUID() }, { ...ctx, taskId: randomUUID() }, { ...ctx, requestFingerprint: `sha256:${'b'.repeat(64)}` }]
  for (const caller of callers) {
    await assert.rejects(broker.status(caller, id, handle, signal))
    await assert.rejects(broker.result(caller, id, 'video.textToVideo', handle, signal))
    await assert.rejects(broker.cancel(caller, id, handle, signal))
    await assert.rejects(broker.recover(caller, id, handle, signal))
  }
  await assert.rejects(broker.status(ctx, id, { ...handle, externalTaskId: randomUUID() }, signal))
  assert.equal((await broker.status(ctx, id, handle, signal)).state, 'queued')
  assert.equal((await broker.recover(ctx, id, handle, signal)).state, 'recovered')
  assert.equal(tool.counts.cancelCount, 0); assert.equal(tool.counts.submitCount, 1)
})

test('Broker output issuer rejects paths, URLs, unsigned handles and cross-task access', async () => {
  const { broker, ctx, id, handle, tool } = await videoExecution()
  const metadata = { mime: 'video/mp4' as const, resolution: { width: 1024, height: 1024 }, durationSeconds: 5 }
  const output = broker.issueOutput(ctx, id, metadata)
  assert.deepEqual(broker.readOutput(ctx, id, output), metadata)
  for (const bad of ['C:\\temp\\a.mp4', 'D:\\a.mp4', 'file:///a', 'http://random.invalid/a', 'https://provider.invalid/a?token=secret', 'unissued']) assert.throws(() => broker.readOutput(ctx, id, bad))
  assert.throws(() => broker.readOutput({ ...ctx, taskId: randomUUID() }, id, output))
  tool.advance(handle, 'succeeded')
  await assert.rejects(broker.result(ctx, id, 'video.textToVideo', handle, signal))
  // Simulate trusted adapter ingestion callback returning the host-issued handle.
  const original = tool.result.bind(tool)
  tool.result = async (...args) => { const result = await original(...args); if (result.state === 'completed') result.output.videos[0].handle = output; return result }
  assert.equal((await broker.result(ctx, id, 'video.textToVideo', handle, signal)).state, 'completed')
  tool.result = async (...args) => { const result = await original(...args); if (result.state === 'completed') { result.output.videos[0].handle = output; result.output.videos[0].durationSeconds = 99 }; return result }
  await assert.rejects(broker.result(ctx, id, 'video.textToVideo', handle, signal))
})

test('accepted and unknown-submission lock Broker against automatic rerouting', async () => {
  const accepted = await videoExecution()
  await assert.rejects(accepted.broker.preflight(accepted.req, signal))
  const { broker, tool } = setup(), req = request(), preflight = await broker.preflight(req, signal)
  broker.markUnknownSubmission(req, preflight)
  await assert.rejects(broker.preflight(req, signal))
  assert.equal(tool.counts.submitCount, 0)
})

test('late completed output after waiting-stopped remains cancelled at Broker boundary', async () => {
  const { broker, ctx, id, handle, tool } = await videoExecution()
  tool.options.cancel = 'waiting-stopped'
  assert.equal((await broker.cancel(ctx, id, handle, signal)).state, 'waiting-stopped')
  tool.advance(handle, 'succeeded')
  const result = await broker.result(ctx, id, 'video.textToVideo', handle, signal)
  assert.equal(result.state, 'failed')
  if (result.state === 'failed') assert.equal(result.error.code, 'cancelled')
})

test('synchronous outputs are host-issued without inventing an external task', async () => {
  const { broker } = setup(), req = request(), preflight = await broker.preflight(req, signal), ctx = execution(req, preflight)
  const id = broker.openExecution(req, preflight, ctx, null)
  const metadata = { mime: 'image/png' as const, resolution: { width: 1024, height: 1024 } }
  const handle = broker.issueOutput(ctx, id, metadata)
  assert.equal(broker.acceptOutput(ctx, id, 'image.generate', { images: [{ handle, ...metadata }] }).images[0].handle, handle)
  for (const invalid of ['C:\\a.png', 'file:///a.png', 'http://random.invalid/a', 'https://private.invalid/a', 'unissued']) {
    assert.throws(() => broker.acceptOutput(ctx, id, 'image.generate', { images: [{ handle: invalid, ...metadata }] }))
  }
})

test('trusted provider-auto execution preserves a host-validated output resolution', async () => {
  const { broker } = setup(),
    req = request(),
    preflight = await broker.preflight(req, signal),
    ctx = execution(req, preflight)
  const id = broker.openExecution(req, preflight, ctx, null, {
    allowProviderSelectedResolution: true,
  })
  const metadata = {
    mime: 'image/png' as const,
    resolution: { width: 1536, height: 864 },
  }
  const handle = broker.issueOutput(ctx, id, metadata)
  assert.equal(
    broker.acceptOutput(ctx, id, 'image.generate', {
      images: [{ handle, ...metadata }],
    }).images[0].resolution.width,
    1536,
  )
})

test('a second execution cannot adopt an existing external identity or output', async () => {
  const first = await videoExecution(), req = request(true)
  req.projectId = first.req.projectId
  const preflight = await first.broker.preflight(req, signal), ctx = execution(req, preflight)
  assert.throws(() => first.broker.openExecution(req, preflight, ctx, first.handle))
  const secondHandle = { ...first.handle, externalTaskId: randomUUID() }
  const id = first.broker.openExecution(req, preflight, ctx, secondHandle)
  const output = first.broker.issueOutput(first.ctx, first.id, { mime: 'video/mp4', resolution: { width: 1024, height: 1024 }, durationSeconds: 5 })
  assert.throws(() => first.broker.readOutput(ctx, id, output))
  await assert.rejects(first.broker.status(ctx, id, first.handle, signal))
})
