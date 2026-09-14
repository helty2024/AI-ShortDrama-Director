import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { capabilityContracts, type CapabilityInput } from '../../src/shared/capabilities/index.js'
import { toolErrorSchema, toolSubmitResultSchema, toolResultSchema, toolTaskStatusSchema, toolCancelResultSchema, toolRecoverResultSchema, type ToolError } from '../../src/shared/tools.js'
import { MockSyncImageTool } from '../fixtures/tools/sync-image.js'
import { MockAsyncVideoTool } from '../fixtures/tools/async-video.js'
import { VideoRequestHarness } from '../fixtures/tools/harness.js'
import { context, error, type Fault } from '../fixtures/tools/support.js'

const signal = new AbortController().signal
const image: CapabilityInput<'image.generate'> = { prompt: 'A room', negativePrompt: '', resolution: { width: 1024, height: 1024 }, aspectRatio: '1:1', seed: 7, count: 2, outputMime: 'image/png' }
const video: CapabilityInput<'video.textToVideo'> = { prompt: 'A person enters', negativePrompt: '', resolution: { width: 1024, height: 1024 }, aspectRatio: '1:1', seed: 7, durationSeconds: 5, fps: 24, outputMime: 'video/mp4', audio: 'none' }
const isError = (code: ToolError['code']) => (raw: unknown) => { const value = toolErrorSchema.parse(raw); assert.equal(value.code, code); assert.ok(!JSON.stringify(value).includes('SECRET')); return true }
async function accepted(tool: MockAsyncVideoTool) {
  const ctx = context(tool.describe(), 'video.textToVideo', video)
  const result = toolSubmitResultSchema(capabilityContracts['video.textToVideo'].output).parse(await tool.submit('video.textToVideo', video, ctx, signal))
  assert.equal(result.state, 'accepted')
  if (result.state !== 'accepted') throw new Error('Expected acceptance')
  return { handle: result.handle, ctx }
}

test('sync image completes immediately, outputs are owned, no synthetic remote task', async () => {
  const tool = new MockSyncImageTool()
  const ctx = context(tool.describe(), 'image.generate', image)
  const result = toolSubmitResultSchema(capabilityContracts['image.generate'].output).parse(await tool.submit('image.generate', image, ctx, signal))
  assert.equal(result.state, 'completed')
  if (result.state !== 'completed') return
  assert.equal(result.output.images.length, 2)
  for (const item of result.output.images) {
    assert.equal(tool.outputs.read(ctx, item.handle), item.handle)
    assert.throws(() => tool.outputs.read({ ...ctx, taskId: randomUUID() }, item.handle), isError('authorization'))
    assert.throws(() => tool.outputs.read({ ...ctx, requestFingerprint: `sha256:${'b'.repeat(64)}` }, item.handle), isError('authorization'))
  }
  assert.ok(!('handle' in result))
  const fake = { toolId: 'mock.image', toolVersion: '1.0.0', externalTaskId: 'none' }
  await assert.rejects(tool.status(fake, signal), isError('validation'))
  await assert.rejects(tool.result('image.generate', fake, signal), isError('validation'))
  assert.equal((await tool.cancel(fake, signal)).state, 'unsupported')
  assert.equal((await tool.recover(fake, signal)).state, 'unsupported')
})

test('image tool limits reject publicly valid references and resolution; allowed references upload only at submit', async () => {
  const tool = new MockSyncImageTool()
  const references = Array.from({ length: 4 }, () => ({ assetVersionId: randomUUID(), role: 'identity' as const, weight: 1 }))
  const input = { ...image, references }
  capabilityContracts['image.referenceGenerate'].input.parse(input)
  assert.equal((await tool.validate('image.referenceGenerate', input, context(tool.describe(), 'image.referenceGenerate', input), signal)).valid, false)
  const small = { ...image, resolution: { width: 512, height: 512 } }
  capabilityContracts['image.generate'].input.parse(small)
  assert.equal((await tool.validate('image.generate', small, context(tool.describe(), 'image.generate', small), signal)).valid, false)
  const allowed = { ...input, references: references.slice(0, 3) }
  const ctx = context(tool.describe(), 'image.referenceGenerate', allowed)
  assert.equal((await tool.validate('image.referenceGenerate', allowed, ctx, signal)).valid, true)
  assert.equal(tool.counts.uploadCount, 0)
  assert.equal((await tool.submit('image.referenceGenerate', allowed, ctx, signal)).state, 'completed')
  assert.equal(tool.counts.uploadCount, 3)
})

