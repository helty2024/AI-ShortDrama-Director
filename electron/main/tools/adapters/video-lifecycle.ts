import { randomUUID } from 'node:crypto'
import type { VideoApiPreviewInput } from '../../../../src/shared/video-api.js'
import { z } from 'zod'
import type { ToolAdapter } from '../protocol.js'
import { immutable } from '../registry.js'
import { requestFingerprint } from '../fingerprint.js'
import { normalizeToolError } from '../errors.js'
import { ImageHttpTransport, transportFailure } from './image-http.js'
import {
  capabilityContracts,
  type CapabilityInput,
  type CapabilityOutput,
} from '../../../../src/shared/capabilities/index.js'
import { generationEstimateSchema } from '../../../../src/shared/generation.js'
import {
  toolDescriptorSchema,
  toolHealthSchema,
  toolValidationSchema,
  type ToolCallContext,
  type ToolExecutionContext,
  type ToolTaskHandle,
  type ToolTaskStatus,
  type ToolSubmitResult,
  type ToolResult,
  type ToolCancelResult,
  type ToolRecoverResult,
} from '../../../../src/shared/tools.js'
import {
  videoApiProfileSchema,
  type VideoApiProfile,
} from '../../../../src/shared/video-tool-profile.js'

export type VideoCapability = 'video.textToVideo' | 'video.imageToVideo'
export type VideoDiagnosticStage =
  | 'generation-response'
  | 'response-envelope'
  | 'status-response'
  | 'result-response'
  | 'output-reference'
  | 'output-download'
  | 'redirect-validation'
  | 'mime-detection'
  | 'container-probe'
  | 'duration-validation'
  | 'dimension-validation'
  | 'contract-match'
  | 'asset-ingestion'
export interface VideoExecutionAccess {
  frames: { assetVersionId: string; mime: string; bytes: Buffer }[]
  ingest: (
    bytes: Buffer,
    mime: 'video/mp4',
  ) => Promise<CapabilityOutput<'video.textToVideo'>['videos'][number]>
  billing: (amountMicro: number, currency: string) => void
  diagnostic: (
    stage: VideoDiagnosticStage,
    details?: Record<string, string | number | boolean | null>,
  ) => void
}
export interface VideoApiTool extends ToolAdapter<VideoCapability> {
  readonly profile: VideoApiProfile
  readonly generationEnabled?: boolean
  planBatchInput?(input: Omit<VideoApiPreviewInput, 'toolId' | 'fps' | 'resolution'>): VideoApiPreviewInput | null
  batchReservation?(input: VideoApiPreviewInput): { currency: string; amountMicro: number | null; basis: string }
  authorizeInputs(ctx: ToolExecutionContext, access: VideoExecutionAccess): void
  authorizeRecovery(
    ctx: ToolExecutionContext,
    handle: ToolTaskHandle,
    access: VideoExecutionAccess,
  ): void
}

