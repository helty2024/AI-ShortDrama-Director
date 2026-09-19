import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
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

const currentPackyImage25ProfileSchema = z.strictObject({
  adapter: z.literal('packy-image-25'),
  toolId: z.literal('packy.image-25'),
  displayName: z.literal('PackyAPI · GPT Image 2.5 Sunburst'),
  modelId: z.literal('gpt-image-2.5-sunburst'),
  tokenGroup: z.literal('image'),
  credentialRef: z.uuid().nullable(),
  currency: z.literal('USD'),
})
export const packyImage25ProfileSchema = z.preprocess(
  (value) =>
    value &&
    typeof value === 'object' &&
    'tokenGroup' in value &&
    value.tokenGroup === 'Image'
      ? { ...value, tokenGroup: 'image' }
      : value,
  currentPackyImage25ProfileSchema,
)
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
  data: z.array(z.record(z.string(), z.unknown())).length(1),
})
export const packyOutputStageSchema = z.enum([
  'generation-response',
  'response-envelope',
  'output-reference',
  'output-download',
  'redirect-validation',
  'mime-detection',
  'image-decode',
  'dimension-validation',
  'contract-match',
  'asset-ingestion',
])
export const packyOutputDiagnosticSchema = z.strictObject({
  stage: packyOutputStageSchema,
  state: z.enum(['succeeded', 'failed']),
  httpStatus: z.number().int().min(100).max(599).nullable().optional(),
  contentType: z.string().max(200).nullable().optional(),
  contentLength: z.number().int().min(0).nullable().optional(),
  requestId: z.string().max(200).nullable().optional(),
  topLevelKeys: z.array(z.string().regex(/^[A-Za-z0-9_]{1,100}$/)).max(50).optional(),
  dataCount: z.number().int().min(0).max(10000).optional(),
  itemKeys: z.array(z.string().regex(/^[A-Za-z0-9_]{1,100}$/)).max(50).optional(),
  hasUrl: z.boolean().optional(),
  hasB64Json: z.boolean().optional(),
  hasRevisedPrompt: z.boolean().optional(),
  downloadHost: z
    .string()
    .max(253)
    .regex(/^[A-Za-z0-9.-]+$/)
    .nullable()
    .optional(),
  redirectCount: z.number().int().min(0).max(3).optional(),
  finalMime: z.enum(['image/png', 'image/jpeg', 'image/webp']).nullable().optional(),
  magicBytes: z.enum(['png', 'jpeg', 'webp', 'unknown']).optional(),
  sharpDecoded: z.boolean().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  errorCode: z.string().regex(/^[a-z0-9-]{1,100}$/).optional(),
  message: z.string().max(300).optional(),
})
export type PackyOutputDiagnostic = z.infer<typeof packyOutputDiagnosticSchema>
export type PackyOutputDiagnosticsSink = (event: PackyOutputDiagnostic) => void

const safeKeys = (value: Record<string, unknown>): string[] =>
  Object.keys(value)
    .filter((key) => /^[A-Za-z0-9_]{1,100}$/.test(key))
    .sort()
    .slice(0, 50)