for (const unknownEstimate of [false, true]) test(`both tools preflight has zero generation effects; estimate unknown=${unknownEstimate}`, async () => {
  const imageTool = new MockSyncImageTool({ unknownEstimate })
  const videoTool = new MockAsyncVideoTool({ unknownEstimate })
  const imageCtx = context(imageTool.describe(), 'image.generate', image)
  const videoCtx = context(videoTool.describe(), 'video.textToVideo', video)
  assert.equal((await imageTool.validate('image.generate', image, imageCtx, signal)).valid, true)
  assert.equal((await videoTool.validate('video.textToVideo', video, videoCtx, signal)).valid, true)
  for (const tool of [imageTool, videoTool]) assert.deepEqual(tool.counts, { validateCount: 1, estimateCount: 0, submitCount: 0, uploadCount: 0, billingCount: 0, cancelCount: 0 })
  const quotes = [await imageTool.estimate('image.generate', image, imageCtx, signal), await videoTool.estimate('video.textToVideo', video, videoCtx, signal)]
  for (const quote of quotes) {
    assert.equal(quote.cost.status, unknownEstimate ? 'unknown' : 'known')
    assert.equal(quote.estimatedDurationRange.status, unknownEstimate ? 'unknown' : 'known')
    assert.notEqual(quote.billingRisk, 'free')
    if (quote.cost.status === 'unknown') assert.ok(!('estimatedCost' in quote.cost))
  }
  for (const tool of [imageTool, videoTool]) assert.deepEqual(tool.counts, { validateCount: 1, estimateCount: 1, submitCount: 0, uploadCount: 0, billingCount: 0, cancelCount: 0 })
})

test('video accepted -> queued -> running -> succeeded, stable outputs and query-only recovery', async () => {
  const tool = new MockAsyncVideoTool({ recover: true })
  const { handle, ctx } = await accepted(tool)
  assert.equal(toolTaskStatusSchema.parse(await tool.status(handle, signal)).state, 'queued')
  assert.equal((await tool.result('video.textToVideo', handle, signal)).state, 'not-ready')
  tool.advance(handle, 'running')
  assert.equal((await tool.status(handle, signal)).state, 'running')
  assert.equal((await tool.result('video.textToVideo', handle, signal)).state, 'not-ready')
  assert.equal(toolRecoverResultSchema.parse(await tool.recover(handle, signal)).state, 'recovered')
  tool.advance(handle, 'succeeded')
  const result = toolResultSchema(capabilityContracts['video.textToVideo'].output).parse(await tool.result('video.textToVideo', handle, signal))
  assert.equal(result.state, 'completed')
  assert.deepEqual(await tool.result('video.textToVideo', handle, signal), result)
  if (result.state === 'completed') tool.outputs.read(ctx, result.output.videos[0].handle)
  assert.equal(tool.counts.submitCount, 1)
})

test('image-to-video validates reference IDs and uploads frames only on submission', async () => {
  const tool = new MockAsyncVideoTool()
  const input = { ...video, firstFrameAssetVersionId: randomUUID(), lastFrameAssetVersionId: randomUUID() }
  const ctx = context(tool.describe(), 'video.imageToVideo', input)
  assert.equal((await tool.validate('video.imageToVideo', input, ctx, signal)).valid, true)
  await tool.estimate('video.imageToVideo', input, ctx, signal)
  assert.equal(tool.counts.uploadCount, 0)
  const result = await tool.submit('video.imageToVideo', input, ctx, signal)
  assert.equal(result.state, 'accepted')
  if (result.state !== 'accepted') return
  assert.equal(tool.counts.uploadCount, 2)
  tool.advance(result.handle, 'succeeded')
  assert.equal((await tool.result('video.imageToVideo', result.handle, signal)).state, 'completed')
  await assert.rejects(tool.result('video.textToVideo', result.handle, signal), isError('validation'))
})

test('remote failure and unknown status remain distinct from completion', async () => {
  const tool = new MockAsyncVideoTool({ recover: true })
  const { handle } = await accepted(tool)
  tool.advance(handle, 'unknown')
  assert.equal((await tool.status(handle, signal)).state, 'unknown')
  assert.equal((await tool.result('video.textToVideo', handle, signal)).state, 'not-ready')
  await tool.recover(handle, signal)
  tool.advance(handle, 'failed')
  const result = await tool.result('video.textToVideo', handle, signal)
  assert.equal(result.state, 'failed')
  if (result.state === 'failed') assert.equal(result.error.code, 'provider')
  assert.equal(tool.counts.submitCount, 1)
})

