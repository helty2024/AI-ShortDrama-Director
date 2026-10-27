import { z } from 'zod'
import { capabilityContracts, type CapabilityInput, type CapabilityOutput } from '../../../../src/shared/capabilities/index.js'
import { toolHealthSchema, type ToolCallContext, type ToolExecutionContext, type ToolTaskHandle, type ToolCancelResult, type ToolSubmitResult } from '../../../../src/shared/tools.js'
import { compshareProfileSchema, compshareProbeSchema, type CompShareProfile } from '../../../../src/shared/compshare-minimax-h3.js'
import { videoApiProfileSchema, type VideoApiProfile } from '../../../../src/shared/video-tool-profile.js'
import { VideoLifecycleAdapter, type VideoCapability } from './video-lifecycle.js'
import { ImageHttpTransport, transportFailure } from './image-http.js'
import { normalizeToolError } from '../errors.js'
import { immutable } from '../registry.js'
import { h3RequestBodySchema } from './compshare-h3-contract.js'

const pointsSchema = z.object({ total_points: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), reserved_points: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), available_points: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
  .refine(p => p.available_points === Math.max(0, p.total_points - p.reserved_points))
const remoteId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const taskSchema = z.object({ task: z.object({
  id: remoteId, model: z.enum(['MiniMax-H3', 'minimax-h3-lite']),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  content: z.object({ url: z.url().max(4000) }).optional(),
}) })
// Only the documented native 480P dimensions are mapped in this baseline.
const dimensions = { '16:9': { width: 864, height: 480 }, '9:16': { width: 480, height: 864 }, '1:1': { width: 480, height: 480 }, '4:3': { width: 640, height: 480 }, '3:4': { width: 480, height: 640 } } as const
const batchPolicy: VideoApiProfile['batchPolicy'] = { fps: 24, maxPromptLength: 7000, maxConcurrent: 1, budgetCurrency: 'PTS',
  reservationQuote: { microUnitsPerSecond: 5000000, basis: 'CompShare MiniMax-H3 / 480P; 5 points per second; fiat cost unknown' } }

export function compShareIdempotencyKey(taskId: string): string {
  return `asd-h3-${z.uuid().parse(taskId)}`
}
export interface CompShareProductionGate {
  allowedDownloadHosts: string[]
  canExecute: (capability?: VideoCapability) => Promise<boolean>
  consume: (capability: VideoCapability, input: CapabilityInput<VideoCapability>, context: ToolExecutionContext) => Promise<void>
  downloadHostsForTask?: (taskId: string, url: string, context: ToolExecutionContext) => Promise<string[]>
  outputVerified?: (url: string, context: ToolExecutionContext, bytes: Buffer, duration: number) => Promise<void>
}

