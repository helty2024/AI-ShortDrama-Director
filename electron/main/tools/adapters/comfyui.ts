import { randomUUID } from 'node:crypto'
import type { CapabilityInput, CapabilityOutput } from '../../../../src/shared/capabilities/index.js'
import { capabilityContracts } from '../../../../src/shared/capabilities/index.js'
import { generationEstimateSchema } from '../../../../src/shared/generation.js'
import { comfyToolProfileSchema, type ComfyToolProfile, type ComfyWorkflowTemplate } from '../../../../src/shared/comfyui.js'
import { imageConnectivitySchema } from '../../../../src/shared/image-api.js'
import {
  toolDescriptorSchema, toolHealthSchema, toolValidationSchema,
  type ToolCallContext, type ToolExecutionContext, type ToolTaskHandle,
  type ToolTaskStatus, type ToolSubmitResult, type ToolResult,
  type ToolCancelResult, type ToolRecoverResult,
} from '../../../../src/shared/tools.js'
import type { ImageApiTool, ImageCapability, ImageExecutionAccess } from './image-api.js'
import { immutable } from '../registry.js'
import { requestFingerprint } from '../fingerprint.js'
import { normalizeToolError } from '../errors.js'
import { ComfyUIRuntime, type ComfyHistoryEntry } from './comfyui-runtime.js'
import { templateVariables } from '../../visual/workflows.js'

type Workflow = Record<string, unknown>
const clone = (value: Workflow): Workflow => structuredClone(value)
function bind(template: ComfyWorkflowTemplate, input: CapabilityInput<ImageCapability>, references: string[]): Workflow {
  const workflow = clone(template.workflow)
  const set = (binding: { nodeId: string; input: string } | undefined, value: unknown) => {
    if (!binding) return
    const node = workflow[binding.nodeId]
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw normalizeToolError({ code: 'validation' })
    const inputs = (node as { inputs?: unknown }).inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw normalizeToolError({ code: 'validation' })
    ;(inputs as Record<string, unknown>)[binding.input] = value
  }
  set(template.inputBindings.prompt, input.prompt)
  set(template.inputBindings.negativePrompt, input.negativePrompt)
  set(template.inputBindings.width, input.resolution.width)
  set(template.inputBindings.height, input.resolution.height)
  set(template.inputBindings.seed, input.seed ?? Math.floor(Math.random() * 2_147_483_647))
  if ('references' in input) {
    set(template.inputBindings.referenceImage, references[0])
    set(template.inputBindings.referenceWeight, input.references[0]?.weight ?? 1)
  }
  return workflow
}
function nodeClass(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return typeof (value as { class_type?: unknown }).class_type === 'string'
    ? (value as { class_type: string }).class_type : null
}
function containsString(value: unknown, expected: string): boolean {
  if (value === expected) return true
  if (Array.isArray(value)) return value.some((v) => containsString(v, expected))
  if (value && typeof value === 'object') return Object.values(value).some((v) => containsString(v, expected))
  return false
}