for (const cancel of ['cancelled', 'unsupported', 'waiting-stopped'] as const) test(`cancel semantics: ${cancel}, including late remote completion`, async () => {
  const tool = new MockAsyncVideoTool({ cancel, recover: true })
  const { handle } = await accepted(tool)
  assert.equal(toolCancelResultSchema.parse(await tool.cancel(handle, signal)).state, cancel)
  tool.advance(handle, 'succeeded')
  const result = await tool.result('video.textToVideo', handle, signal)
  assert.equal(result.state, cancel === 'unsupported' ? 'completed' : 'failed')
  if (result.state === 'failed') assert.equal(result.error.code, 'cancelled')
  const recovery = await tool.recover(handle, signal)
  assert.equal(recovery.state, 'recovered')
  if (recovery.state === 'recovered') assert.equal(recovery.status.state, cancel === 'cancelled' ? 'cancelled' : 'succeeded')
  assert.equal(tool.counts.submitCount, 1)
})

test('recover unsupported, missing external identity, and invalid handles never submit', async () => {
  const tool = new MockAsyncVideoTool()
  const { handle } = await accepted(tool)
  assert.equal((await tool.recover(handle, signal)).state, 'unsupported')
  tool.options.recover = true
  assert.deepEqual(await tool.recover({ ...handle, externalTaskId: 'missing' }, signal), { state: 'unknown', resubmitAllowed: false })
  for (const bad of [{ ...handle, toolId: 'wrong.tool' }, { ...handle, toolVersion: '2.0.0' }, { ...handle, externalTaskId: '' }]) {
    for (const operation of [() => tool.status(bad, signal), () => tool.result('video.textToVideo', bad, signal), () => tool.cancel(bad, signal), () => tool.recover(bad, signal)]) await assert.rejects(operation(), isError('validation'))
  }
  assert.equal(tool.counts.submitCount, 1)
})

test('ambiguous submit retains unknown receipt: repeated caller attempts do not resubmit or fallback', async () => {
  const tool = new MockAsyncVideoTool({ ambiguous: true, recover: true })
  const request = new VideoRequestHarness(tool, video, context(tool.describe(), 'video.textToVideo', video))
  const results = await Promise.all([request.submit(signal), request.submit(signal)])
  for (const result of results) {
    assert.equal(result.state, 'unknown')
    if (result.state === 'unknown') { assert.equal(result.resubmitAllowed, false); assert.equal(result.error.retryability, 'query-only'); assert.ok(!('handle' in result)) }
  }
  await tool.recover({ toolId: 'mock.video', toolVersion: '1.0.0', externalTaskId: 'unconfirmed' }, signal)
  await request.submit(signal)
  assert.equal(tool.counts.submitCount, 1)
  assert.equal(tool.counts.billingCount, 1)
})

test('request-scoped harness prevents cross-request/project/fingerprint access for all handle methods', async () => {
  const tool = new MockAsyncVideoTool({ recover: true })
  const a = context(tool.describe(), 'video.textToVideo', video)
  const bInput = { ...video, prompt: 'Another scene' }
  const b = context(tool.describe(), 'video.textToVideo', bInput)
  const first = new VideoRequestHarness(tool, video, a)
  const second = new VideoRequestHarness(tool, bInput, b)
  const ra = await first.submit(signal), rb = await second.submit(signal)
  assert.equal(ra.state, 'accepted'); assert.equal(rb.state, 'accepted')
  if (ra.state !== 'accepted' || rb.state !== 'accepted') return
  for (const method of ['status', 'result', 'cancel', 'recover'] as const) {
    await assert.rejects(first[method](a, rb.handle, signal), isError('authorization'))
    await assert.rejects(first[method](b, ra.handle, signal), isError('authorization'))
    await assert.rejects(first[method]({ ...a, requestFingerprint: b.requestFingerprint }, ra.handle, signal), isError('authorization'))
  }
  tool.advance(rb.handle, 'succeeded')
  const output = await second.result(b, rb.handle, signal)
  assert.equal(output.state, 'completed')
  if (output.state === 'completed') assert.throws(() => tool.outputs.read(a, output.output.videos[0].handle), isError('authorization'))
  assert.equal(tool.counts.cancelCount, 0)
})

