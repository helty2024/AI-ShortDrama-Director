import { randomUUID } from 'node:crypto'
import type { ToolAdapter } from '../../../electron/main/tools/protocol.js'
import type { CapabilityInput, CapabilityOutput } from '../../../src/shared/capabilities/index.js'
import { toolTaskHandleSchema, type ToolCallContext, type ToolExecutionContext, type ToolTaskHandle, type ToolTaskStatus, type ToolSubmitResult, type ToolResult, type ToolCancelResult, type ToolRecoverResult } from '../../../src/shared/tools.js'
import { counters, descriptor, health, validate, estimate, wait, error, OutputIssuer, type Options } from './support.js'

type VideoCapability = 'video.textToVideo' | 'video.imageToVideo'
interface Job {
  capability: VideoCapability
  input: CapabilityInput<VideoCapability>
  context: ToolExecutionContext
  status: ToolTaskStatus
  stopped: boolean
  output?: CapabilityOutput<VideoCapability>
}
export class MockAsyncVideoTool implements ToolAdapter<VideoCapability> {
  readonly counts = counters()
  readonly outputs = new OutputIssuer()
  readonly options: Options
  private readonly jobs = new Map<string, Job>()
  constructor(options: Options = {}) { this.options = options }
  describe() { return descriptor(true, this.options) }
  health(signal: AbortSignal) { return health(this.describe(), this.options, signal) }
  async validate<C extends VideoCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolCallContext, signal: AbortSignal) {
    this.counts.validateCount++
    await wait(signal, this.options.delayMs)
    return validate(this.describe(), cap, input, ctx, this.options)
  }
  async estimate<C extends VideoCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolCallContext, signal: AbortSignal) {
    this.counts.estimateCount++
    await wait(signal, this.options.delayMs)
    if (!validate(this.describe(), cap, input, ctx, this.options).valid) throw error('validation')
    return estimate(ctx, this.options)
  }
  async submit<C extends VideoCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolExecutionContext, signal: AbortSignal): Promise<ToolSubmitResult<CapabilityOutput<C>>> {
    this.counts.submitCount++
    await wait(signal, this.options.delayMs)
    if (!validate(this.describe(), cap, input, ctx, this.options).valid) throw error('validation')
    if (this.options.failure) throw error(this.options.failure)
    this.counts.uploadCount += 'firstFrameAssetVersionId' in input ? 1 + Number(input.lastFrameAssetVersionId !== null) : 0
    this.counts.billingCount++
    const handle = { toolId: this.describe().id, toolVersion: '1.0.0', externalTaskId: randomUUID() }
    this.jobs.set(handle.externalTaskId, { capability: cap, input: structuredClone(input), context: structuredClone(ctx), status: { state: 'queued', progress: 0 }, stopped: false })
    // Simulate an accepted remote request whose receipt was lost. Never expose its ID.
    if (this.options.ambiguous) return { state: 'unknown', error: error('unknown-submission'), resubmitAllowed: false }
    return { state: 'accepted', handle }
  }
  private job(handle: ToolTaskHandle): Job {
    if (!toolTaskHandleSchema.safeParse(handle).success || handle.toolId !== this.describe().id || handle.toolVersion !== '1.0.0') throw error('validation')
    const job = this.jobs.get(handle.externalTaskId)
    if (!job) throw error('validation')
    return job
  }
  // Explicit remote simulator event, never driven by polling or recovery.
  advance(handle: ToolTaskHandle, state: 'running' | 'succeeded' | 'failed' | 'unknown') {
    const job = this.job(handle)
    if (['succeeded', 'failed', 'cancelled'].includes(job.status.state)) return
    job.status = state === 'running' ? { state, progress: 0.5 } : state === 'failed' ? { state, error: error('provider') } : state === 'unknown' ? { state, reason: 'status-unavailable', resubmitAllowed: false } : { state }
  }
  async status(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolTaskStatus> { await wait(signal, this.options.delayMs); return structuredClone(this.job(handle).status) }
  async result<C extends VideoCapability>(cap: C, handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolResult<CapabilityOutput<C>>> {
    await wait(signal, this.options.delayMs)
    const job = this.job(handle)
    if (job.capability !== cap) throw error('validation')
    if (job.stopped || job.status.state === 'cancelled') return { state: 'failed', error: error('cancelled') }
    if (job.status.state === 'failed') return { state: 'failed', error: job.status.error }
    if (job.status.state !== 'succeeded') return { state: 'not-ready', status: structuredClone(job.status) }
    job.output ??= this.outputs.output(job.capability, job.input, job.context, this.options.fault)
    return { state: 'completed', output: structuredClone(job.output) as CapabilityOutput<C> }
  }
  async cancel(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolCancelResult> {
    await wait(signal)
    const job = this.job(handle)
    this.counts.cancelCount++
    const mode = this.options.cancel ?? 'cancelled'
    if (mode === 'unsupported') return { state: mode }
    job.stopped = true
    if (mode === 'waiting-stopped') return { state: mode, computationMayContinue: true }
    job.status = { state: 'cancelled' }
    return { state: 'cancelled' }
  }
  async recover(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolRecoverResult> {
    await wait(signal, this.options.delayMs)
    if (!toolTaskHandleSchema.safeParse(handle).success || handle.toolId !== this.describe().id || handle.toolVersion !== '1.0.0') throw error('validation')
    if (!this.options.recover) return { state: 'unsupported' }
    if (!this.jobs.has(handle.externalTaskId)) return { state: 'unknown', resubmitAllowed: false }
    return { state: 'recovered', handle: structuredClone(handle), status: structuredClone(this.job(handle).status) }
  }
}