export class ComfyUIToolAdapter implements ImageApiTool {
  readonly profile: ComfyToolProfile
  readonly runtime: ComfyUIRuntime
  readonly outputResolutionPolicy = 'exact' as const
  get workflowIdentity() {
    return { templateId: this.profile.template.templateId, version: this.profile.template.version }
  }
  private readonly access = new Map<string, { context: ToolExecutionContext; access: ImageExecutionAccess }>()
  private readonly owners = new Map<string, string>()
  constructor(profile: ComfyToolProfile, runtime = new ComfyUIRuntime(profile.baseUrl)) {
    this.profile = immutable(comfyToolProfileSchema.parse(profile))
    this.runtime = runtime
  }
  describe() {
    const p = this.profile, t = p.template
    return toolDescriptorSchema.parse({
      metadataVersion: '1.0.0', id: p.toolId, name: p.displayName, version: '1.0.0',
      kind: 'application', executionMode: 'local-service', availability: 'unknown',
      capabilities: [{
        capability: t.capability, contractVersion: '1.0.0',
        models: { status: 'known', value: [p.modelId] },
        inputKinds: t.capability === 'image.referenceGenerate' ? ['text', 'image'] : ['text'],
        referenceImages: { status: 'known', value: { min: t.capability === 'image.referenceGenerate' ? 1 : 0, max: t.maxReferences } },
        aspectRatios: { status: 'known', value: t.supportedAspectRatios },
        resolutions: { status: 'known', value: t.supportedResolutions },
        durationSeconds: { status: 'unknown' }, outputMimes: ['image/png'],
        seed: 'supported', cancel: 'supported', recover: 'supported', estimate: 'supported',
        locality: 'local', resources: { memoryMB: { status: 'unknown' }, gpuMemoryMB: { status: 'unknown' }, dependencies: [] },
      }],
    })
  }
  async probeConnectivity(signal: AbortSignal) {
    const health = await this.health(signal)
    return imageConnectivitySchema.parse({
      checkedAt: health.checkedAt,
      authentication: 'unknown',
      modelVisible: null,
      generationValidated: false,
      tokenGroupVerified: false,
      message:
        health.availability === 'available'
          ? '本机 ComfyUI API 可达；模型、节点和工作流仍需在生成预检中验证'
          : '本机 ComfyUI 不可达；应用不会代为启动或修改服务',
    })
  }
  async health(signal: AbortSignal) {
    try {
      await this.runtime.systemStats(signal)
      return toolHealthSchema.parse({ toolId: this.profile.toolId, availability: 'available', checkedAt: new Date().toISOString(), issues: [] })
    } catch {
      return toolHealthSchema.parse({
        toolId: this.profile.toolId, availability: 'unavailable', checkedAt: new Date().toISOString(),
        issues: [{ code: 'tool-unavailable', field: null, message: '本机 ComfyUI 服务不可达' }],
      })
    }
  }
  async validate<C extends ImageCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolCallContext, signal: AbortSignal) {
    const issues: { code: 'invalid-input' | 'missing-dependency' | 'configuration-error'; field: string | null; message: string }[] = []
    const p = this.profile, t = p.template
    const parsed = capabilityContracts[cap].input.safeParse(input)
    if (!parsed.success || cap !== t.capability || ctx.model !== p.modelId)
      issues.push({ code: 'invalid-input', field: null, message: '能力、模型或输入不匹配' })
    if (parsed.success) {
      const v = parsed.data as CapabilityInput<ImageCapability>
      if (v.count !== 1 || v.outputMime !== 'image/png')
        issues.push({ code: 'invalid-input', field: 'count', message: '当前可信工作流只支持单张 PNG 输出' })
      if (!t.supportedResolutions.some((r) => r.width === v.resolution.width && r.height === v.resolution.height))
        issues.push({ code: 'invalid-input', field: 'resolution', message: '工作流不支持该分辨率' })
      if (!t.supportedAspectRatios.includes(v.aspectRatio))
        issues.push({ code: 'invalid-input', field: 'aspectRatio', message: '工作流不支持该画幅' })
      if ('references' in v && (v.references.length > t.maxReferences || !t.inputBindings.referenceImage))
        issues.push({ code: 'invalid-input', field: 'references', message: '参考图数量或绑定不受支持' })
      try {
        if (templateVariables(bind(t, v, ['director-preflight.png'])).length)
          issues.push({ code: 'configuration-error', field: 'workflow', message: '工作流包含未绑定的模板变量' })
      } catch {
        issues.push({ code: 'configuration-error', field: 'workflow', message: '工作流输入绑定无效' })
      }
    }
    if (ctx.requestFingerprint !== requestFingerprint({
      fingerprintVersion: '1', snapshot: { capability: cap, contractVersion: '1.0.0', input },
      toolId: p.toolId, toolVersion: '1.0.0', model: ctx.model, sourceRevisions: {}, routing: null,
    })) issues.push({ code: 'invalid-input', field: null, message: '请求指纹不匹配' })
    try {
      const info = await this.runtime.objectInfo(signal)
      const classes = Object.values(t.workflow).map(nodeClass).filter((v): v is string => v !== null)
      for (const required of t.requiredNodes)
        if (!info[required] || !classes.includes(required))
          issues.push({ code: 'missing-dependency', field: 'workflow', message: `缺少节点：${required}` })
      for (const model of t.requiredModels)
        if (!containsString(info, model))
          issues.push({ code: 'missing-dependency', field: 'model', message: `缺少模型：${model}` })
      const output = t.workflow[t.outputNode]
      const outputClass = nodeClass(output)
      if (!outputClass || (!info[outputClass]?.output_node && outputClass !== 'SaveImage'))
        issues.push({ code: 'configuration-error', field: 'outputNode', message: '输出节点无效' })
      for (const [name, binding] of Object.entries(t.inputBindings)) {
        if (!binding) continue
        const node = t.workflow[binding.nodeId]
        const inputs = node && typeof node === 'object' && !Array.isArray(node) ? (node as { inputs?: unknown }).inputs : null
        if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || !Object.hasOwn(inputs, binding.input))
          issues.push({ code: 'configuration-error', field: name, message: `输入绑定无效：${name}` })
      }
    } catch {
      issues.push({ code: 'missing-dependency', field: null, message: '无法读取 ComfyUI object_info' })
    }
    return toolValidationSchema.parse({ valid: issues.length === 0, issues, warnings: [], requestFingerprint: ctx.requestFingerprint })
  }
  async estimate<C extends ImageCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolCallContext, signal: AbortSignal) {
    if (!(await this.validate(cap, input, ctx, signal)).valid) throw normalizeToolError({ code: 'validation' })
    return generationEstimateSchema.parse({
      id: randomUUID(), projectId: ctx.projectId, routingDecisionId: ctx.routingDecisionId,
      requestFingerprint: ctx.requestFingerprint,
      cost: { status: 'known', estimatedCost: { amountMicros: 0, currency: this.profile.currency } },
      currency: this.profile.currency, estimatedDurationRange: { status: 'unknown' }, billingRisk: 'free',
      basis: `本机外部 ComfyUI；模板 ${this.profile.template.templateId}@${this.profile.template.version}；不估算电费或 GPU 成本`,
      createdAt: new Date().toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString(),
    })
  }
  authorizeInputs(ctx: ToolExecutionContext, access: ImageExecutionAccess) {
    if (this.access.has(ctx.taskId)) throw normalizeToolError({ code: 'authorization' })
    this.access.set(ctx.taskId, { context: structuredClone(ctx), access })
  }
  async submit<C extends ImageCapability>(cap: C, input: CapabilityInput<C>, ctx: ToolExecutionContext, signal: AbortSignal): Promise<ToolSubmitResult<CapabilityOutput<C>>> {
    const grant = this.access.get(ctx.taskId)
    if (!grant || JSON.stringify(grant.context) !== JSON.stringify(ctx) || !(await this.validate(cap, input, ctx, signal)).valid)
      throw normalizeToolError({ code: 'authorization' })
    const uploaded: string[] = []
    if ('references' in input) {
      for (const ref of input.references) {
        const file = grant.access.references.find((v) => v.assetVersionId === ref.assetVersionId)
        if (!file) throw normalizeToolError({ code: 'authorization' })
        uploaded.push(await this.runtime.upload(file.bytes, file.mime, signal))
      }
    }
    const promptId = await this.runtime.submit(bind(this.profile.template, input as CapabilityInput<ImageCapability>, uploaded), signal)
    this.owners.set(promptId, ctx.taskId)
    return { state: 'accepted', handle: { toolId: this.profile.toolId, toolVersion: '1.0.0', externalTaskId: promptId } }
  }
  private async state(handle: ToolTaskHandle, signal: AbortSignal): Promise<{ status: ToolTaskStatus; entry: ComfyHistoryEntry | null }> {
    const entry = await this.runtime.history(handle.externalTaskId, signal)
    if (entry) {
      if (entry.status?.status_str === 'error') return { status: { state: 'failed', error: normalizeToolError({ code: 'provider' }) }, entry }
      if (this.runtime.outputs(entry).length) return { status: { state: 'succeeded' }, entry }
      if (entry.status?.completed) return { status: { state: 'failed', error: normalizeToolError({ code: 'malformed-response' }) }, entry }
      return { status: { state: 'running', progress: null }, entry }
    }
    const queue = await this.runtime.queue(signal)
    if (queue.queue_running.some((entry) => entry[1] === handle.externalTaskId))
      return { status: { state: 'running', progress: null }, entry: null }
    if (queue.queue_pending.some((entry) => entry[1] === handle.externalTaskId))
      return { status: { state: 'queued', progress: null }, entry: null }
    return { status: { state: 'unknown', reason: 'status-unavailable', resubmitAllowed: false }, entry: null }
  }
  async status(handle: ToolTaskHandle, signal: AbortSignal) { return (await this.state(handle, signal)).status }
  async result<C extends ImageCapability>(_cap: C, handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolResult<CapabilityOutput<C>>> {
    const current = await this.state(handle, signal)
    if (current.status.state === 'failed')
      return { state: 'failed', error: current.status.error }
    if (current.status.state === 'accepted' || current.status.state === 'queued' || current.status.state === 'running' || current.status.state === 'unknown')
      return { state: 'not-ready', status: current.status }
    if (current.status.state === 'cancelled' || !current.entry)
      return { state: 'not-ready', status: { state: 'unknown', reason: 'status-unavailable', resubmitAllowed: false } }
    const owner = this.owners.get(handle.externalTaskId)
    const grant = owner ? this.access.get(owner) : undefined
    if (!grant) return { state: 'failed', error: normalizeToolError({ code: 'authorization' }) }
    try {
      const images: CapabilityOutput<'image.generate'>['images'] = []
      for (const output of this.runtime.outputs(current.entry)) {
        const file = await this.runtime.view(output, signal)
        const mime = file.mime === 'application/octet-stream' ? 'image/png' : file.mime
        images.push(await grant.access.ingest(file.bytes, mime))
      }
      grant.access.billing(0, this.profile.currency)
      this.access.delete(grant.context.taskId)
      this.owners.delete(handle.externalTaskId)
      return { state: 'completed', output: { images } as CapabilityOutput<C> }
    } catch { return { state: 'failed', error: normalizeToolError({ code: 'malformed-response' }) } }
  }
  async cancel(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolCancelResult> {
    try { await this.runtime.cancel(handle.externalTaskId, signal); return { state: 'cancelled' } }
    catch { return { state: 'unsupported' } }
  }
  async recover(handle: ToolTaskHandle, signal: AbortSignal): Promise<ToolRecoverResult> {
    try {
      const state = await this.state(handle, signal)
      return state.status.state === 'unknown'
        ? { state: 'unknown', resubmitAllowed: false }
        : { state: 'recovered', handle, status: state.status }
    } catch { return { state: 'unknown', resubmitAllowed: false } }
  }
}