for (const state of ['healthy', 'degraded', 'unavailable', 'dependency', 'model'] as const) test(`static description versus dynamic health: ${state}`, async () => {
  for (const tool of [new MockSyncImageTool({ health: state }), new MockAsyncVideoTool({ health: state })]) {
    assert.equal(tool.describe().availability, 'unknown')
    assert.equal(tool.describe().capabilities.length, 2)
    const report = await tool.health(signal)
    assert.equal(report.availability, ['healthy', 'degraded'].includes(state) ? 'available' : 'unavailable')
    assert.equal(report.issues.length, state === 'healthy' ? 0 : 1)
    assert.equal(tool.counts.submitCount, 0)
  }
  const tool = new MockSyncImageTool({ health: state })
  const ctx = context(tool.describe(), 'image.generate', image)
  const result = await tool.validate('image.generate', image, ctx, signal)
  assert.equal(result.valid, ['healthy', 'degraded'].includes(state))
  assert.equal(result.warnings.length, state === 'degraded' ? 1 : 0)
  if (!result.valid) await assert.rejects(tool.submit('image.generate', image, ctx, signal), isError('validation'))
})

const faults: Fault[] = ['missing', 'mime', 'resolution', 'duration', 'handle', 'file', 'http', 'private-url', 'capability', 'unissued', 'mismatch', 'wrong-duration']
for (const fault of faults) test(`both output boundaries reject ${fault}`, async () => {
  const imageTool = new MockSyncImageTool({ fault })
  await assert.rejects(imageTool.submit('image.generate', image, context(imageTool.describe(), 'image.generate', image), signal), isError('malformed-response'))
  const videoTool = new MockAsyncVideoTool({ fault })
  const { handle } = await accepted(videoTool)
  videoTool.advance(handle, 'succeeded')
  await assert.rejects(videoTool.result('video.textToVideo', handle, signal), isError('malformed-response'))
})

test('normalized failures redact raw provider details across both tool boundaries', async () => {
  for (const code of ['network', 'timeout', 'provider', 'dependency', 'resource', 'cancelled', 'unknown-submission', 'malformed-response'] as const) {
    isError(code)(error(code))
    const imageTool = new MockSyncImageTool({ failure: code })
    await assert.rejects(imageTool.submit('image.generate', image, context(imageTool.describe(), 'image.generate', image), signal), isError(code))
    const videoTool = new MockAsyncVideoTool({ failure: code })
    await assert.rejects(accepted(videoTool), isError(code))
  }
})

test('health timeout, validate/estimate abort have no generation effects', async () => {
  const imageTool = new MockSyncImageTool({ healthTimeout: true, delayMs: 2 })
  const videoTool = new MockAsyncVideoTool({ healthTimeout: true, delayMs: 2 })
  for (const tool of [imageTool, videoTool]) await assert.rejects(tool.health(signal), isError('timeout'))
  const ci = context(imageTool.describe(), 'image.generate', image), cv = context(videoTool.describe(), 'video.textToVideo', video)
  const abort = new AbortController()
  const pending = [imageTool.validate('image.generate', image, ci, abort.signal), imageTool.estimate('image.generate', image, ci, abort.signal), videoTool.validate('video.textToVideo', video, cv, abort.signal), videoTool.estimate('video.textToVideo', video, cv, abort.signal)]
  abort.abort()
  for (const promise of pending) await assert.rejects(promise, isError('cancelled'))
  for (const tool of [imageTool, videoTool]) assert.deepEqual(tool.counts, { validateCount: 1, estimateCount: 1, submitCount: 0, uploadCount: 0, billingCount: 0, cancelCount: 0 })
})

test('polling abort only stops waiting; remote task still completes without implicit cancel', async () => {
  const tool = new MockAsyncVideoTool({ recover: true })
  const { handle } = await accepted(tool)
  tool.options.delayMs = 10
  const abort = new AbortController()
  const polling = tool.status(handle, abort.signal)
  abort.abort()
  await assert.rejects(polling, isError('cancelled'))
  assert.equal(tool.counts.cancelCount, 0)
  tool.advance(handle, 'succeeded')
  assert.equal((await tool.recover(handle, signal)).state, 'recovered')
  assert.equal((await tool.result('video.textToVideo', handle, signal)).state, 'completed')
  assert.equal(tool.counts.submitCount, 1)
})

test('fingerprint mismatch is rejected before upload or billing', async () => {
  const tool = new MockSyncImageTool()
  const ctx = context(tool.describe(), 'image.generate', image)
  const changed = { ...image, prompt: 'Different input' }
  assert.equal((await tool.validate('image.generate', changed, ctx, signal)).valid, false)
  await assert.rejects(tool.submit('image.generate', changed, ctx, signal), isError('validation'))
  assert.equal(tool.counts.uploadCount, 0); assert.equal(tool.counts.billingCount, 0)
})
