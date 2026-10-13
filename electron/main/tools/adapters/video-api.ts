import type { CapabilityInput } from '../../../../src/shared/capabilities/index.js'
import type { ToolCallContext, ToolCancelResult, ToolExecutionContext } from '../../../../src/shared/tools.js'
import {
  VideoLifecycleAdapter,
  acceptedVideoTaskSchema,
  videoTaskResultSchema,
  videoTaskStatusSchema,
  type VideoCapability,
} from './video-lifecycle.js'

export type {
  VideoApiTool,
  VideoCapability,
  VideoDiagnosticStage,
  VideoExecutionAccess,
} from './video-lifecycle.js'

/** Reference Video Protocol v1 is an internal development fixture contract. */
export class VideoApiAdapter extends VideoLifecycleAdapter {
  protected override seedCapability() { return 'supported' as const }
  protected override submitPath() { return 'tasks' }
  protected override taskPath(id: string) { return `tasks/${encodeURIComponent(id)}` }
  protected override resultPath(id: string) { return `${this.taskPath(id)}/result` }
  protected override cancelPath(id: string) { return this.taskPath(id) }
  protected override requestBody<C extends VideoCapability>(capability: C, input: CapabilityInput<C>, context: ToolExecutionContext, frames: { assetVersionId: string; mime: string; base64: string }[]): unknown {
    return { protocol: 'director-video-reference-v1', capability, model: context.model, input, frames }
  }
  protected override parseAccepted(raw: unknown) { return acceptedVideoTaskSchema.parse(raw) }
  protected override parseStatus(raw: unknown, _id: string) { return videoTaskStatusSchema.parse(raw) }
  protected override parseResult(raw: unknown, _id: string) { return videoTaskResultSchema.parse(raw) }
  protected override parseCancel(_raw: unknown, _id: string): ToolCancelResult { return { state: 'cancelled' } }
  override async estimate<C extends VideoCapability>(capability: C, input: CapabilityInput<C>, context: ToolCallContext, signal: AbortSignal) {
    const estimate = await super.estimate(capability, input, context, signal)
    return { ...estimate, basis: `Reference Video Protocol v1 / ${this.profile.modelId}; no reliable provider price` }
  }
}