export const acceptedVideoTaskSchema = z.strictObject({ taskId: z.string().min(1).max(256) })
export const videoTaskStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.enum(['accepted', 'queued', 'running']),
    progress: z.number().min(0).max(1).nullable(),
  }),
  z.strictObject({ state: z.literal('succeeded') }),
  z.strictObject({
    state: z.literal('failed'),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
  }),
  z.strictObject({ state: z.literal('cancelled') }),
  z.strictObject({ state: z.literal('unknown') }),
])
export const videoTaskResultSchema = z.strictObject({
  videos: z
    .array(z.strictObject({ url: z.url().max(4000) }))
    .min(1)
    .max(4),
  cost: z
    .strictObject({
      amountMicro: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .optional(),
})

function isTransportFailure(
  raw: unknown,
): raw is { sent: boolean; error: ReturnType<typeof normalizeToolError> } {
  return Boolean(
    raw &&
      typeof raw === 'object' &&
      'sent' in raw &&
      'error' in raw &&
      typeof (raw as { sent?: unknown }).sent === 'boolean',
  )
}

/** Shared video authorization, task ownership and controlled output ingestion. */
export abstract class VideoLifecycleAdapter implements VideoApiTool {
  readonly profile: VideoApiProfile
  readonly transport: ImageHttpTransport
  batchReservation(input: VideoApiPreviewInput) {
    const policy = this.profile.batchPolicy
    if (!policy) throw normalizeToolError({ code: 'validation' })
    return { currency: policy.budgetCurrency,
      amountMicro: policy.reservationQuote ? Math.ceil(input.durationSeconds * policy.reservationQuote.microUnitsPerSecond) : null,
      basis: policy.reservationQuote?.basis ?? '供应商报价未知；人工预算不是供应商硬限额' }
  }
  planBatchInput(input: Omit<VideoApiPreviewInput, 'toolId' | 'fps' | 'resolution'>): VideoApiPreviewInput | null {
    const p = this.profile, policy = p.batchPolicy
    if (!policy || !input.prompt || input.prompt.length > policy.maxPromptLength ||
      !p.supportedCapabilities.includes(input.mode === 'image-to-video' ? 'video.imageToVideo' : 'video.textToVideo') ||
      !p.supportedAspectRatios.includes(input.aspectRatio) || (input.lastFrameAssetVersionId && !p.supportsLastFrame)) return null
    const duration = [...p.supportedDurations].sort((a, b) => a - b).find(d => d >= input.durationSeconds)
    const ratios = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, custom: null }
    const ratio = ratios[input.aspectRatio]
    const resolution = p.supportedResolutions.find(r => ratio !== null && Math.abs(r.width / r.height - ratio) < 0.02)
    if (!duration || !resolution) return null
    return { ...input, toolId: p.toolId, durationSeconds: duration, resolution, fps: policy.fps }
  }
  private readonly credential: () => Promise<string>
  private readonly pending = new Map<
    string,
    { context: ToolExecutionContext; access: VideoExecutionAccess }
  >()
  private readonly accepted = new Map<
    string,
    { context: ToolExecutionContext; access: VideoExecutionAccess }
  >()

  constructor(
    profile: VideoApiProfile,
    credential: () => Promise<string>,
    transport = new ImageHttpTransport(),
  ) {
    this.profile = immutable(videoApiProfileSchema.parse(profile))
    this.credential = credential
    this.transport = transport
  }

  describe() {
    const p = this.profile
    return toolDescriptorSchema.parse({
      metadataVersion: '1.0.0',
      id: p.toolId,
      name: p.displayName,
      version: '1.0.0',
      kind: 'api',
      executionMode: 'cloud',
      availability: 'unknown',
      capabilities: p.supportedCapabilities.map((capability) => ({
        capability,
        contractVersion: '1.0.0',
        models: { status: 'known', value: [p.modelId] },
        inputKinds:
          capability === 'video.imageToVideo' ? ['text', 'image'] : ['text'],
        referenceImages:
          capability === 'video.imageToVideo'
            ? { status: 'known', value: { min: 1, max: p.supportsLastFrame ? 2 : 1 } }
            : { status: 'unsupported' },
        aspectRatios: { status: 'known', value: p.supportedAspectRatios },
        resolutions: { status: 'known', value: p.supportedResolutions },
        durationSeconds: {
          status: 'known',
          value: {
            min: Math.min(...p.supportedDurations),
            max: Math.max(...p.supportedDurations),
          },
        },
        outputMimes: ['video/mp4'],
        seed: this.seedCapability(),
        cancel: p.cancelSupport ? 'supported' : 'unsupported',
        recover: p.recoverSupport ? 'supported' : 'unsupported',
        estimate: 'unsupported',
        locality: 'cloud',
        resources: {
          memoryMB: { status: 'unknown' },
          gpuMemoryMB: { status: 'unknown' },
          dependencies: [],
        },
      })),
    })
  }

  async health(signal: AbortSignal) {
    signal.throwIfAborted()
    let available = true
    try {
      await this.credential()
    } catch {
      available = false
    }
    return toolHealthSchema.parse({
      toolId: this.profile.toolId,
      availability: available ? 'available' : 'unavailable',
      checkedAt: new Date().toISOString(),
      issues: available
        ? []
        : [{ code: 'permission-required', field: null, message: '安全凭据不可用' }],
    })
  }

  async validate<C extends VideoCapability>(
    capability: C,
    input: CapabilityInput<C>,
    context: ToolCallContext,
    signal: AbortSignal,
  ) {
    const parsed = capabilityContracts[capability].input.safeParse(input)
    const p = this.profile
    let valid =
      parsed.success &&
      p.supportedCapabilities.includes(capability) &&
      context.model === p.modelId
    if (parsed.success) {
      const value = parsed.data as CapabilityInput<VideoCapability>
      valid =
        valid &&
        p.supportedDurations.includes(value.durationSeconds) &&
        p.supportedAspectRatios.includes(value.aspectRatio) &&
        p.supportedResolutions.some(
          (r) => r.width === value.resolution.width && r.height === value.resolution.height,
        ) &&
        value.outputMime === 'video/mp4' &&
        (!p.batchPolicy || (value.prompt.length <= p.batchPolicy.maxPromptLength && value.fps === p.batchPolicy.fps)) &&
        (!('lastFrameAssetVersionId' in value) ||
          value.lastFrameAssetVersionId === null ||
          p.supportsLastFrame) &&
        context.requestFingerprint ===
          requestFingerprint({
            fingerprintVersion: '1',
            snapshot: { capability, contractVersion: '1.0.0', input },
            toolId: p.toolId,
            toolVersion: '1.0.0',
            model: context.model,
            sourceRevisions: {},
            routing: null,
          })
    }
    try {
      const endpoint = new URL(p.baseEndpoint)
      valid =
        valid &&
        !endpoint.username &&
        !endpoint.password &&
        !endpoint.hash &&
        !endpoint.search &&
        (endpoint.protocol === 'https:' || this.transport.fixtureOrigin === endpoint.origin)
      await this.credential()
      signal.throwIfAborted()
    } catch {
      valid = false
    }
    return toolValidationSchema.parse({
      valid,
      requestFingerprint: context.requestFingerprint,
      issues: valid
        ? []
        : [{ code: 'invalid-input', field: null, message: '配置、凭据、模型或输入限制不满足' }],
      warnings: [
        { code: 'tool-unavailable', field: null, message: '预检不提交生成，也不证明真实供应商兼容' },
      ],
    })
  }

  async estimate<C extends VideoCapability>(
    capability: C,
    input: CapabilityInput<C>,
    context: ToolCallContext,
    signal: AbortSignal,
  ) {
    if (!(await this.validate(capability, input, context, signal)).valid)
      throw normalizeToolError({ code: 'validation' })
    const now = new Date()
    return generationEstimateSchema.parse({
      id: randomUUID(),
      projectId: context.projectId,
      routingDecisionId: context.routingDecisionId,
      requestFingerprint: context.requestFingerprint,
      cost: { status: 'unknown', reason: 'not-quoted' },
      currency: this.profile.currency,
      estimatedDurationRange: { status: 'unknown' },
      billingRisk: 'unknown',
      basis: `Video tool / ${this.profile.modelId}; no reliable provider price`,
      createdAt: now.toISOString(),
      validUntil: new Date(now.getTime() + 60000).toISOString(),
    })
  }

  authorizeInputs(ctx: ToolExecutionContext, access: VideoExecutionAccess): void {
    if (this.pending.has(ctx.taskId)) throw normalizeToolError({ code: 'authorization' })
    this.pending.set(ctx.taskId, { context: structuredClone(ctx), access })
  }

  authorizeRecovery(
    ctx: ToolExecutionContext,
    handle: ToolTaskHandle,
    access: VideoExecutionAccess,
  ): void {
    if (
      handle.toolId !== this.profile.toolId ||
      handle.toolVersion !== '1.0.0' ||
      this.accepted.has(handle.externalTaskId)
    )
      throw normalizeToolError({ code: 'authorization' })
    this.accepted.set(handle.externalTaskId, {
      context: structuredClone(ctx),
      access,
    })
  }

  protected endpoint(path: string): string {
    return new URL(path, this.profile.baseEndpoint.endsWith('/') ? this.profile.baseEndpoint : `${this.profile.baseEndpoint}/`).toString()
  }

  protected async key(): Promise<string> {
    try {
      return await this.credential()
    } catch {
      throw transportFailure('authentication', false)
    }
  }

  protected abstract seedCapability(): 'supported' | 'unsupported'
  protected submitIdempotencyKey(_context: ToolExecutionContext): string | undefined { return undefined }
  protected downloadOutput(url: string, _handle: ToolTaskHandle, _context: ToolExecutionContext, signal: AbortSignal) {
    return this.transport.bytes(url, signal, { method: 'GET', limit: this.profile.maxDownloadBytes,
      redirects: { max: 3, allowedHosts: this.profile.allowedDownloadHosts, allowedHostSuffixes: this.profile.allowedDownloadHostSuffixes } })
  }
  protected async outputVerified(_url: string, _context: ToolExecutionContext, _bytes: Buffer, _output: CapabilityOutput<'video.textToVideo'>['videos'][number]) {}
  protected abstract submitPath(): string
  protected abstract taskPath(id: string): string
  protected abstract resultPath(id: string): string
  protected abstract cancelPath(id: string): string
  protected abstract requestBody<C extends VideoCapability>(capability: C, input: CapabilityInput<C>, context: ToolExecutionContext, frames: { assetVersionId: string; mime: string; base64: string }[]): unknown
  protected abstract parseAccepted(raw: unknown): z.infer<typeof acceptedVideoTaskSchema>
  protected abstract parseStatus(raw: unknown, id: string): z.infer<typeof videoTaskStatusSchema>
  protected abstract parseResult(raw: unknown, id: string): z.infer<typeof videoTaskResultSchema>
  protected abstract parseCancel(raw: unknown, id: string): ToolCancelResult
  protected owns(handle: ToolTaskHandle) {
    return handle.toolId === this.profile.toolId && handle.toolVersion === '1.0.0' && this.accepted.has(handle.externalTaskId)
  }

  async submit<C extends VideoCapability>(
    capability: C,
    input: CapabilityInput<C>,
    context: ToolExecutionContext,
    signal: AbortSignal,
  ): Promise<ToolSubmitResult<CapabilityOutput<C>>> {
    const grant = this.pending.get(context.taskId)
    this.pending.delete(context.taskId)
    if (
      !grant ||
      JSON.stringify(grant.context) !== JSON.stringify(context) ||
      !context.approvalId ||
      !(await this.validate(capability, input, context, signal)).valid
    )
      throw transportFailure('authorization', false)
    const frames =
      capability === 'video.imageToVideo' && 'firstFrameAssetVersionId' in input
        ? [input.firstFrameAssetVersionId, input.lastFrameAssetVersionId].filter(
            (id): id is string => id !== null,
          )
        : []
    const uploads = frames.map((assetVersionId) => {
      const frame = grant.access.frames.find((candidate) => candidate.assetVersionId === assetVersionId)
      if (!frame) throw transportFailure('authorization', false)
      return { assetVersionId, mime: frame.mime, base64: frame.bytes.toString('base64') }
    })
    const body = JSON.stringify(this.requestBody(capability, input, context, uploads))
    try {
      const response = await this.transport.bytes(this.endpoint(this.submitPath()), signal, {
        method: 'POST',
        key: await this.key(),
        idempotencyKey: this.submitIdempotencyKey(context),
        body,
        limit: 1024 * 1024,
      })
      grant.access.diagnostic('generation-response', {
        status: response.diagnostics.status,
        contentType: response.diagnostics.contentType,
        contentLength: response.diagnostics.contentLength,
      })
      if (response.mime !== 'application/json') throw new Error()
      const accepted = this.parseAccepted(JSON.parse(response.bytes.toString('utf8')))
      grant.access.diagnostic('response-envelope', { taskIdPresent: true })
      this.accepted.set(accepted.taskId, grant)
      return {
        state: 'accepted',
        handle: {
          toolId: this.profile.toolId,
          toolVersion: '1.0.0',
          externalTaskId: accepted.taskId,
        },
      }
    } catch (raw) {
      if (
        isTransportFailure(raw) &&
        raw.sent &&
        ['network', 'timeout', 'malformed-response'].includes(raw.error.code)
      )
        return {
          state: 'unknown',
          error: normalizeToolError({ code: 'unknown-submission' }),
          resubmitAllowed: false,
        }
      if (!isTransportFailure(raw)) return { state: 'unknown', error: normalizeToolError({ code: 'unknown-submission' }), resubmitAllowed: false }
      throw raw
    }
  }

  async status(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolTaskStatus> {
    if (!this.owns(handle))
      throw normalizeToolError({ code: 'authorization' })
    const response = await this.transport.bytes(
      this.endpoint(this.taskPath(handle.externalTaskId)),
      signal,
      { method: 'GET', key: await this.key(), limit: 1024 * 1024 },
    )
    if (response.mime !== 'application/json')
      throw normalizeToolError({ code: 'malformed-response' })
    this.accepted.get(handle.externalTaskId)?.access.diagnostic(
      'status-response',
      {
        status: response.diagnostics.status,
        contentType: response.diagnostics.contentType,
      },
    )
    const status = this.parseStatus(JSON.parse(response.bytes.toString('utf8')), handle.externalTaskId)
    if (status.state === 'failed')
      return {
        state: 'failed',
        error: normalizeToolError({ code: 'provider' }),
      }
    if (status.state === 'unknown')
      return { state: 'unknown', reason: 'status-unavailable', resubmitAllowed: false }
    return status
  }

  async result<C extends VideoCapability>(
    _capability: C,
    handle: ToolTaskHandle,
    signal: AbortSignal,
  ): Promise<ToolResult<CapabilityOutput<C>>> {
    const grant = this.accepted.get(handle.externalTaskId)
    if (!grant || !this.owns(handle)) throw normalizeToolError({ code: 'authorization' })
    const response = await this.transport.bytes(
      this.endpoint(this.resultPath(handle.externalTaskId)),
      signal,
      { method: 'GET', key: await this.key(), limit: 1024 * 1024 },
    )
    grant.access.diagnostic('result-response', {
      status: response.diagnostics.status,
      contentType: response.diagnostics.contentType,
      contentLength: response.diagnostics.contentLength,
    })
    let payload: z.infer<typeof videoTaskResultSchema>
    try {
      if (response.mime !== 'application/json') throw new Error()
      payload = this.parseResult(JSON.parse(response.bytes.toString('utf8')), handle.externalTaskId)
      grant.access.diagnostic('output-reference', {
        outputCount: payload.videos.length,
      })
    } catch {
      return { state: 'failed', error: normalizeToolError({ code: 'malformed-response' }) }
    }
    try {
      if (payload.cost)
        grant.access.billing(payload.cost.amountMicro, payload.cost.currency)
      const videos: CapabilityOutput<'video.textToVideo'>['videos'] = []
      for (const item of payload.videos) {
        grant.access.diagnostic('output-download')
        const file = await this.downloadOutput(item.url, handle, grant.context, signal)
        grant.access.diagnostic('redirect-validation', {
          host: file.diagnostics.host,
          redirectCount: file.diagnostics.redirectCount,
          status: file.diagnostics.status,
        })
        grant.access.diagnostic('mime-detection', {
          contentType: file.diagnostics.contentType,
          contentLength: file.diagnostics.contentLength,
          mp4Magic:
            file.bytes.length >= 12 &&
            file.bytes.subarray(4, 8).toString('ascii') === 'ftyp',
        })
        if (
          file.bytes.length < 12 ||
          file.bytes.subarray(4, 8).toString('ascii') !== 'ftyp'
        )
          throw new Error('invalid MP4 signature')
        const video = await grant.access.ingest(file.bytes, 'video/mp4')
        await this.outputVerified(item.url, grant.context, file.bytes, video)
        videos.push(video)
      }
      return { state: 'completed', output: { videos } as CapabilityOutput<C> }
    } catch (raw) {
      return {
        state: 'failed',
        error: isTransportFailure(raw)
          ? raw.error
          : normalizeToolError({ code: 'malformed-response' }),
      }
    }
  }

  async cancel(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolCancelResult> {
    if (!this.profile.cancelSupport) return { state: 'unsupported' }
    if (!this.owns(handle))
      return { state: 'unknown' }
    try {
      const response = await this.transport.bytes(
        this.endpoint(this.cancelPath(handle.externalTaskId)),
        signal,
        { method: 'DELETE', key: await this.key(), limit: 1024 * 1024 },
      )
      if (response.mime !== 'application/json') throw new Error()
      return this.parseCancel(JSON.parse(response.bytes.toString('utf8')), handle.externalTaskId)
    } catch (raw) {
      return {
        state: 'failed',
        error: isTransportFailure(raw)
          ? raw.error
          : normalizeToolError({ code: 'provider' }),
      }
    }
  }

  async recover(
    handle: ToolTaskHandle,
    signal: AbortSignal,
  ): Promise<ToolRecoverResult> {
    if (!this.profile.recoverSupport) return { state: 'unsupported' }
    if (!this.owns(handle))
      return { state: 'unknown', resubmitAllowed: false }
    try {
      return { state: 'recovered', handle, status: await this.status(handle, signal) }
    } catch (raw) {
      return {
        state: 'failed',
        error: isTransportFailure(raw)
          ? raw.error
          : normalizeToolError(raw),
      }
    }
  }
}
