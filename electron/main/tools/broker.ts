import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { capabilitySnapshotSchema, capabilityContracts, type Capability, type CapabilityInput, type CapabilityOutput } from '../../../src/shared/capabilities/index.js'
import { imageOutputItemSchema, videoOutputItemSchema } from '../../../src/shared/capabilities/common.js'
import { routingPolicySchema, type RoutingDecision } from '../../../src/shared/routing.js'
import { generationEstimateSchema, type GenerationEstimate } from '../../../src/shared/generation.js'
import { toolCallContextSchema, toolExecutionContextSchema, toolHealthSchema, toolValidationSchema, toolTaskHandleSchema, toolTaskStatusSchema, toolResultSchema, toolCancelResultSchema, toolRecoverResultSchema, type ToolCallContext, type ToolExecutionContext, type ToolTaskHandle, type ToolHealth, type ToolValidation, type ToolError, type ToolResult } from '../../../src/shared/tools.js'
import { ToolRegistry, boundaryError, immutable, type RegisteredTool } from './registry.js'
import { route, staticReasons, type ToolCandidate, type Rejection } from './routing.js'
import { requestFingerprint } from './fingerprint.js'
import { normalizeToolError } from './errors.js'

export const brokerRequestSchema = z.strictObject({
  projectId: z.uuid(), requestId: z.uuid(), snapshot: capabilitySnapshotSchema,
  policy: routingPolicySchema,
})
export type BrokerRequest = z.infer<typeof brokerRequestSchema>
export interface PreflightResult {
  ready: boolean
  routingDecision: RoutingDecision | null
  health: ToolHealth | null
  validation: ToolValidation | null
  estimate: GenerationEstimate | null
  requestFingerprint: string | null
  validUntil: string | null
  blockingIssues: readonly ToolError[]
  rejectedCandidates: readonly Rejection[]
  candidates: readonly ToolCandidate[]
}
interface PreflightRecord { request: BrokerRequest; result: PreflightResult; entry: RegisteredTool }
interface Execution {
  context: ToolExecutionContext
  entry: RegisteredTool
  capability: Capability
  input: CapabilityInput<Capability>
  handle: ToolTaskHandle | null
  stopped: boolean
  allowProviderSelectedResolution: boolean
  durationToleranceSeconds: number
}
const outputMetadataSchema = z.union([imageOutputItemSchema.omit({ handle: true }), videoOutputItemSchema.omit({ handle: true })])
type OutputMetadata = z.infer<typeof outputMetadataSchema>
const requestKey = (project: string, request: string) => `${project}/${request}`

