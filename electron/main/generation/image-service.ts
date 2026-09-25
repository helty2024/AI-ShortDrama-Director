import { randomUUID, createHash } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { DomainError, metadata } from '../database.js'
import { VisualRepository } from '../visual/repository.js'
import type { StoredImage } from '../visual/storage.js'
import { GenerationRepository } from './repository.js'
import { GenerationService } from './service.js'
import { GenerationApprovalService } from './approval.js'
import { ApprovalRepository } from './approval-repository.js'
import { ToolRegistry } from '../tools/registry.js'
import {
  ToolBroker,
  brokerRequestSchema,
  type BrokerRequest,
  type PreflightResult,
} from '../tools/broker.js'
import type { ImageApiTool } from '../tools/adapters/image-api.js'
import { normalizeToolError } from '../tools/errors.js'
import {
  toolErrorSchema,
  type ToolExecutionContext,
} from '../../../src/shared/tools.js'
import {
  persistedRecordSchema,
  type ProvenanceRecord,
} from '../../../src/shared/provenance.js'
import { aiTaskSchema, type AITask } from '../../../src/shared/intelligence.js'
import {
  imagePreviewInputSchema,
  type ImageApiPreview,
} from '../../../src/shared/image-api.js'
interface Preview {
  public: ImageApiPreview
  request: BrokerRequest
  preflight: PreflightResult
  record: ProvenanceRecord
  task: AITask
  adapter: ImageApiTool
}
const trustedPromptOverrideSchema = z.strictObject({
  positivePrompt: z.string().trim().min(1).max(100_000),
  compilerVersion: z.string().min(1).max(100),
})
export class ImageGenerationService {
  readonly registry = new ToolRegistry()
  readonly broker = new ToolBroker(this.registry)
  readonly visual: VisualRepository
  readonly generation: GenerationRepository
  readonly approvals: GenerationApprovalService
  private readonly imageTools = new Map<string, ImageApiTool>()
  private readonly previews = new Map<string, Preview>()
  private readonly pending = new Map<string, Promise<void>>()
  constructor(visual: VisualRepository, adapters: ImageApiTool[]) {
    this.visual = visual
    this.generation = new GenerationRepository(visual.repo.database)
    this.approvals = new GenerationApprovalService(
      new ApprovalRepository(visual.repo.database),
    )
    adapters.forEach((a) => this.register(a))
    for (const p of visual.repo.database.list())
      for (const r of this.approvals.repository.list(
        'approval_reservations',
        p.id,
      )) {
        const task = this.generation.task(p.id, r.taskId)
        if (
          task.input.type !== 'image-api' ||
          !['queued', 'running'].includes(task.status)
        )
          continue
        if (r.status === 'reserved') {
          this.approvals.release(p.id, r.id, 'local-validation-failed')
          new GenerationService(this.generation).failAttempt(
            p.id,
            r.generationRecordId,
            'failed',
          )
        } else if (['submitted', 'pending-unknown'].includes(r.status))
          this.approvals.markUnknownSubmission(p.id, r.id)
        else
          new GenerationService(this.generation).failAttempt(
            p.id,
            r.generationRecordId,
            'unknown',
          )
      }
  }
  register(adapter: ImageApiTool) {
    this.registry.register(adapter)
    this.imageTools.set(adapter.profile.toolId, adapter)
  }
  profiles() {
    return this.registry
      .list()
      .map((e) => ({
        toolId: e.descriptor.id,
        displayName: e.descriptor.name,
        model: e.descriptor.capabilities[0].models,
        resolutions: e.descriptor.capabilities[0].resolutions,
        executionMode: e.descriptor.executionMode,
        capabilities: e.descriptor.capabilities.map((c) => c.capability),
      }))
      .sort((a, b) => {
        const locality = Number(a.executionMode === 'local-service') - Number(b.executionMode === 'local-service')
        return locality || a.toolId.localeCompare(b.toolId)
      })
  }
  async probe(toolId: string) {
    const tool = this.imageTools.get(toolId)
    if (!tool?.probeConnectivity)
      throw new DomainError('INVALID_INPUT', '该工具未提供无副作用连通性探测')
    return tool.probeConnectivity(AbortSignal.timeout(15000))
  }
  /** Main-process-only override for an already reviewed exact prompt. IPC never accepts it. */
  async preview(
    raw: unknown,
    trustedPromptOverride?: {
      positivePrompt: string
      compilerVersion: string
    },
  ): Promise<ImageApiPreview> {
    const input = imagePreviewInputSchema.parse(raw),
      p = input.projectId,
      target = this.generation.entity(p, input.targetId)
    if (!['character', 'location', 'prop', 'shot'].includes(target.kind))
      throw new DomainError('INVALID_INPUT', '只支持 Bible / Shot')
    const fixedEntry = this.registry
      .list()
      .find((e) => e.descriptor.id === input.toolId)
    if (input.routingMode === 'fixed' && (!fixedEntry || !this.imageTools.has(input.toolId)))
      throw new DomainError('NOT_FOUND', '图像工具未配置')
    const fixedAdapter = this.imageTools.get(input.toolId),
      cap = input.references.length
        ? 'image.referenceGenerate'
        : 'image.generate'
    const references = input.references.map((ref) => {
      const v = this.visual.version(p, ref.assetVersionId)
      if (!v.mimeType.startsWith('image/'))
        throw new DomainError('INVALID_INPUT', '参考素材必须是图片')
      return v
    })
    const override = trustedPromptOverrideSchema.optional().parse(
      trustedPromptOverride,
    )
    if (override && references.length)
      throw new DomainError(
        'INVALID_INPUT',
        '精确文本 Prompt 入口不接受参考素材',
      )
    const prompt = override
      ? this.generation.create('prompt_packages', {
          id: randomUUID(),
          projectId: p,
          targetObjectId: target.id,
          targetObjectType: target.kind,
          semanticInputSnapshot: {
            target,
            context: this.visual.repo.database.workspace(p).entities,
          },
          compiledPrompt: {
            positivePrompt: override.positivePrompt,
            negativePrompt: '',
            subjectDescription: override.positivePrompt,
            composition: '',
            camera: '',
            lighting: '',
            style: '',
            continuity: '',
            referenceAssetIds: [],
            providerHints: {},
            promptVersion: override.compilerVersion,
          },
          compilerVersion: override.compilerVersion,
          skillId: null,
          skillVersion: null,
          targetCapability: cap,
          targetToolId: fixedAdapter?.profile.toolId ?? null,
          targetModel: fixedAdapter?.profile.modelId ?? null,
          createdAt: new Date().toISOString(),
        })
      : new GenerationService(this.generation).capturePrompt(p, target.id, cap)
    const compiled = prompt.compiledPrompt
    if (!('positivePrompt' in compiled))
      throw new DomainError('INVALID_INPUT', '需要图片提示词')
    const task = aiTaskSchema.parse({
      ...metadata(),
      projectId: p,
      input: { type: 'image-api', targetId: target.id },
      status: 'running',
      attempt: 1,
      error: null,
      resultIds: [],
      sourceRevisions: Object.fromEntries(
        prompt.semanticInputSnapshot.context.map((e) => [e.id, e.revision]),
      ),
    })
    const request = brokerRequestSchema.parse({
      projectId: p,
      requestId: task.id,
      snapshot: {
        capability: cap,
        contractVersion: '1.0.0',
        input: {
          prompt: compiled.positivePrompt,
          negativePrompt: compiled.negativePrompt,
          resolution: input.resolution,
          aspectRatio: input.aspectRatio,
          seed: null,
          count: input.count,
          outputMime: 'image/png',
          ...(input.references.length ? { references: input.references } : {}),
        },
      },
      policy: {
        version: '1.0.0',
        selection: input.routingMode === 'AUTO'
          ? { mode: 'AUTO' }
          : {
              mode: 'fixed',
              toolId: fixedAdapter!.profile.toolId,
              toolVersion: fixedEntry!.descriptor.version,
              model: fixedAdapter!.profile.modelId,
            },
        hardConstraints: {
          locality: input.localOnly ? 'local-only' : 'either',
          allowAssetUpload: input.allowAssetUpload,
          budget: null,
          requiredAvailability: 'available',
          availableMemoryMB: null,
          availableGpuMemoryMB: null,
          networkAvailable: true,
        },
        preferences: { order: [], quality: { status: 'unknown' } },
        unknown: {
          cost: 'allow',
          duration: 'allow',
          quality: 'allow',
          resources: 'allow',
        },
      },
    })
    const preflight = await this.broker.preflight(
      request,
      new AbortController().signal,
    )
    if (!preflight.ready || !preflight.routingDecision || !preflight.estimate)
      throw new DomainError(
        'CONFLICT',
        '预检未通过：配置、隐私策略或能力限制不满足',
      )
    const selectedEntry = this.registry.get(
        preflight.routingDecision.selectedToolId,
        preflight.routingDecision.selectedToolVersion,
      ),
      adapter = this.imageTools.get(preflight.routingDecision.selectedToolId)
    if (!adapter)
      throw new DomainError('CONFLICT', '路由选择的图像工具不可用')
    const decision = this.generation.create(
        'routing_decisions',
        preflight.routingDecision,
      ),
      estimate = this.generation.create(
        'generation_estimates',
        preflight.estimate,
      )
    const record = persistedRecordSchema.parse({
      id: randomUUID(),
      projectId: p,
      targetObjectId: target.id,
      targetObjectType: target.kind,
      generationType: cap,
      sourceRevisions: task.sourceRevisions,
      inputAssetVersionIds: references.map((v) => v.id),
      skillId: null,
      skillVersion: null,
      workflowTemplateId: adapter.workflowIdentity?.templateId ?? null,
      workflowVersion: adapter.workflowIdentity?.version ?? null,
      promptPackageId: prompt.id,
      routingDecisionId: decision.id,
      toolId: adapter.profile.toolId,
      toolVersion: selectedEntry.descriptor.version,
      modelId: decision.selectedModel,
      parameters: request.snapshot,
      requestFingerprint: estimate.requestFingerprint,
      seed: null,
      estimateId: estimate.id,
      approvalId: null,
      estimatedCost: estimate.cost,
      actualCost: null,
      currency: adapter.profile.currency,
      costStatus: estimate.cost.status === 'known' ? 'pending' : 'unknown',
      taskId: task.id,
      parentGenerationRecordId: null,
      attemptType: 'initial',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: null,
      completedAt: null,
      actualDuration: null,
      outputAssetVersionIds: [],
      outcome: 'pending',
    })
    const result: ImageApiPreview = {
      id: randomUUID(),
      projectId: p,
      target: target.name,
      tool: adapter.profile.displayName,
      model: decision.selectedModel ?? adapter.profile.modelId,
      prompt: compiled.positivePrompt,
      count: input.count,
      resolution: input.resolution,
      referenceCount: references.length,
      currency: adapter.profile.currency,
      estimate:
        estimate.cost.status === 'known'
          ? `预估费用 ${estimate.cost.estimatedCost.currency} ${(estimate.cost.estimatedCost.amountMicros / 1_000_000).toFixed(4)}`
          : '未知费用，必须明确授权单次费用上限',
      expiresAt: estimate.validUntil,
      disclosure:
        selectedEntry.descriptor.executionMode === 'local-service'
          ? 'Local：将提示词和项目内选中的参考图发送到用户自行运行的本机 ComfyUI；应用不会启动、停止或修改该服务。'
          : 'Cloud：将发送生成描述及选中的参考图片。本地预检不证明远端可用；提交前仍需人工确认。',
      executionMode:
        selectedEntry.descriptor.executionMode === 'local-service'
          ? 'local-service'
          : 'cloud',
      knownFree:
        estimate.cost.status === 'known' &&
        estimate.cost.estimatedCost.amountMicros === 0,
    }
    for (const [id, v] of this.previews)
      if (v.public.expiresAt < new Date().toISOString())
        this.previews.delete(id)
    if (this.previews.size >= 100)
      throw new DomainError('CONFLICT', '预览数量过多')
    this.previews.set(result.id, {
      public: result,
      request,
      preflight,
      record,
      task,
      adapter,
    })
    return result
  }
  /**
   * Main-process-only refresh for a preview that has already been shown to the
   * user. It renews the short-lived health snapshot while refusing any change
   * to the confirmed route, request fingerprint, currency, or quoted cost.
   */
  async refreshForConfirmation(previewId: string): Promise<ImageApiPreview> {
    const v = this.previews.get(previewId)
    if (!v)
      throw new DomainError('CONFLICT', '预览已失效')
    if (v.public.expiresAt <= new Date().toISOString()) {
      this.previews.delete(previewId)
      throw new DomainError('CONFLICT', '估价已过期，需要重新确认')
    }
    const priorDecision = v.preflight.routingDecision
    if (!priorDecision)
      throw new DomainError('CONFLICT', '原预检结果不完整')
    const refreshed = await this.broker.preflight(
      v.request,
      new AbortController().signal,
    )
    const decision = refreshed.routingDecision
    const estimate = refreshed.estimate
    if (
      !refreshed.ready ||
      !decision ||
      !estimate ||
      refreshed.requestFingerprint !== v.record.requestFingerprint ||
      decision.selectedToolId !== priorDecision.selectedToolId ||
      decision.selectedToolVersion !== priorDecision.selectedToolVersion ||
      decision.selectedModel !== priorDecision.selectedModel ||
      decision.requestedCapability !== priorDecision.requestedCapability ||
      JSON.stringify(estimate.cost) !== JSON.stringify(v.record.estimatedCost) ||
      estimate.currency !== v.public.currency
    )
      throw new DomainError(
        'CONFLICT',
        '预检结果已变化，需要重新显示并确认',
      )
    const storedDecision = this.generation.create(
      'routing_decisions',
      decision,
    )
    const storedEstimate = this.generation.create(
      'generation_estimates',
      estimate,
    )
    v.preflight = refreshed
    v.record = persistedRecordSchema.parse({
      ...v.record,
      routingDecisionId: storedDecision.id,
      estimateId: storedEstimate.id,
      requestFingerprint: refreshed.requestFingerprint,
      estimatedCost: storedEstimate.cost,
      updatedAt: new Date().toISOString(),
    })
    v.public = {
      ...v.public,
      expiresAt: storedEstimate.validUntil,
    }
    return v.public
  }
  confirm(
    projectId: string,
    previewId: string,
    maxCostMicro: number,
    allowUnknownCost: boolean,
  ): AITask {
    const v = this.previews.get(previewId)
    if (!v || v.public.projectId !== projectId)
      throw new DomainError('CONFLICT', '预览已失效或不属于此项目')
    this.previews.delete(previewId)
    const prepared = this.approvals.repository.atomic(() => {
      this.broker.assertCurrent(v.request, v.preflight)
      const approval = this.approvals.createApproval({
        confirmed: true,
        projectId,
        scope: 'single',
        currency: v.public.currency,
        maxAuthorizedCostMicro: maxCostMicro,
        expiresAt: v.public.expiresAt,
        items: [
          {
            record: v.record,
            estimatedMaxCostMicro: maxCostMicro,
            allowUnknownCost,
          },
        ],
      })
      v.record = { ...v.record, approvalId: approval.id }
      return this.approvals.prepareAfterPreflight(
        this.broker,
        v.request,
        v.preflight,
        v.task,
        v.record,
        approval.itemIds[0],
      )
    })
    const run = this.run(v, prepared.reservation.id).finally(() =>
      this.pending.delete(v.task.id),
    )
    this.pending.set(v.task.id, run)
    return this.generation.task(projectId, v.task.id)
  }
  hasPending(p: string) {
    return [...this.pending.keys()].some(
      (id) => this.generation.findByTask(p, id) !== null,
    )
  }
  async wait(taskId: string) {
    await this.pending.get(taskId)
  }
  query(p: string, taskId: string) {
    const record = this.generation.findByTask(p, taskId)
    if (!record || this.generation.task(p, taskId).input.type !== 'image-api')
      throw new DomainError('NOT_FOUND', '图像 API 任务不存在')
    return {
      task: this.generation.task(p, taskId),
      record,
      reservationStatus:
        this.approvals.repository
          .list('approval_reservations', p)
          .find((r) => r.taskId === taskId)?.status ?? null,
      versions: record.outputAssetVersionIds.map((id) =>
        this.visual.version(p, id),
      ),
    }
  }
  review(
    p: string,
    versionId: string,
    revision: number,
    adopt: boolean,
    targetRevision: number,
  ) {
    const version = this.visual.version(p, versionId),
      record = version.generationTaskId
        ? this.generation.findByTask(p, version.generationTaskId)
        : null
    if (
      !record ||
      !record.outputAssetVersionIds.includes(versionId) ||
      this.generation.task(p, record.taskId).input.type !== 'image-api'
    )
      throw new DomainError('FORBIDDEN', '不是图像 API 候选版本')
    return this.visual.review(
      p,
      versionId,
      revision,
      'approved',
      adopt ? record.targetObjectId : null,
      adopt ? targetRevision : null,
    )
  }
  private async run(v: Preview, reservationId: string): Promise<void> {
    const p = v.record.projectId,
      signal = new AbortController().signal,
      assetId = randomUUID(),
      stored: StoredImage[] = []
    let intent = false,
      received = false,
      submitStarted = false
    try {
      const references = await Promise.all(
        v.record.inputAssetVersionIds.map(async (id) => {
          const file = this.visual.version(p, id)
          const bytes = await this.visual.storage.read(file.storageKey)
          if (
            bytes.length > 30 * 1024 * 1024 ||
            createHash('sha256').update(bytes).digest('hex') !== file.hash
          )
            throw new DomainError('CONFLICT', '参考素材内容已改变')
          return { assetVersionId: id, mime: file.mimeType, bytes }
        }),
      )
      this.approvals.markSubmissionIntent(p, reservationId)
      intent = true
      const ctx: ToolExecutionContext = {
        projectId: p,
        taskId: v.task.id,
        estimateId: v.record.estimateId,
        approvalId: v.record.approvalId,
        routingDecisionId: v.record.routingDecisionId,
        model: v.record.modelId,
        requestFingerprint: v.record.requestFingerprint,
      }
      this.broker.assertCurrent(v.request, v.preflight)
      const providerSelectedResolution =
        v.adapter.outputResolutionPolicy === 'provider-auto'
      const execution = this.broker.openExecution(
        v.request,
        v.preflight,
        ctx,
        null,
        { allowProviderSelectedResolution: providerSelectedResolution },
      )
      v.adapter.authorizeInputs(ctx, {
        references,
        billing: (amount, currency) => {
          this.approvals.consume(
            p,
            reservationId,
            amount,
            currency,
            'Reference protocol structured billing response',
          )
        },
        ingest: async (bytes, mime) => {
          const input = v.request.snapshot.input
          if (
            !('resolution' in input) ||
            !['image/png', 'image/jpeg', 'image/webp'].includes(mime) ||
            bytes.length > 30 * 1024 * 1024
          )
            throw new Error('invalid image')
          const image = sharp(bytes, {
              limitInputPixels: 40_000_000,
              failOn: 'error',
            }),
            meta = await image.metadata(),
            actualMime =
              meta.format === 'jpeg' ? 'image/jpeg' : `image/${meta.format}`
          const safeProviderDimensions =
            meta.width !== undefined &&
            meta.height !== undefined &&
            meta.width > 0 &&
            meta.height > 0 &&
            meta.width <= 8192 &&
            meta.height <= 8192 &&
            meta.width * meta.height <= 40_000_000 &&
            meta.width / meta.height >= 1 / 3 &&
            meta.width / meta.height <= 3
          if (
            actualMime !== mime ||
            mime !== 'image/png' ||
            (providerSelectedResolution
              ? !safeProviderDimensions
              : meta.width !== input.resolution.width ||
                meta.height !== input.resolution.height) ||
            (meta.pages ?? 1) > 1
          )
            throw new Error('image mismatch')
          await image.raw().toBuffer()
          const file = await this.visual.storage.store(p, assetId, bytes)
          stored.push(file)
          const metadata = {
            mime: 'image/png' as const,
            resolution: { width: file.width, height: file.height },
          }
          return {
            ...metadata,
            handle: this.broker.issueOutput(ctx, execution, metadata),
          }
        },
      })
      const snapshot = v.request.snapshot
      if (
        snapshot.capability !== 'image.generate' &&
        snapshot.capability !== 'image.referenceGenerate'
      )
        throw new Error()
      submitStarted = true
      let result = await v.adapter.submit(
        snapshot.capability,
        snapshot.input,
        ctx,
        signal,
      )
      if (result.state === 'accepted') {
        const handle = result.handle
        this.broker.bindAccepted(ctx, execution, handle)
        this.approvals.reconcileSubmissionReceipt(p, reservationId, {
          state: 'submitted',
          id: handle.externalTaskId,
        })
        const deadline = Date.now() + 120000
        while (Date.now() < deadline) {
          const status = await this.broker.status(
            ctx,
            execution,
            handle,
            signal,
          )
          if (
            status.state === 'failed' ||
            status.state === 'cancelled' ||
            status.state === 'unknown'
          )
            throw normalizeToolError({ code: 'provider' })
          if (status.state === 'succeeded') {
            const output = await this.broker.result(
              ctx,
              execution,
              snapshot.capability,
              handle,
              signal,
            )
            if (output.state === 'completed') {
              result = { state: 'completed', output: output.output }
              break
            }
            if (output.state === 'failed') throw output.error
          }
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (result.state === 'accepted')
          throw normalizeToolError({ code: 'timeout' })
      }
      if (result.state !== 'completed') throw result.error
      received = true
      this.broker.acceptOutput(
        ctx,
        execution,
        snapshot.capability,
        result.output,
      )
      this.visual.repo.database.transaction(() => {
        this.visual.repo.database.insertEntities(p, [
          {
            ...metadata(),
            id: assetId,
            projectId: p,
            kind: 'asset',
            name: `${v.public.target} · API 候选`,
            description: '',
            mediaType: 'image',
            uri: null,
            status: 'placeholder',
            source: null,
            previousVersionId: null,
          },
        ])
        const versions = stored.map((file) =>
          this.visual.commitVersion(p, assetId, file, {
            sourceType: 'generated',
            provider: v.record.toolId,
            model: v.record.modelId,
            prompt: 'prompt' in snapshot.input ? snapshot.input.prompt : '',
            negativePrompt:
              'negativePrompt' in snapshot.input
                ? snapshot.input.negativePrompt
                : '',
            generationTaskId: v.task.id,
            sourceAssetIds: references.map(
              (r) => this.visual.version(p, r.assetVersionId).assetId,
            ),
            metadata: {},
          }),
        )
        new GenerationService(this.generation).completeAttempt(
          p,
          v.record.id,
          versions.map((version, index) => ({
            id: randomUUID(),
            projectId: p,
            generationRecordId: v.record.id,
            assetVersionId: version.id,
            outputIndex: index,
            role: 'candidate',
            createdAt: new Date().toISOString(),
          })),
        )
      })
    } catch (raw) {
      const failure = z
          .object({ sent: z.boolean(), error: toolErrorSchema })
          .safeParse(raw),
        error = failure.success
          ? failure.data.error
          : normalizeToolError(
              !submitStarted
                ? { code: 'validation' }
                : received
                  ? { code: 'malformed-response' }
                  : raw,
            )
      try {
        const reservation = this.approvals.repository.get(
          'approval_reservations',
          p,
          reservationId,
        )
        if (!intent) {
          this.approvals.release(p, reservationId, 'local-validation-failed')
          new GenerationService(this.generation).failAttempt(
            p,
            v.record.id,
            'failed',
          )
        } else if (!submitStarted || (failure.success && !failure.data.sent)) {
          this.approvals.release(
            p,
            reservationId,
            'remote-no-charge',
            'Transport proved no request was sent',
          )
          new GenerationService(this.generation).failAttempt(
            p,
            v.record.id,
            'failed',
          )
        } else if (
          ['submitted', 'pending-unknown'].includes(reservation.status)
        )
          this.approvals.markUnknownSubmission(p, reservationId)
        else
          new GenerationService(this.generation).failAttempt(
            p,
            v.record.id,
            'malformed-output',
          )
        const task = this.generation.task(p, v.task.id)
        this.visual.repo.putTask({
          ...task,
          error: { code: error.code, message: error.message },
        })
      } catch {
        /* Project may have been explicitly deleted; never resubmit or release on reconciliation failure. */
      }
    }
  }
}
