import { immutable } from '../registry.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { ToolAdapter } from '../protocol.js'
import {
  capabilityContracts,
  type CapabilityInput,
  type CapabilityOutput,
} from '../../../../src/shared/capabilities/index.js'
import {
  toolErrorSchema,
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
import { generationEstimateSchema } from '../../../../src/shared/generation.js'
import {
  imageApiProfileSchema,
  type ImageApiProfile,
  type ImageConnectivityReport,
} from '../../../../src/shared/image-api.js'
import { ImageHttpTransport, transportFailure } from './image-http.js'
import { requestFingerprint } from '../fingerprint.js'
import { normalizeToolError } from '../errors.js'
export type ImageCapability = 'image.generate' | 'image.referenceGenerate'
export interface ImageExecutionAccess {
  references: { assetVersionId: string; mime: string; bytes: Buffer }[]
  ingest: (
    bytes: Buffer,
    mime: string,
  ) => Promise<CapabilityOutput<'image.generate'>['images'][number]>
  billing: (amountMicro: number, currency: string) => void
}
export interface ImageApiTool extends ToolAdapter<ImageCapability> {
  probeConnectivity?(signal: AbortSignal): Promise<ImageConnectivityReport>
  /** Trusted host hint. Provider-auto means the native request omits size. */
  readonly outputResolutionPolicy?: 'exact' | 'provider-auto'
  readonly profile: Pick<
    ImageApiProfile,
    'toolId' | 'displayName' | 'currency' | 'modelId'
  >
  authorizeInputs(ctx: ToolExecutionContext, access: ImageExecutionAccess): void
}
const responseSchema = z.strictObject({
  images: z
    .array(
      z.union([
        z.strictObject({
          base64: z.string().max(42_000_000),
          mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
        }),
        z.strictObject({ url: z.url().max(4000) }),
      ]),
    )
    .min(1)
    .max(8),
  cost: z
    .strictObject({
      amountMicro: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .optional(),
})
/** Reference protocol v1 only; not an OpenAI/Seedream/etc compatibility claim. */
export class ImageApiAdapter implements ToolAdapter<ImageCapability> {
  readonly profile: ImageApiProfile
  readonly transport: ImageHttpTransport
  private readonly credential: () => Promise<string>
  private readonly access = new Map<
    string,
    { context: ToolExecutionContext; access: ImageExecutionAccess }
  >()
  constructor(
    profile: ImageApiProfile,
    credential: () => Promise<string>,
    transport = new ImageHttpTransport(),
  ) {
    this.profile = immutable(imageApiProfileSchema.parse(profile))
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
        inputKinds: ['text', 'image'],
        referenceImages: {
          status: 'known',
          value: { min: 0, max: p.maxReferences },
        },
        aspectRatios: { status: 'known', value: p.supportedAspectRatios },
        resolutions: { status: 'known', value: p.supportedResolutions },
        durationSeconds: { status: 'unknown' },
        outputMimes: ['image/png', 'image/jpeg', 'image/webp'],
        seed: 'supported',
        cancel: 'unsupported',
        recover: 'unsupported',
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
    let ready = true
    try {
      await this.credential()
    } catch {
      ready = false
    }
    return toolHealthSchema.parse({
      toolId: this.profile.toolId,
      availability: ready ? 'available' : 'unavailable',
      checkedAt: new Date().toISOString(),
      issues: ready
        ? []
        : [
            {
              code: 'permission-required',
              field: null,
              message: '安全凭据不可用',
            },
          ],
    })
  }
  async validate<C extends ImageCapability>(
    cap: C,
    input: CapabilityInput<C>,
    ctx: ToolCallContext,
    signal: AbortSignal,
  ) {
    const parsed = capabilityContracts[cap].input.safeParse(input),
      p = this.profile
    let valid =
      parsed.success &&
      p.supportedCapabilities.includes(cap) &&
      ctx.model === p.modelId
    if (parsed.success) {
      const v = parsed.data as CapabilityInput<ImageCapability>
      valid =
        valid &&
        p.supportedResolutions.some(
          (r) =>
            r.width === v.resolution.width && r.height === v.resolution.height,
        ) &&
        p.supportedAspectRatios.includes(v.aspectRatio) &&
        v.count <= p.maxOutputCount &&
        (!('references' in v) || v.references.length <= p.maxReferences) &&
        ctx.requestFingerprint ===
          requestFingerprint({
            fingerprintVersion: '1',
            snapshot: { capability: cap, contractVersion: '1.0.0', input },
            toolId: p.toolId,
            toolVersion: '1.0.0',
            model: ctx.model,
            sourceRevisions: {},
            routing: null,
          })
    }
    const u = new URL(p.endpoint)
    valid =
      valid &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search &&
      (u.protocol === 'https:' || this.transport.fixtureOrigin === u.origin)
    try {
      await this.credential()
      signal.throwIfAborted()
    } catch {
      valid = false
    }
    return toolValidationSchema.parse({
      valid,
      requestFingerprint: ctx.requestFingerprint,
      issues: valid
        ? []
        : [
            {
              code: 'invalid-input',
              field: null,
              message: '配置、凭据、模型或输入限制不满足',
            },
          ],
      warnings: [
        {
          code: 'tool-unavailable',
          field: null,
          message: '仅验证本地配置；远端连接未验证',
        },
      ],
    })
  }
  async estimate<C extends ImageCapability>(
    cap: C,
    input: CapabilityInput<C>,
    ctx: ToolCallContext,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted()
    if (!(await this.validate(cap, input, ctx, signal)).valid)
      throw normalizeToolError({ code: 'validation' })
    return generationEstimateSchema.parse({
      id: randomUUID(),
      projectId: ctx.projectId,
      routingDecisionId: ctx.routingDecisionId,
      requestFingerprint: ctx.requestFingerprint,
      cost: { status: 'unknown', reason: 'not-quoted' },
      currency: this.profile.currency,
      estimatedDurationRange: { status: 'unknown' },
      billingRisk: 'unknown',
      basis: `Reference protocol / model ${this.profile.modelId} / ${this.profile.currency}; no reliable pricing rule`,
      createdAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 60000).toISOString(),
    })
  }
  authorizeInputs(ctx: ToolExecutionContext, access: ImageExecutionAccess) {
    if (this.access.has(ctx.taskId))
      throw normalizeToolError({ code: 'authorization' })
    this.access.set(ctx.taskId, { context: structuredClone(ctx), access })
  }
  async submit<C extends ImageCapability>(
    cap: C,
    input: CapabilityInput<C>,
    ctx: ToolExecutionContext,
    signal: AbortSignal,
  ): Promise<ToolSubmitResult<CapabilityOutput<C>>> {
    const grant = this.access.get(ctx.taskId)
    this.access.delete(ctx.taskId)
    if (!grant || JSON.stringify(grant.context) !== JSON.stringify(ctx))
      throw transportFailure('authorization', false)
    const access = grant.access
    if (!access || !ctx.approvalId)
      throw transportFailure('authorization', false)
    if (!(await this.validate(cap, input, ctx, signal)).valid)
      throw transportFailure('validation', false)
    let key: string, body: string
    try {
      key = await this.credential()
      body = JSON.stringify({
        protocol: 'director-image-reference-v1',
        model: ctx.model,
        ...input,
        ...('references' in input
          ? {
              references: input.references.map((r) => {
                const file = access.references.find(
                  (v) => v.assetVersionId === r.assetVersionId,
                )
                if (!file) throw new Error()
                return {
                  ...r,
                  mime: file.mime,
                  base64: file.bytes.toString('base64'),
                }
              }),
            }
          : {}),
      })
    } catch {
      throw transportFailure('authentication', false)
    }
    const response = await this.transport.bytes(this.profile.endpoint, signal, {
      key,
      body,
      limit: 64 * 1024 * 1024,
    })
    let data: z.infer<typeof responseSchema>
    try {
      if (response.mime !== 'application/json') throw new Error()
      data = responseSchema.parse(JSON.parse(response.bytes.toString('utf8')))
      if (data.images.length !== input.count) throw new Error()
    } catch {
      throw transportFailure('malformed-response', true)
    }
    try {
      if (data.cost) access.billing(data.cost.amountMicro, data.cost.currency)
      const images: CapabilityOutput<'image.generate'>['images'] = []
      for (const raw of data.images) {
        const file =
          'base64' in raw
            ? { bytes: Buffer.from(raw.base64, 'base64'), mime: raw.mime }
            : await this.transport.bytes(raw.url, signal, {
                limit: 30 * 1024 * 1024,
              })
        images.push(await access.ingest(file.bytes, file.mime))
      }
      return { state: 'completed', output: { images } as CapabilityOutput<C> }
    } catch (raw) {
      const parsed = z.object({ error: toolErrorSchema }).safeParse(raw)
      throw transportFailure(
        parsed.success ? parsed.data.error.code : 'malformed-response',
        true,
      )
    }
  }
  async status(_h: ToolTaskHandle, _s: AbortSignal): Promise<ToolTaskStatus> {
    throw normalizeToolError({ code: 'validation' })
  }
  async result<C extends ImageCapability>(
    _c: C,
    _h: ToolTaskHandle,
    _s: AbortSignal,
  ): Promise<ToolResult<CapabilityOutput<C>>> {
    throw normalizeToolError({ code: 'validation' })
  }
  async cancel(_h: ToolTaskHandle, _s: AbortSignal): Promise<ToolCancelResult> {
    return { state: 'unsupported' }
  }
  async recover(
    _h: ToolTaskHandle,
    _s: AbortSignal,
  ): Promise<ToolRecoverResult> {
    return { state: 'unsupported' }
  }
}
