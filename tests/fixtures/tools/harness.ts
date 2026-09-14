import type { CapabilityInput, CapabilityOutput } from '../../../src/shared/capabilities/index.js'
import type { ToolExecutionContext, ToolSubmitResult, ToolTaskHandle } from '../../../src/shared/tools.js'
import { MockAsyncVideoTool } from './async-video.js'
import { error } from './support.js'

// Test-only caller ownership and one-attempt latch; no routing, persistence or fallback.
export class VideoRequestHarness {
  private submission?: Promise<ToolSubmitResult<CapabilityOutput<'video.textToVideo'>>>
  private handle?: ToolTaskHandle
  private readonly ctx: ToolExecutionContext
  private readonly input: CapabilityInput<'video.textToVideo'>
  private readonly tool: MockAsyncVideoTool
  constructor(tool: MockAsyncVideoTool, input: CapabilityInput<'video.textToVideo'>, ctx: ToolExecutionContext) { this.tool = tool; this.input = structuredClone(input); this.ctx = structuredClone(ctx) }
  submit(signal: AbortSignal) {
    this.submission ??= this.tool.submit('video.textToVideo', this.input, this.ctx, signal).then(result => {
      if (result.state === 'accepted') this.handle = structuredClone(result.handle)
      return result
    })
    return this.submission
  }
  private check(ctx: ToolExecutionContext, handle: ToolTaskHandle) {
    if (ctx.projectId !== this.ctx.projectId || ctx.taskId !== this.ctx.taskId || ctx.requestFingerprint !== this.ctx.requestFingerprint || !this.handle || handle.toolId !== this.handle.toolId || handle.toolVersion !== this.handle.toolVersion || handle.externalTaskId !== this.handle.externalTaskId) throw error('authorization')
  }
  async status(ctx: ToolExecutionContext, handle: ToolTaskHandle, signal: AbortSignal) { this.check(ctx, handle); return this.tool.status(handle, signal) }
  async result(ctx: ToolExecutionContext, handle: ToolTaskHandle, signal: AbortSignal) { this.check(ctx, handle); return this.tool.result('video.textToVideo', handle, signal) }
  async cancel(ctx: ToolExecutionContext, handle: ToolTaskHandle, signal: AbortSignal) { this.check(ctx, handle); return this.tool.cancel(handle, signal) }
  async recover(ctx: ToolExecutionContext, handle: ToolTaskHandle, signal: AbortSignal) { this.check(ctx, handle); return this.tool.recover(handle, signal) }
}