const magicMime = (
  bytes: Buffer,
): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; name: 'png' | 'jpeg' | 'webp' } | null => {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return { mime: 'image/png', name: 'png' }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mime: 'image/jpeg', name: 'jpeg' }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return { mime: 'image/webp', name: 'webp' }
  return null
}
const validAutoDimensions = (width: number, height: number): boolean => {
  const ratio = width / height
  return (
    width > 0 &&
    height > 0 &&
    width <= 8192 &&
    height <= 8192 &&
    width * height <= 40_000_000 &&
    ratio >= 1 / 3 &&
    ratio <= 3
  )
}
import type { ImageConnectivityReport } from '../../../../src/shared/image-api.js'
/** Packy native Images API. Production submissions remain disabled in 07-06.5. */
export class PackyImage25Adapter implements ImageApiTool {
  readonly profile: PackyImage25Profile
  readonly outputResolutionPolicy = 'provider-auto' as const
  private readonly transport: ImageHttpTransport
  private readonly credential: () => Promise<string>
  private readonly diagnostics: PackyOutputDiagnosticsSink | null
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
    diagnostics: PackyOutputDiagnosticsSink | null = null,
  ) {
    this.profile = immutable(packyImage25ProfileSchema.parse(profile))
    this.credential = credential
    this.transport = transport
    this.paidValidation = paidValidation
    this.diagnostics = diagnostics
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
  private record(event: PackyOutputDiagnostic): void {
    try {
      this.diagnostics?.(packyOutputDiagnosticSchema.parse(event))
    } catch {
      // Diagnostics are bounded and best-effort; they never alter generation state.
    }
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
        estimate:
          capability === 'image.generate' ? 'supported' : 'unsupported',
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
            ? 'Sunburst 单次付费验证；USD 0.4000，只允许一次固定文生图'
            : '本地映射不证明 Sunburst 远端能力；真实生成关闭',
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
      cost:
        cap === 'image.generate'
          ? {
              status: 'known',
              estimatedCost: { amountMicros: 400_000, currency: 'USD' },
            }
          : { status: 'unknown', reason: 'not-quoted' },
      currency: this.profile.currency,
      estimatedDurationRange: { status: 'unknown' },
      billingRisk: 'may-charge',
      basis:
        cap === 'image.generate'
          ? `PackyAPI / ${this.profile.modelId} / endpoint type image-generation / POST images/generations; USD 0.4000 per request`
          : `PackyAPI / ${this.profile.modelId} / image edit; price not confirmed`,
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
      n: 1,
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
    let stage: z.infer<typeof packyOutputStageSchema> = 'generation-response'
    let failureRecorded = false
    try {
      const response = await this.transport.bytes(
        this.baseUrl +
          (cap === 'image.generate' ? '/images/generations' : '/images/edits'),
        signal,
        { body, contentType, key, limit: 64 * 1024 * 1024 },
      )
      this.record({
        stage,
        state: 'succeeded',
        httpStatus: response.diagnostics.status,
        contentType: response.diagnostics.contentType,
        contentLength: response.diagnostics.contentLength,
        requestId: response.diagnostics.requestId,
      })
      stage = 'response-envelope'
      if (response.mime !== 'application/json') throw new Error('json-content-type')
      const decoded: unknown = JSON.parse(response.bytes.toString('utf8'))
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
        throw new Error('json-object')
      const envelope = decoded as Record<string, unknown>
      const parsed = responseSchema.safeParse(envelope)
      const dataCount = Array.isArray(envelope.data) ? envelope.data.length : 0
      const first =
        Array.isArray(envelope.data) &&
        envelope.data[0] &&
        typeof envelope.data[0] === 'object' &&
        !Array.isArray(envelope.data[0])
          ? (envelope.data[0] as Record<string, unknown>)
          : null
      if (!parsed.success || !first) {
        this.record({
          stage,
          state: 'failed',
          topLevelKeys: safeKeys(envelope),
          dataCount,
          itemKeys: first ? safeKeys(first) : [],
          errorCode: 'unexpected-envelope',
          message: 'Packy response envelope did not contain one usable data item',
        })
        failureRecorded = true
        throw new Error('response-envelope')
      }
      const hasUrl = typeof first.url === 'string'
      const hasB64Json = typeof first.b64_json === 'string'
      this.record({
        stage,
        state: 'succeeded',
        topLevelKeys: safeKeys(envelope),
        dataCount,
        itemKeys: safeKeys(first),
        hasUrl,
        hasB64Json,
        hasRevisedPrompt: typeof first.revised_prompt === 'string',
      })
      stage = 'output-reference'
      if (hasUrl === hasB64Json) throw new Error('ambiguous-output-reference')
      let fileBytes: Buffer
      let headerMime: string | null = null
      if (hasB64Json) {
        const encoded = first.b64_json as string
        if (
          encoded.length > 42_000_000 ||
          encoded.length === 0 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
        )
          throw new Error('invalid-base64')
        fileBytes = Buffer.from(encoded, 'base64')
        this.record({
          stage,
          state: 'succeeded',
          hasUrl: false,
          hasB64Json: true,
          hasRevisedPrompt: typeof first.revised_prompt === 'string',
        })
      } else {
        const parsedUrl = z.url().max(4000).safeParse(first.url)
        if (!parsedUrl.success) throw new Error('invalid-output-url')
        const host = new URL(parsedUrl.data).hostname
        this.record({
          stage,
          state: 'succeeded',
          hasUrl: true,
          hasB64Json: false,
          hasRevisedPrompt: typeof first.revised_prompt === 'string',
          downloadHost: host,
        })
        stage = 'output-download'
        let downloaded
        try {
          downloaded = await this.transport.bytes(parsedUrl.data, signal, {
            limit: 30 * 1024 * 1024,
            redirects: {
              max: 3,
              allowedHosts: ['external-resources.packyapi.ai'],
              allowedHostSuffixes: ['packyapi.ai'],
            },
          })
        } catch (raw) {
          const transport = z
            .object({
              error: toolErrorSchema,
              diagnostics: z
                .object({
                  status: z.number().nullable(),
                  contentType: z.string().nullable(),
                  contentLength: z.number().nullable(),
                  requestId: z.string().nullable(),
                  host: z.string().nullable(),
                  redirectCount: z.number(),
                })
                .optional(),
            })
            .safeParse(raw)
          const details = transport.success ? transport.data.diagnostics : undefined
          stage =
            transport.success &&
            ['validation', 'authorization'].includes(transport.data.error.code)
              ? 'redirect-validation'
              : 'output-download'
          this.record({
            stage,
            state: 'failed',
            httpStatus: details?.status ?? null,
            contentType: details?.contentType ?? null,
            contentLength: details?.contentLength ?? null,
            requestId: details?.requestId ?? null,
            downloadHost: details?.host ?? host,
            redirectCount: details?.redirectCount ?? 0,
            errorCode: transport.success ? transport.data.error.code : 'download-failed',
            message: 'Packy output download or redirect validation failed',
          })
          failureRecorded = true
          throw raw
        }
        fileBytes = downloaded.bytes
        headerMime = downloaded.diagnostics.contentType
        this.record({
          stage,
          state: 'succeeded',
          httpStatus: downloaded.diagnostics.status,
          contentType: headerMime,
          contentLength: downloaded.diagnostics.contentLength,
          requestId: downloaded.diagnostics.requestId,
          downloadHost: downloaded.diagnostics.host,
          redirectCount: downloaded.diagnostics.redirectCount,
        })
        stage = 'redirect-validation'
        this.record({
          stage,
          state: 'succeeded',
          downloadHost: downloaded.diagnostics.host,
          redirectCount: downloaded.diagnostics.redirectCount,
        })
      }
      stage = 'mime-detection'
      const detected = magicMime(fileBytes)
      this.record({
        stage,
        state: detected ? 'succeeded' : 'failed',
        contentType: headerMime,
        finalMime: detected?.mime ?? null,
        magicBytes: detected?.name ?? 'unknown',
        ...(detected
          ? {}
          : {
              errorCode: 'invalid-magic-bytes',
              message: 'Downloaded output is not a supported image payload',
            }),
      })
      if (!detected) {
        failureRecorded = true
        throw new Error('magic-bytes')
      }
      stage = 'image-decode'
      const image = sharp(fileBytes, {
          limitInputPixels: 40_000_000,
          failOn: 'error',
        }),
        metadata = await image.metadata().catch(() => null)
      if (!metadata) {
        this.record({
          stage,
          state: 'failed',
          finalMime: detected.mime,
          sharpDecoded: false,
          width: null,
          height: null,
          errorCode: 'image-decode-failed',
          message: 'Sharp could not decode the image payload',
        })
        failureRecorded = true
        throw new Error('image-decode')
      }
      const decodedMime =
        metadata.format === 'jpeg'
          ? 'image/jpeg'
          : metadata.format === 'png'
            ? 'image/png'
            : metadata.format === 'webp'
              ? 'image/webp'
              : null
      const decodedOk =
        decodedMime === detected.mime &&
        metadata.width !== undefined &&
        metadata.height !== undefined &&
        (metadata.pages ?? 1) === 1
      let pixelsDecoded = false
      if (decodedOk)
        pixelsDecoded = await image
          .clone()
          .raw()
          .toBuffer()
          .then(() => true)
          .catch(() => false)
      const sharpDecoded = decodedOk && pixelsDecoded
      this.record({
        stage,
        state: sharpDecoded ? 'succeeded' : 'failed',
        finalMime: detected.mime,
        sharpDecoded,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        ...(sharpDecoded
          ? {}
          : {
              errorCode: 'image-decode-failed',
              message: 'Sharp could not validate a single supported image frame',
            }),
      })
      if (!sharpDecoded || !metadata.width || !metadata.height) {
        failureRecorded = true
        throw new Error('image-decode')
      }
      stage = 'dimension-validation'
      const dimensionsValid = validAutoDimensions(metadata.width, metadata.height)
      this.record({
        stage,
        state: dimensionsValid ? 'succeeded' : 'failed',
        width: metadata.width,
        height: metadata.height,
        ...(dimensionsValid
          ? {}
          : {
              errorCode: 'unsafe-dimensions',
              message: 'Provider-selected dimensions exceed safety or aspect-ratio limits',
            }),
      })
      if (!dimensionsValid) {
        failureRecorded = true
        throw new Error('dimensions')
      }
      stage = 'contract-match'
      const normalizedBytes =
        detected.mime === 'image/png'
          ? fileBytes
          : await sharp(fileBytes, { failOn: 'error' }).png().toBuffer()
      this.record({
        stage,
        state: 'succeeded',
        finalMime: detected.mime,
        width: metadata.width,
        height: metadata.height,
      })
      stage = 'asset-ingestion'
      const output = await grant.access.ingest(normalizedBytes, 'image/png')
      this.record({
        stage,
        state: 'succeeded',
        finalMime: detected.mime,
        width: metadata.width,
        height: metadata.height,
      })
      // usage token counts are not currency; never call billing with invented cost.
      return {
        state: 'completed',
        output: { images: [output] } as CapabilityOutput<C>,
      }
    } catch (raw) {
      const e = z.object({ error: toolErrorSchema }).safeParse(raw)
      const transport = z
        .object({
          diagnostics: z
            .object({
              status: z.number().nullable(),
              contentType: z.string().nullable(),
              contentLength: z.number().nullable(),
              requestId: z.string().nullable(),
              host: z.string().nullable(),
              redirectCount: z.number(),
            })
            .optional(),
        })
        .safeParse(raw)
      const details = transport.success ? transport.data.diagnostics : undefined
      if (!failureRecorded) {
        this.record({
          stage,
          state: 'failed',
          httpStatus: details?.status ?? null,
          contentType: details?.contentType ?? null,
          contentLength: details?.contentLength ?? null,
          requestId: details?.requestId ?? null,
          ...(stage === 'output-download' || stage === 'redirect-validation'
            ? {
                downloadHost: details?.host ?? null,
                redirectCount: details?.redirectCount ?? 0,
              }
            : {}),
          errorCode: e.success ? e.data.error.code : 'malformed-response',
          message: `Packy output failed at ${stage}`,
        })
      }
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
