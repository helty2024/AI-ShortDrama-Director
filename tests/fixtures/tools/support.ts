import { randomUUID } from 'node:crypto'
import { capabilityContracts, type Capability, type CapabilityInput, type CapabilityOutput } from '../../../src/shared/capabilities/index.js'
import { generationEstimateSchema } from '../../../src/shared/generation.js'
import { toolDescriptorSchema, toolHealthSchema, toolValidationSchema, type ToolCallContext, type ToolExecutionContext, type ToolError, type ToolDescriptor } from '../../../src/shared/tools.js'
import { normalizeToolError } from '../../../electron/main/tools/errors.js'
import { requestFingerprint } from '../../../electron/main/tools/fingerprint.js'

export type Fault = 'missing' | 'mime' | 'resolution' | 'duration' | 'handle' | 'file' | 'http' | 'private-url' | 'capability' | 'unissued' | 'mismatch' | 'wrong-duration'
export interface Options {
  health?: 'healthy' | 'degraded' | 'unavailable' | 'dependency' | 'model'
  unknownEstimate?: boolean
  fault?: Fault
  failure?: ToolError['code']
  delayMs?: number
  healthTimeout?: boolean
  cancel?: 'cancelled' | 'unsupported' | 'waiting-stopped'
  recover?: boolean
  ambiguous?: boolean
}
export const counters = () => ({ validateCount: 0, estimateCount: 0, submitCount: 0, uploadCount: 0, billingCount: 0, cancelCount: 0 })
export const error = (code: ToolError['code']) => normalizeToolError({ code, message: 'SECRET', stack: 'SECRET', headers: { authorization: 'SECRET' }, url: 'https://private.invalid/?token=SECRET', body: 'SECRET' })
export async function wait(signal: AbortSignal, ms = 0): Promise<void> {
  if (signal.aborted) throw error('cancelled')
  if (!ms) return
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(error('cancelled')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
export function fingerprint<C extends Capability>(tool: ToolDescriptor, capability: C, input: CapabilityInput<C>, model: string | null = null) {
  return requestFingerprint({ fingerprintVersion: '1', snapshot: { capability, contractVersion: '1.0.0', input }, toolId: tool.id, toolVersion: tool.version, model, sourceRevisions: {}, routing: null })
}
export function context<C extends Capability>(tool: ToolDescriptor, capability: C, input: CapabilityInput<C>): ToolExecutionContext {
  return { projectId: randomUUID(), taskId: randomUUID(), estimateId: randomUUID(), approvalId: null, routingDecisionId: null, model: null, requestFingerprint: fingerprint(tool, capability, input) }
}
const resolutions = [{ width: 1024, height: 1024 }, { width: 1024, height: 1536 }, { width: 1536, height: 1024 }]
export function descriptor(video: boolean, options: Options): ToolDescriptor {
  const resources = { memoryMB: { status: 'unknown' }, gpuMemoryMB: { status: 'unknown' }, dependencies: [] }
  return toolDescriptorSchema.parse({ metadataVersion: '1.0.0', id: video ? 'mock.video' : 'mock.image', name: video ? 'Async video fixture' : 'Sync image fixture', version: '1.0.0', kind: 'api', executionMode: 'cloud', availability: 'unknown', capabilities: (video ? ['video.textToVideo', 'video.imageToVideo'] : ['image.generate', 'image.referenceGenerate']).map(capability => ({ capability, contractVersion: '1.0.0', models: { status: 'known', value: ['fixture-model'] }, inputKinds: ['text', 'image'], referenceImages: { status: 'known', value: { min: 0, max: video ? 2 : 3 } }, aspectRatios: { status: 'unknown' }, resolutions: video ? { status: 'unknown' } : { status: 'known', value: resolutions }, durationSeconds: { status: 'unknown' }, outputMimes: video ? ['video/mp4', 'video/webm'] : ['image/png', 'image/jpeg', 'image/webp'], seed: 'supported', cancel: video && options.cancel !== 'unsupported' ? 'supported' : 'unsupported', recover: video && options.recover ? 'supported' : 'unsupported', estimate: 'supported', locality: 'cloud', resources })) })
}
export async function health(tool: ToolDescriptor, options: Options, signal: AbortSignal) {
  await wait(signal, options.delayMs)
  if (options.healthTimeout) throw error('timeout')
  const state = options.health ?? 'healthy'
  const code = state === 'dependency' || state === 'model' ? 'missing-dependency' : state === 'degraded' ? 'resource-insufficient' : 'tool-unavailable'
  return toolHealthSchema.parse({ toolId: tool.id, availability: state === 'healthy' || state === 'degraded' ? 'available' : 'unavailable', checkedAt: new Date().toISOString(), issues: state === 'healthy' ? [] : [{ code, field: state === 'model' ? 'model' : null, message: state }] })
}
export function validate<C extends Capability>(tool: ToolDescriptor, capability: C, input: CapabilityInput<C>, ctx: ToolCallContext, options: Options) {
  const parsed = capabilityContracts[capability].input.safeParse(input)
  const issues: { code: 'invalid-input' | 'tool-unavailable' | 'unsupported-capability'; field: string | null; message: string }[] = []
  if (!tool.capabilities.some(c => c.capability === capability)) issues.push({ code: 'unsupported-capability', field: null, message: 'Unsupported capability' })
  if (!parsed.success || (parsed.success && fingerprint(tool, capability, input, ctx.model) !== ctx.requestFingerprint)) issues.push({ code: 'invalid-input', field: null, message: 'Invalid input or fingerprint' })
  if (parsed.success && capability.startsWith('image.')) {
    const value = capabilityContracts['image.generate'].input.safeParse(input)
    const ref = capabilityContracts['image.referenceGenerate'].input.safeParse(input)
    const image = value.success ? value.data : ref.success ? ref.data : null
    if (image && (!resolutions.some(r => r.width === image.resolution.width && r.height === image.resolution.height) || (ref.success && ref.data.references.length > 3))) issues.push({ code: 'invalid-input', field: 'references/resolution', message: 'Tool limit exceeded' })
  }
  if ((options.health && !['healthy', 'degraded'].includes(options.health)) || (ctx.model !== null && ctx.model !== 'fixture-model')) issues.push({ code: 'tool-unavailable', field: 'model', message: 'Tool dependency or model unavailable' })
  return toolValidationSchema.parse({ valid: issues.length === 0, issues, warnings: options.health === 'degraded' ? [{ code: 'resource-insufficient', field: null, message: 'Reduced capacity' }] : [], requestFingerprint: ctx.requestFingerprint })
}
export function estimate(ctx: ToolCallContext, options: Options) {
  return generationEstimateSchema.parse({ id: randomUUID(), projectId: ctx.projectId, routingDecisionId: ctx.routingDecisionId, requestFingerprint: ctx.requestFingerprint, cost: options.unknownEstimate ? { status: 'unknown', reason: 'not-quoted' } : { status: 'known', estimatedCost: { amountMicros: 100000, currency: 'USD' } }, estimatedDurationRange: options.unknownEstimate ? { status: 'unknown' } : { status: 'known', seconds: { min: 1, max: 10 } }, billingRisk: options.unknownEstimate ? 'unknown' : 'may-charge', basis: 'Simulated quote; no real billing', createdAt: new Date().toISOString(), validUntil: new Date(Date.now() + 60000).toISOString() })
}
// Host-side issuance simulated only in tests. This is not a production Broker.
export class OutputIssuer {
  private readonly owners = new Map<string, string>()
  private owner(ctx: ToolExecutionContext) { return `${ctx.projectId}/${ctx.taskId}/${ctx.requestFingerprint}` }
  issue(ctx: ToolExecutionContext) { const handle = randomUUID(); this.owners.set(handle, this.owner(ctx)); return handle }
  read(ctx: ToolExecutionContext, handle: string) { if (this.owners.get(handle) !== this.owner(ctx)) throw error('authorization'); return handle }
  output<C extends Capability>(capability: C, input: CapabilityInput<C>, ctx: ToolExecutionContext, fault?: Fault): CapabilityOutput<C> {
    const video = capability.startsWith('video.')
    const source = input as CapabilityInput<'image.generate'> | CapabilityInput<'video.textToVideo'>
    const item = { handle: this.issue(ctx), mime: source.outputMime, resolution: source.resolution, ...('durationSeconds' in source ? { durationSeconds: source.durationSeconds } : {}) }
    let raw: unknown = { [video ? 'videos' : 'images']: Array.from({ length: 'count' in source ? source.count : 1 }, () => ({ ...item, handle: this.issue(ctx) })) }
    const bad: Record<string, unknown> = { ...item }
    if (fault === 'missing') delete bad.mime
    if (fault === 'mime') bad.mime = 'application/x-executable'
    if (fault === 'resolution') bad.resolution = { width: -1, height: 1024 }
    if (fault === 'duration') bad.durationSeconds = -1
    if (fault === 'wrong-duration') bad.durationSeconds = 99
    if (fault === 'handle') bad.handle = 'C:\\private\\output.png'
    if (fault === 'file') bad.handle = 'file:///private/output'
    if (fault === 'http') bad.handle = 'http://random.invalid/output'
    if (fault === 'private-url') bad.handle = 'https://provider.invalid/output?token=SECRET'
    if (fault === 'unissued') bad.handle = 'unissued-handle'
    if (fault === 'mismatch') bad.resolution = { width: 512, height: 512 }
    if (fault) raw = { [fault === 'capability' ? (video ? 'images' : 'videos') : (video ? 'videos' : 'images')]: [bad] }
    const parsed = capabilityContracts[capability].output.safeParse(raw)
    if (!parsed.success) throw error('malformed-response')
    const output = parsed.data
    if ('images' in output || 'videos' in output) {
      const items = 'images' in output ? output.images : output.videos
      if (items.length !== ('count' in source ? source.count : 1)) throw error('malformed-response')
      for (const entry of items) {
        if (this.owners.get(entry.handle) !== this.owner(ctx) || entry.mime !== source.outputMime || entry.resolution.width !== source.resolution.width || entry.resolution.height !== source.resolution.height) throw error('malformed-response')
        if ('durationSeconds' in source && (!('durationSeconds' in entry) || entry.durationSeconds !== source.durationSeconds)) throw error('malformed-response')
      }
    }
    // The capability-selected schema above establishes this indexed relationship.
    return output as CapabilityOutput<C>
  }
}
