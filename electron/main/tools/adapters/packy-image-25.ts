import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { immutable } from '../registry.js'
import { requestFingerprint } from '../fingerprint.js'
import { normalizeToolError } from '../errors.js'
import { ImageHttpTransport, transportFailure } from './image-http.js'
import type {
  ImageApiTool,
  ImageCapability,
  ImageExecutionAccess,
} from './image-api.js'
import {
  capabilityContracts,
  type CapabilityInput,
  type CapabilityOutput,
} from '../../../../src/shared/capabilities/index.js'
import {
  toolDescriptorSchema,
  toolErrorSchema,
  toolHealthSchema,
  toolValidationSchema,
  type ToolCallContext,
  type ToolExecutionContext,
  type ToolSubmitResult,
} from '../../../../src/shared/tools.js'
import { generationEstimateSchema } from '../../../../src/shared/generation.js'

export const packyImage25ProfileSchema = z.strictObject({
  adapter: z.literal('packy-image-25'),
  toolId: z.literal('packy.image-25'),
  displayName: z.literal('PackyAPI · GPT Image 2.5 Sunburst'),
  modelId: z.literal('gpt-image-2.5-sunburst'),
  tokenGroup: z.literal('Image'),
  credentialRef: z.uuid().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
})
export type PackyImage25Profile = z.infer<typeof packyImage25ProfileSchema>
export interface PackyPaidValidationGate {
  consume(
    capability: ImageCapability,
    input: CapabilityInput<ImageCapability>,
    context: ToolExecutionContext,
  ): Promise<void>
}
const base = 'https://cf.api.fan/v1'
const sizes = [
  { width: 1024, height: 1024 },
  { width: 1536, height: 864 },
  { width: 864, height: 1536 },
]
const responseSchema = z.object({
  data: z
    .array(
      z.union([
        z.object({ b64_json: z.string().min(1).max(42_000_000) }),
        z.object({ url: z.url().max(4000) }),
      ]),
    )
    .length(1),
})
import type { ImageConnectivityReport } from '../../../../src/shared/image-api.js'
/** Packy native Images API. Production submissions remain disabled in 07-06.5. */
export class PackyImage25Adapter implements ImageApiTool {
  readonly profile: PackyImage25Profile
  private readonly transport: ImageHttpTransport
  private readonly credential: () => Promise<string>
  private readonly grants = new Map<
    string,
    { ctx: ToolExecutionContext; access: ImageExecutionAccess }
  >()
  private readonly baseUrl: string
  private readonly paidValidation: PackyPaidValidationGate | null
  constructor(
    profile: PackyImage25Profile,
    credential: () => Promise<string>,
    transport = new ImageHttpTransport({ timeoutMs: 180000 }),
    paidValidation: PackyPaidValidationGate | null = null,
  ) {
    this.profile = immutable(packyImage25ProfileSchema.parse(profile))
    this.credential = credential
    this.transport = transport
    this.paidValidation = paidValidation
    // Only a deliberately injected exact loopback transport can execute fixture generation.
    const fixture = transport.fixtureOrigin
      ? new URL(transport.fixtureOrigin)
      : null
    if (
      fixture &&
      (fixture.protocol !== 'http:' ||
        fixture.hostname !== '127.0.0.1' ||
        fixture.origin !== transport.fixtureOrigin)
    )
      throw new Error('Invalid fixture origin')
    this.baseUrl = fixture ? fixture.origin + '/v1' : base
  }
  describe() {
    return toolDescriptorSchema.parse({
      metadataVersion: '1.0.0',
      id: this.profile.toolId,
      name: this.profile.displayName,
      version: '1.0.0',
      kind: 'api',
      executionMode: 'cloud',
      availability: 'unknown',
      capabilities: (
        ['image.generate', 'image.referenceGenerate'] as const
      ).map((capability) => ({
        capability,
        contractVersion: '1.0.0',
        models: { status: 'known', value: [this.profile.modelId] },
        inputKinds:
          capability === 'image.generate' ? ['text'] : ['text', 'image'],
        referenceImages: {
          status: 'known',
          value: {
            min: capability === 'image.generate' ? 0 : 1,
            max: capability === 'image.generate' ? 0 : 1,
          },
        },
        aspectRatios: { status: 'known', value: ['1:1', '16:9', '9:16'] },
        resolutions: { status: 'known', value: sizes },
        durationSeconds: { status: 'unknown' },
        outputMimes: ['image/png'],
        seed: 'unsupported',
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
  async probeConnectivity(
    signal: AbortSignal,
  ): Promise<ImageConnectivityReport> {
    const report = {
      checkedAt: new Date().toISOString(),
      generationValidated: false as const,
      tokenGroupVerified: false as const,
    }
    let key: string
    try {
      key = await this.credential()
      if (!key.trim()) throw new Error()
    } catch {
      return {
        ...report,
        authentication: 'unknown',
        modelVisible: null,
        message: '安全凭据不可用；未发出请求',
      }
    }
    try {
      const r = await this.transport.bytes(
        this.baseUrl + '/models',
        AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        { key, limit: 2 * 1024 * 1024 },
      )
      if (r.mime !== 'application/json')
        throw transportFailure('malformed-response', false)
      const parsed = z
        .object({ data: z.array(z.object({ id: z.string() })).max(10000) })
        .safeParse(JSON.parse(r.bytes.toString('utf8')))
      if (!parsed.success) throw transportFailure('malformed-response', false)
      const modelVisible = parsed.data.data.some(
        (m) => m.id === this.profile.modelId,
      )
      return {
        ...report,
        authentication: 'accepted',
        modelVisible,
        message: modelVisible
          ? 'GET /models 已接受凭据，目标模型可见；Image 分组与生成参数仍未验证'
          : 'GET /models 已接受凭据，但目标模型不可见；未探测生成端点',
      }
    } catch (raw) {
      const e = z.object({ error: toolErrorSchema }).safeParse(raw)
      const code = e.success ? e.data.error.code : 'malformed-response'
      return {
        ...report,
        authentication:
          code === 'authentication' || code === 'authorization'
            ? 'rejected'
            : 'unknown',
        modelVisible: null,
        message: `GET /models 探测失败：${code}；未发起生成`,
      }
    }
  }
  async health(signal: AbortSignal) {
    const r = await this.probeConnectivity(signal)
    return toolHealthSchema.parse({
      toolId: this.profile.toolId,
      checkedAt: r.checkedAt,
      availability:
        r.authentication === 'accepted' &&
        r.modelVisible === true &&
        this.paidValidation
          ? 'available'
          : r.authentication === 'rejected' || r.modelVisible === false
            ? 'unavailable'
            : 'unknown',
      issues:
        r.authentication === 'accepted' &&
        r.modelVisible === true &&
        this.paidValidation
          ? []
          : [
              {
                code: 'tool-unavailable',
                field: null,
                message: r.message + '；真实生成关闭',
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
    const parsed = capabilityContracts[cap].input.safeParse(input)
    let valid = parsed.success && ctx.model === this.profile.modelId
    if (parsed.success) {
      const v = parsed.data as CapabilityInput<ImageCapability>
      const ratio =
        v.aspectRatio === '1:1'
          ? 1
          : v.aspectRatio === '16:9'
            ? 16 / 9
            : v.aspectRatio === '9:16'
              ? 9 / 16
              : 0
      valid =
        valid &&
        v.count === 1 &&
        v.seed === null &&
        v.outputMime === 'image/png' &&
        sizes.some(
          (s) =>
            s.width === v.resolution.width && s.height === v.resolution.height,
        ) &&
        Math.abs(v.resolution.width / v.resolution.height - ratio) < 0.001 &&
        (!('references' in v) ||
          (v.references.length === 1 && v.references[0].weight === 1))
      valid =
        valid &&
        ctx.requestFingerprint ===
          requestFingerprint({
            fingerprintVersion: '1',
            snapshot: { capability: cap, contractVersion: '1.0.0', input },
            toolId: this.profile.toolId,
            toolVersion: '1.0.0',
            model: ctx.model,
            sourceRevisions: {},
            routing: null,
          })
    }
    try {
      signal.throwIfAborted()
      if (!(await this.credential()).trim()) throw new Error()
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
              message:
                'Packy 本地限制、模型、凭据或指纹不满足（仅单图/单参考/PNG/无 seed）',
            },
          ],
      warnings: [
        {
          code: 'tool-unavailable',
          field: null,
          message: this.paidValidation
            ? 'Sunburst 首次最小付费验证；费用未知，只允许一次固定文生图'
            : '本地映射不证明 Sunburst 远端能力；真实生成关闭，费用未知',
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
      basis: `PackyAPI / ${this.profile.modelId} / Image; billing rules and account currency unverified`,
      createdAt: new Date().toISOString(),
      validUntil: new Date(
        Date.now() + (this.paidValidation ? 30 * 60 * 1000 : 60000),
      ).toISOString(),
    })
  }
  authorizeInputs(ctx: ToolExecutionContext, access: ImageExecutionAccess) {
    if (this.grants.has(ctx.taskId))
      throw transportFailure('authorization', false)
    this.grants.set(ctx.taskId, { ctx: structuredClone(ctx), access })
  }
  async submit<C extends ImageCapability>(
    cap: C,
    input: CapabilityInput<C>,
    ctx: ToolExecutionContext,
    signal: AbortSignal,
  ): Promise<ToolSubmitResult<CapabilityOutput<C>>> {
    const grant = this.grants.get(ctx.taskId)
    this.grants.delete(ctx.taskId)
    if (
      (!this.transport.fixtureOrigin && !this.paidValidation) ||
      !grant ||
      !ctx.approvalId ||
      JSON.stringify(grant.ctx) !== JSON.stringify(ctx)
    )
      throw transportFailure('authorization', false)
    if (!(await this.validate(cap, input, ctx, signal)).valid)
      throw transportFailure('validation', false)
    if (!this.transport.fixtureOrigin) {
      try {
        await this.paidValidation!.consume(
          cap,
          input as CapabilityInput<ImageCapability>,
          ctx,
        )
      } catch {
        throw transportFailure('authorization', false)
      }
    }
    let key: string
    try {
      key = await this.credential()
    } catch {
      throw transportFailure('authentication', false)
    }
    let prompt =
      input.prompt +
      (input.negativePrompt ? '\nAvoid: ' + input.negativePrompt : '')
    if ('references' in input)
      prompt += '\nReference image role: ' + input.references[0].role + '.'
    const fields = {
      model: this.profile.modelId,
      prompt,
      size: `${input.resolution.width}x${input.resolution.height}`,
      n: 1,
      output_format: 'png',
      response_format: 'b64_json',
      quality: 'low',
    }
    let body: string | Buffer = JSON.stringify(fields),
      contentType = 'application/json'
    if ('references' in input) {
      const file = grant.access.references.find(
        (r) => r.assetVersionId === input.references[0].assetVersionId,
      )
      if (
        !file ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.mime) ||
        file.bytes.length > 30 * 1024 * 1024
      )
        throw transportFailure('validation', false)
      const boundary = 'director-' + randomUUID()
      const chunks: Buffer[] = Object.entries(fields).map(([k, v]) =>
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
        ),
      )
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="reference.${file.mime === 'image/jpeg' ? 'jpg' : file.mime.split('/')[1]}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
        ),
        file.bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      )
      body = Buffer.concat(chunks)
      contentType = 'multipart/form-data; boundary=' + boundary
    }
    const r = await this.transport.bytes(
      this.baseUrl +
        (cap === 'image.generate' ? '/images/generations' : '/images/edits'),
      signal,
      { body, contentType, key, limit: 64 * 1024 * 1024 },
    )
    try {
      if (r.mime !== 'application/json') throw new Error()
      const data = responseSchema.parse(JSON.parse(r.bytes.toString('utf8')))
      const raw = data.data[0]
      const file =
        'b64_json' in raw
          ? { bytes: Buffer.from(raw.b64_json, 'base64'), mime: 'image/png' }
          : await this.transport.bytes(raw.url, signal, {
              limit: 30 * 1024 * 1024,
            })
      const image = await grant.access.ingest(file.bytes, file.mime)
      // usage token counts are not currency; never call billing with invented cost.
      return {
        state: 'completed',
        output: { images: [image] } as CapabilityOutput<C>,
      }
    } catch (raw) {
      const e = z.object({ error: toolErrorSchema }).safeParse(raw)
      throw transportFailure(
        e.success ? e.data.error.code : 'malformed-response',
        true,
      )
    }
  }
  async status(): Promise<never> {
    throw normalizeToolError({ code: 'validation' })
  }
  async result(): Promise<never> {
    throw normalizeToolError({ code: 'validation' })
  }
  async cancel() {
    return { state: 'unsupported' as const }
  }
  async recover() {
    return { state: 'unsupported' as const }
  }
}