export class ToolBroker {
  private readonly registry: ToolRegistry
  private readonly timeoutMs: number
  private readonly now: () => Date
  private readonly preflights = new Map<string, PreflightRecord>()
  private readonly revisions = new Map<string, symbol>()
  private readonly executions = new Map<string, Execution>()
  private readonly externalOwners = new Map<string, string>()
  private readonly submitted = new Set<string>()
  private readonly outputs = new Map<string, { executionId: string; metadata: OutputMetadata }>()
  constructor(registry: ToolRegistry, options: { timeoutMs?: number; now?: () => Date } = {}) {
    this.registry = registry
    this.timeoutMs = options.timeoutMs ?? 10000
    this.now = options.now ?? (() => new Date())
  }
  private async call<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal.aborted) throw normalizeToolError({ code: 'cancelled' })
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => { controller.abort(); reject(normalizeToolError({ code: 'cancelled' })) }
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => { controller.abort(); reject(normalizeToolError({ code: 'timeout' })) }, this.timeoutMs)
    })
    try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), interrupted]) }
    catch (raw) { throw normalizeToolError(raw) }
    finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort) }
  }
  fingerprint(request: BrokerRequest, entry: RegisteredTool, model: string | null) {
    return requestFingerprint({ fingerprintVersion: '1', snapshot: request.snapshot, toolId: entry.descriptor.id, toolVersion: entry.descriptor.version, model, sourceRevisions: {}, routing: null })
  }
  private async inspect(request: BrokerRequest, entry: RegisteredTool, model: string | null, decisionId: string | null, signal: AbortSignal): Promise<ToolCandidate> {
    const cap = request.snapshot.capability
    if (!entry.descriptor.capabilities.some(c => c.capability === cap)) throw boundaryError('capability-not-supported')
    const ctx: ToolCallContext = toolCallContextSchema.parse({ projectId: request.projectId, model, routingDecisionId: decisionId, requestFingerprint: this.fingerprint(request, entry, model) })
    const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) throw normalizeToolError({ code: 'malformed-response' })
      return parsed.data
    }
    const health = parse(toolHealthSchema, await this.call(signal, s => entry.adapter.health(s)))
    if (health.toolId !== entry.descriptor.id) throw normalizeToolError({ code: 'malformed-response' })
    const candidate: ToolCandidate = { descriptor: entry.descriptor, capability: cap, model, health, validation: null, estimate: null, quality: { status: 'unknown' } }
    if (health.availability !== 'available') return candidate
    const validation = parse(toolValidationSchema, await this.call(signal, s => entry.adapter.validate(cap, structuredClone(request.snapshot.input), { ...ctx }, s)))
    candidate.validation = validation
    if (validation.requestFingerprint !== ctx.requestFingerprint) throw boundaryError('preflight-invalid')
    if (!validation.valid) return candidate
    const estimate = parse(generationEstimateSchema, await this.call(signal, s => entry.adapter.estimate(cap, structuredClone(request.snapshot.input), { ...ctx }, s)))
    if (estimate.projectId !== ctx.projectId || estimate.requestFingerprint !== ctx.requestFingerprint || estimate.routingDecisionId !== decisionId) throw boundaryError('preflight-invalid')
    candidate.estimate = estimate
    return candidate
  }
  async preflight(raw: BrokerRequest, signal: AbortSignal): Promise<PreflightResult> {
    const request = this.validResponse(brokerRequestSchema, raw)
    const key = requestKey(request.projectId, request.requestId)
    if (this.submitted.has(key)) throw boundaryError('preflight-invalid')
    // Invalidate the prior decision before doing asynchronous work.
    this.preflights.delete(key)
    const revision = Symbol()
    this.revisions.set(key, revision)
    const candidates: ToolCandidate[] = [], issues: ToolError[] = []
    const fixed = request.policy.selection
    for (const entry of this.registry.list()) {
      if (fixed.mode === 'fixed' && (entry.descriptor.id !== fixed.toolId || (fixed.toolVersion !== undefined && entry.descriptor.version !== fixed.toolVersion))) continue
      const models = entry.descriptor.capabilities.find(
        (candidate) => candidate.capability === request.snapshot.capability,
      )?.models
      const model =
        fixed.mode === 'fixed'
          ? fixed.model
          : models?.status === 'known' && models.value.length === 1
            ? models.value[0]!
            : null
      let c: ToolCandidate = { descriptor: entry.descriptor, capability: request.snapshot.capability, model, health: null, validation: null, estimate: null, quality: { status: 'unknown' } }
      if (!staticReasons(c, request.snapshot.capability, request.policy).length) {
        try {
          c = await this.inspect(request, entry, model, null, signal)
          if (c.health?.availability !== 'available') issues.push(boundaryError('tool-unavailable'))
          else if (!c.validation?.valid) issues.push(boundaryError('preflight-invalid'))
        }
        catch (rawError) { if (signal.aborted) throw normalizeToolError({ code: 'cancelled' }); issues.push(normalizeToolError(rawError)) }
      }
      candidates.push(c)
    }
    const routed = route({ id: randomUUID(), projectId: request.projectId, createdAt: this.now().toISOString(), capability: request.snapshot.capability, policy: request.policy, candidates })
    const failed = (errors: ToolError[], decision: RoutingDecision | null = null, candidate?: ToolCandidate): PreflightResult => immutable({ ready: false, routingDecision: decision, health: candidate?.health ?? null, validation: candidate?.validation ?? null, estimate: candidate?.estimate ?? null, requestFingerprint: candidate?.validation?.requestFingerprint ?? null, validUntil: candidate?.estimate?.validUntil ?? null, blockingIssues: errors, rejectedCandidates: routed.ready ? routed.decision.rejectedCandidates as Rejection[] : routed.rejectedCandidates, candidates: structuredClone(candidates) })
    if (!routed.ready) return failed([...issues, routed.error])
    const decision = routed.decision
    const entry = this.registry.get(decision.selectedToolId, decision.selectedToolVersion)
    let selected: ToolCandidate
    // Final quote must reference the actual decision ID; comparison quotes cannot authorize execution.
    try { selected = await this.inspect(request, entry, decision.selectedModel, decision.id, signal) }
    catch (rawError) { return failed([normalizeToolError(rawError)], decision) }
    const checked = route({ id: decision.id, projectId: request.projectId, createdAt: this.now().toISOString(), capability: request.snapshot.capability, policy: request.policy, candidates: [selected] })
    if (!checked.ready || !selected.validation?.valid || !selected.estimate || Date.parse(selected.estimate.validUntil) <= this.now().getTime() || Date.parse(selected.estimate.createdAt) > this.now().getTime()) return failed([boundaryError(selected.estimate && Date.parse(selected.estimate.validUntil) <= this.now().getTime() ? 'estimate-expired' : 'preflight-invalid')], decision, selected)
    const result: PreflightResult = immutable({ ready: true, routingDecision: decision, health: selected.health, validation: selected.validation, estimate: selected.estimate, requestFingerprint: selected.validation.requestFingerprint, validUntil: selected.estimate.validUntil, blockingIssues: [], rejectedCandidates: decision.rejectedCandidates as Rejection[], candidates: structuredClone(candidates) })
    if (this.revisions.get(key) !== revision || this.submitted.has(key)) return failed([boundaryError('preflight-invalid')], decision, selected)
    this.preflights.set(key, { request: immutable(request), result, entry })
    return result
  }
  assertCurrent(raw: BrokerRequest, result: PreflightResult): void {
    const request = this.validResponse(brokerRequestSchema, raw)
    const record = this.preflights.get(requestKey(request.projectId, request.requestId))
    const decision = result.routingDecision
    if (!record || record.result !== result || !result.ready || !decision || !result.estimate || !result.validation) throw boundaryError('preflight-invalid')
    const registered = this.registry.get(decision.selectedToolId, decision.selectedToolVersion)
    if (registered !== record.entry || JSON.stringify(request.policy) !== JSON.stringify(record.request.policy) || this.fingerprint(request, registered, decision.selectedModel) !== result.requestFingerprint || result.validation.requestFingerprint !== result.requestFingerprint || result.estimate.routingDecisionId !== decision.id || result.estimate.requestFingerprint !== result.requestFingerprint) throw boundaryError('preflight-invalid')
    if (Date.parse(result.estimate.validUntil) <= this.now().getTime()) throw boundaryError('estimate-expired')
    if (!result.health || this.now().getTime() - Date.parse(result.health.checkedAt) > 60000) throw boundaryError('preflight-invalid')
  }
  /** Trusted Runtime integration seam only, not IPC. No submit is implemented here. */
  openExecution(
    request: BrokerRequest,
    result: PreflightResult,
    rawContext: ToolExecutionContext,
    rawHandle: ToolTaskHandle | null,
    options: {
      allowProviderSelectedResolution?: boolean
      durationToleranceSeconds?: number
    } = {},
  ): string {
    this.assertCurrent(request, result)
    const ctx = this.validResponse(toolExecutionContextSchema, rawContext), decision = result.routingDecision
    if (!decision || ctx.projectId !== request.projectId || ctx.taskId !== request.requestId || ctx.requestFingerprint !== result.requestFingerprint || ctx.model !== decision.selectedModel || ctx.routingDecisionId !== decision.id || ctx.estimateId !== result.estimate?.id) throw boundaryError('ownership-mismatch')
    const key = requestKey(ctx.projectId, ctx.taskId)
    if (this.submitted.has(key)) throw boundaryError('preflight-invalid')
    if (
      options.durationToleranceSeconds !== undefined &&
      (!Number.isFinite(options.durationToleranceSeconds) ||
        options.durationToleranceSeconds < 0)
    )
      throw boundaryError('preflight-invalid')
    const handle = rawHandle === null ? null : this.validResponse(toolTaskHandleSchema, rawHandle)
    if (handle && (handle.toolId !== decision.selectedToolId || handle.toolVersion !== decision.selectedToolVersion)) throw boundaryError('ownership-mismatch')
    const externalKey = handle ? `${handle.toolId}/${handle.toolVersion}/${handle.externalTaskId}` : null
    if (externalKey && this.externalOwners.has(externalKey)) throw boundaryError('ownership-mismatch')
    const id = randomUUID()
    this.executions.set(id, {
      context: immutable(ctx),
      entry: this.registry.get(decision.selectedToolId, decision.selectedToolVersion),
      capability: decision.requestedCapability,
      input: immutable(structuredClone(request.snapshot.input)),
      handle: handle ? immutable(handle) : null,
      stopped: false,
      allowProviderSelectedResolution:
        options.allowProviderSelectedResolution === true,
      durationToleranceSeconds: options.durationToleranceSeconds ?? 0,
    })
    if (externalKey) this.externalOwners.set(externalKey, id)
    this.submitted.add(key)
    return id
  }
  /** Trusted main-process restart seam. Rebuilds ownership from immutable
   * persisted task/record data and an already accepted remote identity. It
   * never calls submit and is intentionally not exposed over IPC. */
  restoreExecution(
    rawSnapshot: unknown,
    rawContext: ToolExecutionContext,
    toolId: string,
    toolVersion: string,
    rawHandle: ToolTaskHandle,
    options: {
      allowProviderSelectedResolution?: boolean
      durationToleranceSeconds?: number
    } = {},
  ): string {
    const snapshot = this.validResponse(capabilitySnapshotSchema, rawSnapshot)
    const ctx = this.validResponse(toolExecutionContextSchema, rawContext)
    const entry = this.registry.get(toolId, toolVersion)
    const handle = this.validResponse(toolTaskHandleSchema, rawHandle)
    const fingerprint = requestFingerprint({
      fingerprintVersion: '1',
      snapshot,
      toolId,
      toolVersion,
      model: ctx.model,
      sourceRevisions: {},
      routing: null,
    })
    if (
      fingerprint !== ctx.requestFingerprint ||
      handle.toolId !== toolId ||
      handle.toolVersion !== toolVersion ||
      !entry.descriptor.capabilities.some(
        (candidate) => candidate.capability === snapshot.capability,
      )
    )
      throw boundaryError('ownership-mismatch')
    const taskKey = requestKey(ctx.projectId, ctx.taskId)
    const externalKey = `${toolId}/${toolVersion}/${handle.externalTaskId}`
    if (this.submitted.has(taskKey) || this.externalOwners.has(externalKey))
      throw boundaryError('ownership-mismatch')
    const durationToleranceSeconds = options.durationToleranceSeconds ?? 0
    if (!Number.isFinite(durationToleranceSeconds) || durationToleranceSeconds < 0)
      throw boundaryError('preflight-invalid')
    const id = randomUUID()
    this.executions.set(id, {
      context: immutable(ctx),
      entry,
      capability: snapshot.capability,
      input: immutable(structuredClone(snapshot.input)),
      handle: immutable(handle),
      stopped: false,
      allowProviderSelectedResolution:
        options.allowProviderSelectedResolution === true,
      durationToleranceSeconds,
    })
    this.externalOwners.set(externalKey, id)
    this.submitted.add(taskKey)
    return id
  }
  markUnknownSubmission(request: BrokerRequest, result: PreflightResult): void {
    this.assertCurrent(request, result)
    this.submitted.add(requestKey(request.projectId, request.requestId))
  }
  private own(ctx: ToolExecutionContext, id: string, handle?: ToolTaskHandle): Execution {
    const parsed = toolExecutionContextSchema.safeParse(ctx), execution = this.executions.get(id)
    if (!parsed.success || !execution || JSON.stringify(parsed.data) !== JSON.stringify(execution.context)) throw boundaryError('ownership-mismatch')
    if (handle && (!execution.handle || handle.toolId !== execution.handle.toolId || handle.toolVersion !== execution.handle.toolVersion || handle.externalTaskId !== execution.handle.externalTaskId)) throw boundaryError('ownership-mismatch')
    if (this.registry.get(execution.entry.descriptor.id, execution.entry.descriptor.version) !== execution.entry) throw boundaryError('tool-not-registered')
    return execution
  }
  /** Host ingestion signs validated metadata, never an adapter-provided path or URL. */
  issueOutput(ctx: ToolExecutionContext, id: string, rawMetadata: OutputMetadata): string {
    const execution = this.own(ctx, id)
    const parsed = outputMetadataSchema.safeParse(rawMetadata)
    if (!parsed.success || execution.stopped) throw boundaryError('output-not-issued')
    const handle = randomUUID()
    this.outputs.set(handle, { executionId: id, metadata: immutable(parsed.data) })
    return handle
  }
  readOutput(ctx: ToolExecutionContext, id: string, handle: string): OutputMetadata {
    this.own(ctx, id)
    const output = this.outputs.get(handle)
    if (!output || output.executionId !== id) throw boundaryError('output-not-issued')
    return output.metadata
  }
  acceptOutput<C extends Capability>(ctx: ToolExecutionContext, id: string, cap: C, raw: unknown): CapabilityOutput<C> {
    const execution = this.own(ctx, id)
    if (execution.capability !== cap) throw boundaryError('capability-not-supported')
    if (execution.stopped) throw normalizeToolError({ code: 'cancelled' })
    const output = this.validResponse<CapabilityOutput<Capability>>(capabilityContracts[cap].output, raw)
    if ('images' in output || 'videos' in output) {
      const items = 'images' in output ? output.images : output.videos
      const input = execution.input
      if ('count' in input && items.length !== input.count) throw boundaryError('output-not-issued')
      for (const item of items) {
        if (
          'resolution' in input &&
          !execution.allowProviderSelectedResolution &&
          (item.resolution.width !== input.resolution.width ||
            item.resolution.height !== input.resolution.height)
        )
          throw boundaryError('output-not-issued')
        if ('outputMime' in input && item.mime !== input.outputMime) throw boundaryError('output-not-issued')
        if (
          'durationSeconds' in input &&
          (!('durationSeconds' in item) ||
            Math.abs(item.durationSeconds - input.durationSeconds) >
              execution.durationToleranceSeconds)
        )
          throw boundaryError('output-not-issued')
        const metadata = this.readOutput(ctx, id, item.handle)
        const { handle: _handle, ...returned } = item
        if (JSON.stringify(metadata) !== JSON.stringify(returned)) throw boundaryError('output-not-issued')
      }
    } else throw boundaryError('output-not-issued')
    return output as CapabilityOutput<C>
  }
  bindAccepted(ctx: ToolExecutionContext, id: string, raw: ToolTaskHandle): void {
    const execution=this.own(ctx,id),handle=this.validResponse(toolTaskHandleSchema,raw)
    if(execution.handle||handle.toolId!==execution.entry.descriptor.id||handle.toolVersion!==execution.entry.descriptor.version)throw boundaryError('ownership-mismatch')
    const key=`${handle.toolId}/${handle.toolVersion}/${handle.externalTaskId}`
    if(this.externalOwners.has(key))throw boundaryError('ownership-mismatch')
    execution.handle=handle;this.externalOwners.set(key,id)
  }
  async status(ctx: ToolExecutionContext, id: string, handle: ToolTaskHandle, signal: AbortSignal) {
    const e = this.own(ctx, id, handle)
    return this.validResponse(toolTaskStatusSchema, await this.call(signal, s => e.entry.adapter.status(handle, s)))
  }
  async result<C extends Capability>(ctx: ToolExecutionContext, id: string, cap: C, handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolResult<CapabilityOutput<C>>> {
    const e = this.own(ctx, id, handle)
    if (cap !== e.capability) throw boundaryError('capability-not-supported')
    if (e.stopped) return { state: 'failed', error: normalizeToolError({ code: 'cancelled' }) }
    const result = this.validResponse(toolResultSchema(capabilityContracts[cap].output), await this.call(signal, s => e.entry.adapter.result(cap, handle, s)))
    if (e.stopped) return { state: 'failed', error: normalizeToolError({ code: 'cancelled' }) }
    if (result.state === 'completed') {
      this.acceptOutput(ctx, id, cap, result.output)
    }
    return immutable(result) as ToolResult<CapabilityOutput<C>>
  }
  async cancel(ctx: ToolExecutionContext, id: string, handle: ToolTaskHandle, signal: AbortSignal) {
    const e = this.own(ctx, id, handle)
    const result = this.validResponse(toolCancelResultSchema, await this.call(signal, s => e.entry.adapter.cancel(handle, s)))
    if (result.state === 'cancelled' || result.state === 'waiting-stopped') e.stopped = true
    return result
  }
  async recover(ctx: ToolExecutionContext, id: string, handle: ToolTaskHandle, signal: AbortSignal) {
    const e = this.own(ctx, id, handle)
    const result = this.validResponse(toolRecoverResultSchema, await this.call(signal, s => e.entry.adapter.recover(handle, s)))
    if (result.state === 'recovered') this.own(ctx, id, result.handle)
    return result
  }
  private validResponse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw normalizeToolError({ code: 'malformed-response' })
    return immutable(parsed.data)
  }
}
