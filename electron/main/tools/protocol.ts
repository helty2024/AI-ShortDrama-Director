import type {
  Capability,
  CapabilityInput,
  CapabilityOutput,
} from '../../../src/shared/capabilities/index.js'
import type { GenerationEstimate } from '../../../src/shared/generation.js'
import type {
  ToolDescriptor,
  ToolHealth,
  ToolValidation,
  ToolTaskHandle,
  ToolTaskStatus,
  ToolCancelResult,
  ToolRecoverResult,
  ToolSubmitResult,
  ToolResult,
  ToolCallContext,
  ToolExecutionContext,
} from '../../../src/shared/tools.js'

/** Lifecycle only. Each method's payload is tied to its capability's runtime schema.
 * Future adapters must validate boundary inputs/outputs using the exported schemas.
 * validate/estimate are read-only: no submit, upload, billing or task-state writes.
 * Context carries references, not authorization enforcement; Broker owns that check.
 * Exceptions crossing the future Broker boundary must be normalized to ToolError.
 */
export interface ToolAdapter<C extends Capability> {
  describe(): ToolDescriptor
  health(signal: AbortSignal): Promise<ToolHealth>
  validate<K extends C>(
    capability: K,
    input: CapabilityInput<K>,
    context: ToolCallContext,
    signal: AbortSignal,
  ): Promise<ToolValidation>
  estimate<K extends C>(
    capability: K,
    input: CapabilityInput<K>,
    context: ToolCallContext,
    signal: AbortSignal,
  ): Promise<GenerationEstimate>
  submit<K extends C>(
    capability: K,
    input: CapabilityInput<K>,
    context: ToolExecutionContext,
    signal: AbortSignal,
  ): Promise<ToolSubmitResult<CapabilityOutput<K>>>
  status(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolTaskStatus>
  result<K extends C>(
    capability: K,
    handle: ToolTaskHandle,
    signal: AbortSignal,
  ): Promise<ToolResult<CapabilityOutput<K>>>
  cancel(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolCancelResult>
  recover(
    handle: ToolTaskHandle,
    signal: AbortSignal,
  ): Promise<ToolRecoverResult>
}
