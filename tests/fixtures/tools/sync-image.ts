import type { ToolAdapter } from '../../../electron/main/tools/protocol.js'
import type { CapabilityInput, CapabilityOutput } from '../../../src/shared/capabilities/index.js'
import type { ToolCallContext, ToolExecutionContext, ToolTaskHandle, ToolTaskStatus, ToolSubmitResult, ToolResult, ToolCancelResult, ToolRecoverResult } from '../../../src/shared/tools.js'
import { counters, descriptor, health, validate, estimate, wait, error, OutputIssuer, type Options } from './support.js'

type ImageCapability = 'image.generate' | 'image.referenceGenerate'
export class MockSyncImageTool implements ToolAdapter<ImageCapability> {
  readonly counts = counters()
  readonly outputs = new OutputIssuer()
  readonly options: Options
  constructor(options: Options = {}) { this.options = options }
  describe() { return descriptor(false, this.options) }
  health(signal: AbortSignal) { return health(this.describe(), this.options, signal) }
  async validate<C extends ImageCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolCallContext, signal: AbortSignal) {
    this.counts.validateCount++
    await wait(signal, this.options.delayMs)
    return validate(this.describe(), cap, input, ctx, this.options)
  }
  async estimate<C extends ImageCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolCallContext, signal: AbortSignal) {
    this.counts.estimateCount++
    await wait(signal, this.options.delayMs)
    if (!validate(this.describe(), cap, input, ctx, this.options).valid) throw error('validation')
    return estimate(ctx, this.options)
  }
  async submit<C extends ImageCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolExecutionContext, signal: AbortSignal): Promise<ToolSubmitResult<CapabilityOutput<C>>> {
    this.counts.submitCount++
    await wait(signal, this.options.delayMs)
    if (!validate(this.describe(), cap, input, ctx, this.options).valid) throw error('validation')
    if (this.options.failure) throw error(this.options.failure)
    this.counts.uploadCount += 'references' in input ? input.references.length : 0
    this.counts.billingCount++
    return { state: 'completed', output: this.outputs.output(cap, input, ctx, this.options.fault) }
  }
  async status(_handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolTaskStatus> { await wait(signal); throw error('validation') }
  async result<C extends ImageCapability>(_cap: C, _handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolResult<CapabilityOutput<C>>> { await wait(signal); throw error('validation') }
  async cancel(_handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolCancelResult> { await wait(signal); return { state: 'unsupported' } }
  async recover(_handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolRecoverResult> { await wait(signal); return { state: 'unsupported' } }
}