/** Native CompShare protocol with shared authorization and output ingestion. */
export class CompShareMiniMaxH3Adapter extends VideoLifecycleAdapter {
  readonly storedProfile: CompShareProfile
  readonly generationEnabled: boolean
  private readonly production: CompShareProductionGate | null
  private readonly productionSubmissions = new Set<string>()
  constructor(raw: CompShareProfile, credential: () => Promise<string>, transport = new ImageHttpTransport(), production: CompShareProductionGate | null = null, historicalBatchPolicy: VideoApiProfile['batchPolicy'] | null = batchPolicy) {
    const stored = compshareProfileSchema.parse(raw)
    const fixture = transport.fixtureOrigin
    if (fixture) {
      const url = new URL(fixture)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== fixture) throw new Error('Exact loopback fixture required')
    }
    if(production && (fixture || !production.allowedDownloadHosts.length && !production.downloadHostsForTask || production.allowedDownloadHosts.some(host=>!/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(host))))throw new Error('Verified exact or owned-task production download boundary required')
    super(videoApiProfileSchema.parse({
      toolId: stored.toolId, displayName: production ? 'CompShare · MiniMax H3' : 'CompShare · MiniMax H3（非付费接入基线）',
      baseEndpoint: fixture ?? 'https://cp.compshare.cn', modelId: stored.modelId, credentialRef: stored.credentialRef,
      supportedCapabilities: ['video.textToVideo', 'video.imageToVideo'],
      supportedDurations: Array.from({ length: 27 }, (_, i) => i + 4),
      supportedAspectRatios: Object.keys(dimensions), supportedResolutions: Object.values(dimensions),
      // Native H3 encodes complete frame groups: real 4/5/6s results measured
      // 4.458/5.167/6.583s. Preserve actual duration, bounded to one second drift.
      resolutionMode: 'exact', durationToleranceSeconds: 1, supportsLastFrame: true, supportsReferenceImages: false,
      maxOutputCount: 1, polling: { initialIntervalMs: 1000, maxIntervalMs: 10000, maxWaitMs: 300000 },
      maxDownloadBytes: 256 * 1024 * 1024,
      // Official examples do not specify a production CDN. Fail closed until independently verified.
      allowedDownloadHosts: production?.allowedDownloadHosts ?? [], allowedDownloadHostSuffixes: [],
      currency: 'CNY', estimateSupport: 'unknown', cancelSupport: Boolean(fixture), recoverSupport: true,
      ...(historicalBatchPolicy ? { batchPolicy: historicalBatchPolicy } : {}),
    }), credential, transport)
    this.storedProfile = immutable(stored)
    this.production = production
    this.generationEnabled = Boolean(fixture || production)
  }
  protected override seedCapability() { return 'unsupported' as const }
  protected override async downloadOutput(url: string, handle: ToolTaskHandle, context: ToolExecutionContext, signal: AbortSignal) {
    if(!this.production?.downloadHostsForTask)return super.downloadOutput(url,handle,context,signal)
    const hosts=await this.production.downloadHostsForTask(handle.externalTaskId,url,context)
    return this.transport.bytes(url,signal,{method:'GET',limit:this.profile.maxDownloadBytes,redirects:{max:0,allowedHosts:hosts}})
  }
  protected override async outputVerified(url: string, context: ToolExecutionContext, bytes: Buffer, output: CapabilityOutput<'video.textToVideo'>['videos'][number]) {
    await this.production?.outputVerified?.(url,context,bytes,output.durationSeconds)
  }
  // One taskId identifies one generation attempt; a new user attempt gets a new taskId.
  protected override submitIdempotencyKey(context: ToolExecutionContext) { return compShareIdempotencyKey(context.taskId) }
  override async health(signal: AbortSignal) {
    if(this.production) {
      const report=await this.probe(signal), ready=report.authenticated && Boolean(report.points && report.points.available>=20) && await this.production.canExecute()
      return toolHealthSchema.parse({toolId:this.profile.toolId,checkedAt:report.checkedAt,availability:ready?'available':'unavailable',issues:ready?[]:[{code:'tool-unavailable',field:null,message:report.authenticated?'账户额度不足或生产验证/测试授权未完成':'密钥无效，请重新设置'}]})
    }
    const health = await super.health(signal)
    return this.generationEnabled ? health : toolHealthSchema.parse({ ...health,
      availability: health.availability === 'available' ? 'unknown' : 'unavailable',
      issues: [...health.issues, { code: 'tool-unavailable', field: null, message: '09-00 仅非付费接入；真实视频生成未验证、未开放' }],
    })
  }
  override async validate<C extends VideoCapability>(capability: C, input: CapabilityInput<C>, context: ToolCallContext, signal: AbortSignal) {
    const base = await super.validate(capability, input, context, signal)
    const parsed = capabilityContracts[capability].input.safeParse(input)
    const value = parsed.success ? parsed.data : null
    const size = value && value.aspectRatio !== 'custom' ? dimensions[value.aspectRatio] : null
    const valid = base.valid && (!this.production || 'taskId' in context && this.productionSubmissions.has(String(context.taskId)) || await this.production.canExecute(capability)) && Boolean(value && size && value.resolution.width === size.width && value.resolution.height === size.height && value.seed === null && value.prompt.length <= 7000 && !value.negativePrompt && value.audio === 'none')
    return { ...base, valid, issues: valid ? [] : [{ code: 'invalid-input' as const, field: null, message: 'H3 基线要求 480P 对应尺寸、4–30 秒整数、无 seed/negativePrompt、无声视频' }] }
  }
  override async estimate<C extends VideoCapability>(capability: C, input: CapabilityInput<C>, context: ToolCallContext, signal: AbortSignal) {
    const estimate = await super.estimate(capability, input, context, signal)
    // PTS is the native account unit, not a fiat currency conversion. Actual
    // settlement remains unknown; approvals reserve points, never invent CNY.
    return { ...estimate, currency: 'PTS', basis: 'CompShare MiniMax-H3 / 480P; 5 points per second; fiat cost unknown' }
  }
  override async submit<C extends VideoCapability>(capability: C, input: CapabilityInput<C>, context: ToolExecutionContext, signal: AbortSignal): Promise<ToolSubmitResult<CapabilityOutput<C>>> {
    if (!this.generationEnabled) throw transportFailure('authorization', false)
    if(this.production) {
      if(!(await this.validate(capability,input,context,signal)).valid)throw transportFailure('validation',false)
      const report=await this.probe(signal)
      if(!report.authenticated || !report.points || report.points.available<input.durationSeconds*5)throw transportFailure('authorization',false)
      await this.production.consume(capability,input,context)
      this.productionSubmissions.add(context.taskId)
    }
    try { return await super.submit(capability, input, context, signal) }
    finally { this.productionSubmissions.delete(context.taskId) }
  }
  protected override submitPath() { return 'minimax/v2/video_generation' }
  protected override taskPath(id: string) { return `minimax/v2/query/video_generation/${encodeURIComponent(id)}` }
  protected override resultPath(id: string) { return this.taskPath(id) }
  protected override cancelPath(id: string) { return `minimax/v2/video_generation/${encodeURIComponent(id)}` }
  protected override requestBody<C extends VideoCapability>(_capability: C, input: CapabilityInput<C>, context: ToolExecutionContext, frames: { assetVersionId: string; mime: string; base64: string }[]) {
    const content: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string }; role: 'first_frame' | 'last_frame' })[] = [{ type: 'text', text: input.prompt }]
    for (const frame of frames) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(frame.mime) || Buffer.byteLength(frame.base64, 'base64') > 30 * 1024 * 1024) throw transportFailure('validation', false)
      content.push({ type: 'image_url', image_url: { url: `data:${frame.mime};base64,${frame.base64}` }, role: 'firstFrameAssetVersionId' in input && frame.assetVersionId === input.firstFrameAssetVersionId ? 'first_frame' : 'last_frame' })
    }
    const body = { model: context.model, content, resolution: '480P', duration: input.durationSeconds, ratio: input.aspectRatio, mute_audio: true, use_context_ir: false }
    if (Buffer.byteLength(JSON.stringify(body)) > 72 * 1024 * 1024) throw transportFailure('validation', false)
    return h3RequestBodySchema.parse(body)
  }
  protected override parseAccepted(raw: unknown) { return { taskId: z.object({ task_id: remoteId }).parse(raw).task_id } }
  private task(raw: unknown, id: string) {
    const { task } = taskSchema.parse(raw)
    if (task.id !== id) throw new Error('Task identity mismatch')
    return task
  }
  protected override parseStatus(raw: unknown, id: string): ReturnType<VideoLifecycleAdapter['parseStatus']> {
    const task = this.task(raw, id)
    if (task.status === 'failed') return { state: 'failed', code: 'provider', message: 'Remote generation failed' }
    if (task.status === 'queued' || task.status === 'running') return { state: task.status, progress: null }
    return { state: task.status }
  }
  protected override parseResult(raw: unknown, id: string) {
    const task = this.task(raw, id)
    if (task.status !== 'succeeded' || !task.content) throw new Error('Result unavailable')
    // usage seconds and points cannot settle a currency reservation.
    return { videos: [{ url: task.content.url }] }
  }
  protected override parseCancel(raw: unknown, id: string): ToolCancelResult {
    const reply = z.object({ task_id: remoteId, action: z.literal('delete'), status: z.enum(['cancelled', 'queued', 'running']) }).parse(raw)
    if (reply.task_id !== id) throw new Error('Task identity mismatch')
    return reply.status === 'cancelled' ? { state: 'cancelled' } : { state: 'unknown' }
  }
  async probe(signal: AbortSignal) {
    const base = { toolId: this.storedProfile.toolId, checkedAt: new Date().toISOString(), generationEnabled: false as const, realGenerationValidated: false as const }
    try {
      const response = await this.transport.bytes(this.endpoint('minimax/v2/query/point_usage_summary'), signal, { method: 'GET', key: await this.key(), limit: 64000 })
      if (response.mime !== 'application/json') throw new Error()
      const points = pointsSchema.parse(JSON.parse(response.bytes.toString('utf8')))
      return compshareProbeSchema.parse({ ...base, authenticated: true, points: { total: points.total_points, reserved: points.reserved_points, available: points.available_points }, errorCode: null })
    } catch (raw) {
      const code = raw && typeof raw === 'object' && 'error' in raw ? normalizeToolError(raw.error).code : 'malformed-response'
      return compshareProbeSchema.parse({ ...base, authenticated: false, points: null, errorCode: code })
    }
  }
}
