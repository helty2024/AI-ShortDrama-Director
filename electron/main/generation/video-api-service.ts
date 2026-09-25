import { randomUUID } from 'node:crypto'
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
import type {
  VideoApiTool,
  VideoCapability,
  VideoExecutionAccess,
  VideoDiagnosticStage,
} from '../tools/adapters/video-api.js'
import { normalizeToolError } from '../tools/errors.js'
import type {
  ToolExecutionContext,
  ToolTaskHandle,
  ToolTaskStatus,
} from '../../../src/shared/tools.js'
import {
  persistedRecordSchema,
  type ProvenanceRecord,
} from '../../../src/shared/provenance.js'
import { aiTaskSchema, type AITask } from '../../../src/shared/intelligence.js'
import {
  videoApiPreviewInputSchema,
  videoApiPreviewSchema,
  type VideoApiPreview,
} from '../../../src/shared/video-api.js'

interface Preview {
  public: VideoApiPreview
  request: BrokerRequest
  preflight: PreflightResult
  record: ProvenanceRecord
  task: AITask
  adapter: VideoApiTool
}
interface Runtime {
  execution: string
  context: ToolExecutionContext
  handle: ToolTaskHandle
  adapter: VideoApiTool
  record: ProvenanceRecord
  reservationId: string
  assetId: string
  stored: StoredImage[]
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(normalizeToolError({ code: 'cancelled' }))
      return
    }
    const timer = setTimeout(done, ms)
    function done() {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      clearTimeout(timer)
      reject(normalizeToolError({ code: 'cancelled' }))
    }
    signal.addEventListener('abort', abort, { once: true })
  })

export class VideoApiGenerationService {
  readonly registry = new ToolRegistry()
  readonly broker = new ToolBroker(this.registry, { timeoutMs: 30000 })
  readonly visual: VisualRepository
  readonly generation: GenerationRepository
  readonly approvals: GenerationApprovalService
  private readonly tools = new Map<string, VideoApiTool>()
  private readonly previews = new Map<string, Preview>()
  private readonly pending = new Map<string, Promise<void>>()
  private readonly runtimes = new Map<string, Runtime>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly diagnostics = new Map<
    string,
    {
      stage: VideoDiagnosticStage
      details: Record<string, string | number | boolean | null>
      at: string
    }
  >()

  constructor(visual: VisualRepository, adapters: VideoApiTool[]) {
    this.visual = visual
    this.generation = new GenerationRepository(visual.repo.database)
    this.approvals = new GenerationApprovalService(
      new ApprovalRepository(visual.repo.database),
    )
    adapters.forEach((adapter) => this.register(adapter))
    for (const project of visual.repo.database.list())
      for (const reservation of this.approvals.repository.list(
        'approval_reservations',
        project.id,
      )) {
        const task = this.generation.task(project.id, reservation.taskId)
        if (
          task.input.type !== 'video-api' ||
          !['queued', 'running'].includes(task.status)
        )
          continue
        if (reservation.status === 'reserved') {
          this.approvals.release(
            project.id,
            reservation.id,
            'local-validation-failed',
          )
          new GenerationService(this.generation).failAttempt(
            project.id,
            reservation.generationRecordId,
            'failed',
          )
        }
        // submitted/pending-unknown with a providerTaskId remain recoverable.
        // Missing identities remain held for manual reconciliation and are
        // never silently resubmitted.
      }
  }

  register(adapter: VideoApiTool) {
    this.registry.register(adapter)
    this.tools.set(adapter.profile.toolId, adapter)
  }

  profiles() {
    return this.registry.list().map((entry) => ({
      toolId: entry.descriptor.id,
      displayName: entry.descriptor.name,
      model: entry.descriptor.capabilities[0].models,
      capabilities: entry.descriptor.capabilities.map((v) => v.capability),
      durations: this.tools.get(entry.descriptor.id)?.profile.supportedDurations ?? [],
      resolutions: this.tools.get(entry.descriptor.id)?.profile.supportedResolutions ?? [],
      aspectRatios: this.tools.get(entry.descriptor.id)?.profile.supportedAspectRatios ?? [],
    }))
  }

  async preview(raw: unknown): Promise<VideoApiPreview> {
    const input = videoApiPreviewInputSchema.parse(raw)
    const target = this.generation.entity(input.projectId, input.targetId)
    if (target.kind !== 'shot')
      throw new DomainError('INVALID_INPUT', 'Video API 目标必须是 Shot')
    const adapter = this.tools.get(input.toolId)
    const entry = this.registry.list().find((v) => v.descriptor.id === input.toolId)
    if (!adapter || !entry)
      throw new DomainError('NOT_FOUND', 'Video API 未配置')
    const capability: VideoCapability =
      input.mode === 'image-to-video'
        ? 'video.imageToVideo'
        : 'video.textToVideo'
    const frames = [
      ...(input.firstFrameAssetVersionId
        ? [this.visual.version(input.projectId, input.firstFrameAssetVersionId)]
        : []),
      ...(input.lastFrameAssetVersionId
        ? [this.visual.version(input.projectId, input.lastFrameAssetVersionId)]
        : []),
    ]
    if (
      (capability === 'video.imageToVideo' && frames.length < 1) ||
      (capability === 'video.textToVideo' && frames.length > 0) ||
      frames.some((v) => !v.mimeType.startsWith('image/'))
    )
      throw new DomainError('INVALID_INPUT', '首尾帧选择与生成模式不一致')
    if (frames.length && (!input.allowAssetUpload || input.localOnly))
      throw new DomainError('FORBIDDEN', '云端图生视频必须明确允许上传所选帧')
    const promptText =
      input.prompt?.trim() ||
      target.videoPrompt.trim() ||
      target.direction.action.trim() ||
      target.plan?.action.trim() ||
      target.description.trim() ||
      target.name
    const prompt = this.generation.create('prompt_packages', {
      id: randomUUID(),
      projectId: input.projectId,
      targetObjectId: target.id,
      targetObjectType: target.kind,
      semanticInputSnapshot: {
        target,
        context: this.visual.repo.database.workspace(input.projectId).entities,
      },
      compiledPrompt: {
        positivePrompt: promptText,
        negativePrompt: '',
        subjectDescription: target.name,
        composition: target.plan?.framing ?? '',
        camera: target.plan?.cameraMovement ?? target.direction.cameraMovement,
        lighting: '',
        style: '',
        continuity: target.direction.continuityNotes,
        referenceAssetIds: frames.map((v) => v.assetId),
        providerHints: {},
        promptVersion: 'video-api-prompt-v1',
      },
      compilerVersion: 'video-api-prompt-v1',
      skillId: null,
      skillVersion: null,
      targetCapability: capability,
      targetToolId: adapter.profile.toolId,
      targetModel: adapter.profile.modelId,
      createdAt: new Date().toISOString(),
    })
    const task = aiTaskSchema.parse({
      ...metadata(),
      projectId: input.projectId,
      input: { type: 'video-api', targetId: target.id },
      status: 'running',
      attempt: 1,
      error: null,
      resultIds: [],
      sourceRevisions: { [target.id]: target.revision },
    })
    const common = {
      prompt: promptText,
      negativePrompt: '',
      durationSeconds: input.durationSeconds,
      fps: input.fps,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      seed: input.seed,
      outputMime: 'video/mp4' as const,
      audio: 'none' as const,
    }
    const snapshot =
      capability === 'video.imageToVideo'
        ? {
            capability,
            contractVersion: '1.0.0' as const,
            input: {
              ...common,
              firstFrameAssetVersionId: input.firstFrameAssetVersionId!,
              lastFrameAssetVersionId: input.lastFrameAssetVersionId,
            },
          }
        : {
            capability,
            contractVersion: '1.0.0' as const,
            input: common,
          }
    const request = brokerRequestSchema.parse({
      projectId: input.projectId,
      requestId: task.id,
      snapshot,
      policy: {
        version: '1.0.0',
        selection: {
          mode: 'fixed',
          toolId: adapter.profile.toolId,
          toolVersion: entry.descriptor.version,
          model: adapter.profile.modelId,
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
      throw new DomainError('CONFLICT', '预检未通过：工具、隐私或输入限制不满足')
    const decision = this.generation.create(
      'routing_decisions',
      preflight.routingDecision,
    )
    const estimate = this.generation.create(
      'generation_estimates',
      preflight.estimate,
    )
    const record = persistedRecordSchema.parse({
      id: randomUUID(),
      projectId: input.projectId,
      targetObjectId: target.id,
      targetObjectType: target.kind,
      generationType: capability,
      sourceRevisions: task.sourceRevisions,
      inputAssetVersionIds: frames.map((v) => v.id),
      skillId: null,
      skillVersion: null,
      workflowTemplateId: null,
      workflowVersion: null,
      promptPackageId: prompt.id,
      routingDecisionId: decision.id,
      toolId: adapter.profile.toolId,
      toolVersion: entry.descriptor.version,
      modelId: adapter.profile.modelId,
      parameters: request.snapshot,
      requestFingerprint: estimate.requestFingerprint,
      seed: input.seed,
      estimateId: estimate.id,
      approvalId: null,
      estimatedCost: estimate.cost,
      actualCost: null,
      currency: adapter.profile.currency,
      costStatus: 'unknown',
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
    const publicPreview = videoApiPreviewSchema.parse({
      id: randomUUID(),
      projectId: input.projectId,
      target: target.name,
      tool: adapter.profile.displayName,
      model: adapter.profile.modelId,
      mode: input.mode,
      prompt: promptText,
      inputImageCount: frames.length,
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      currency: adapter.profile.currency,
      estimate:
        estimate.cost.status === 'known'
          ? `预估费用 ${estimate.cost.estimatedCost.currency} ${(estimate.cost.estimatedCost.amountMicros / 1_000_000).toFixed(4)}`
          : '费用未知，必须明确授权单次费用上限',
      expiresAt: estimate.validUntil,
      disclosure:
        'Cloud：确认后会上传生成描述及所选首尾帧。预览不提交、不上传、不产生费用。',
    })
    this.previews.set(publicPreview.id, {
      public: publicPreview,
      request,
      preflight,
      record,
      task,
      adapter,
    })
    return publicPreview
  }

  confirm(
    projectId: string,
    previewId: string,
    maxCostMicro: number,
    allowUnknownCost: boolean,
  ): AITask {
    const preview = this.previews.get(previewId)
    if (!preview || preview.public.projectId !== projectId)
      throw new DomainError('CONFLICT', '预览已失效或不属于此项目')
    this.previews.delete(previewId)
    const prepared = this.approvals.repository.atomic(() => {
      this.broker.assertCurrent(preview.request, preview.preflight)
      const approval = this.approvals.createApproval({
        confirmed: true,
        projectId,
        scope: 'single',
        currency: preview.public.currency,
        maxAuthorizedCostMicro: maxCostMicro,
        expiresAt: preview.public.expiresAt,
        items: [
          {
            record: preview.record,
            estimatedMaxCostMicro: maxCostMicro,
            allowUnknownCost,
          },
        ],
      })
      preview.record = { ...preview.record, approvalId: approval.id }
      return this.approvals.prepareAfterPreflight(
        this.broker,
        preview.request,
        preview.preflight,
        preview.task,
        preview.record,
        approval.itemIds[0],
      )
    })
    const controller = new AbortController()
    this.controllers.set(preview.task.id, controller)
    const running = this.run(
      preview,
      prepared.reservation.id,
      controller.signal,
    ).finally(() => {
      this.pending.delete(preview.task.id)
      this.controllers.delete(preview.task.id)
    })
    this.pending.set(preview.task.id, running)
    return this.generation.task(projectId, preview.task.id)
  }

  private reservation(projectId: string, taskId: string) {
    const value = this.approvals.repository
      .list('approval_reservations', projectId)
      .find((candidate) => candidate.taskId === taskId)
    if (!value) throw new DomainError('NOT_FOUND', '预算预留不存在')
    return value
  }

  private runtimeAccess(
    record: ProvenanceRecord,
    adapter: VideoApiTool,
    reservationId: string,
    assetId: string,
    stored: StoredImage[],
    context: ToolExecutionContext,
    executionRef: { value: string },
  ): Promise<VideoExecutionAccess> {
    return Promise.all(
      record.inputAssetVersionIds.map(async (id) => {
        const version = this.visual.version(record.projectId, id)
        if (!version.mimeType.startsWith('image/'))
          throw new DomainError('INVALID_INPUT', '视频输入帧必须是图片版本')
        return {
          assetVersionId: id,
          mime: version.mimeType,
          bytes: await this.visual.storage.read(version.storageKey),
        }
      }),
    ).then((frames) => ({
      frames,
      diagnostic: (stage, details = {}) => {
        this.diagnostics.set(record.taskId, {
          stage,
          details,
          at: new Date().toISOString(),
        })
      },
      billing: (amountMicro, currency) => {
        this.approvals.consume(
          record.projectId,
          reservationId,
          amountMicro,
          currency,
          'Reference Video Protocol structured billing response',
        )
      },
      ingest: async (bytes, mime) => {
        if (mime !== 'video/mp4' || bytes.length > adapter.profile.maxDownloadBytes)
          throw new DomainError('INVALID_INPUT', '视频输出格式或大小不符合 Profile')
        this.diagnostics.set(record.taskId, {
          stage: 'container-probe',
          details: {},
          at: new Date().toISOString(),
        })
        const file = await this.visual.storage.storeVideo(record.projectId, assetId, bytes)
        const input = record.parameters.input
        this.diagnostics.set(record.taskId, {
          stage: 'duration-validation',
          details: {
            expectedSeconds:
              'durationSeconds' in input ? input.durationSeconds : 0,
            actualSeconds: file.duration ?? 0,
          },
          at: new Date().toISOString(),
        })
        if (
          !('durationSeconds' in input) ||
          file.duration === undefined ||
          Math.abs(file.duration - input.durationSeconds) > adapter.profile.durationToleranceSeconds ||
          (adapter.profile.resolutionMode === 'exact' &&
            (file.width !== input.resolution.width || file.height !== input.resolution.height)) ||
          file.width > 8192 ||
          file.height > 8192 ||
          file.width * file.height > 40_000_000
        )
          throw new DomainError('INVALID_INPUT', '视频时长或分辨率不符合 Profile')
        this.diagnostics.set(record.taskId, {
          stage: 'dimension-validation',
          details: { width: file.width, height: file.height },
          at: new Date().toISOString(),
        })
        this.diagnostics.set(record.taskId, {
          stage: 'contract-match',
          details: { mime: file.mimeType },
          at: new Date().toISOString(),
        })
        stored.push(file)
        this.diagnostics.set(record.taskId, {
          stage: 'asset-ingestion',
          details: { fileSize: file.fileSize },
          at: new Date().toISOString(),
        })
        const output = {
          mime: 'video/mp4' as const,
          resolution: { width: file.width, height: file.height },
          durationSeconds: file.duration,
        }
        return {
          ...output,
          handle: this.broker.issueOutput(context, executionRef.value, output),
        }
      },
    }))
  }

  private async run(
    preview: Preview,
    reservationId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const record = preview.record
    const context: ToolExecutionContext = {
      projectId: record.projectId,
      taskId: record.taskId,
      estimateId: record.estimateId,
      approvalId: record.approvalId,
      routingDecisionId: record.routingDecisionId,
      model: record.modelId,
      requestFingerprint: record.requestFingerprint,
    }
    const assetId = randomUUID()
    const stored: StoredImage[] = []
    const executionRef = { value: '' }
    let intent = false
    let submitted = false
    try {
      const access = await this.runtimeAccess(
        record,
        preview.adapter,
        reservationId,
        assetId,
        stored,
        context,
        executionRef,
      )
      this.approvals.markSubmissionIntent(record.projectId, reservationId)
      intent = true
      this.generation.supplement(
        record.projectId,
        record.id,
        { startedAt: new Date().toISOString() },
      )
      executionRef.value = this.broker.openExecution(
        preview.request,
        preview.preflight,
        context,
        null,
        {
          allowProviderSelectedResolution:
            preview.adapter.profile.resolutionMode === 'provider-auto',
          durationToleranceSeconds:
            preview.adapter.profile.durationToleranceSeconds,
        },
      )
      preview.adapter.authorizeInputs(context, access)
      const snapshot = preview.request.snapshot
      if (
        snapshot.capability !== 'video.textToVideo' &&
        snapshot.capability !== 'video.imageToVideo'
      )
        throw new DomainError('INVALID_INPUT', '不是视频能力')
      submitted = true
      const response = await preview.adapter.submit(
        snapshot.capability,
        snapshot.input,
        context,
        signal,
      )
      if (response.state === 'unknown') {
        this.broker.markUnknownSubmission(preview.request, preview.preflight)
        this.approvals.markUnknownSubmission(record.projectId, reservationId)
        return
      }
      if (response.state !== 'accepted')
        throw new DomainError('CONFLICT', '异步 Video API 不接受同步完成响应')
      this.broker.bindAccepted(context, executionRef.value, response.handle)
      this.approvals.reconcileSubmissionReceipt(record.projectId, reservationId, {
        state: 'submitted',
        id: response.handle.externalTaskId,
      })
      const runtime: Runtime = {
        execution: executionRef.value,
        context,
        handle: response.handle,
        adapter: preview.adapter,
        record,
        reservationId,
        assetId,
        stored,
      }
      this.runtimes.set(record.taskId, runtime)
      await this.poll(runtime, signal)
    } catch (raw) {
      const failure = raw as { sent?: unknown; error?: unknown }
      const sent = failure && failure.sent === true
      if (!intent) {
        this.approvals.release(record.projectId, reservationId, 'local-validation-failed')
        new GenerationService(this.generation).failAttempt(record.projectId, record.id, 'failed')
      } else if (!submitted || failure.sent === false) {
        this.approvals.release(
          record.projectId,
          reservationId,
          'remote-no-charge',
          'Transport proved no request was sent',
        )
        new GenerationService(this.generation).failAttempt(record.projectId, record.id, 'failed')
      } else if (sent || failure.sent === undefined) {
        this.approvals.markUnknownSubmission(record.projectId, reservationId)
      }
      const task = this.generation.task(record.projectId, record.taskId)
      this.visual.repo.putTask({
        ...task,
        error: {
          code: normalizeToolError(raw).code,
          message: normalizeToolError(raw).message,
        },
      })
    }
  }

  private async poll(runtime: Runtime, signal: AbortSignal): Promise<void> {
    const profile = runtime.adapter.profile
    const started = Date.now()
    let interval = profile.polling.initialIntervalMs
    while (Date.now() - started < profile.polling.maxWaitMs) {
      let status: ToolTaskStatus
      try {
        status = await this.broker.status(
          runtime.context,
          runtime.execution,
          runtime.handle,
          signal,
        )
      } catch {
        // A known remote task remains recoverable. A local polling failure must
        // never create another remote submission or release its reservation.
        return
      }
      if (
        status.state === 'accepted' ||
        status.state === 'queued' ||
        status.state === 'running'
      ) {
        try {
          await sleep(interval, signal)
        } catch {
          if (signal.aborted) return
          throw normalizeToolError({ code: 'cancelled' })
        }
        interval = Math.min(profile.polling.maxIntervalMs, Math.ceil(interval * 1.5))
        continue
      }
      if (status.state === 'unknown') return
      if (status.state === 'cancelled') {
        new GenerationService(this.generation).failAttempt(
          runtime.record.projectId,
          runtime.record.id,
          'cancelled',
        )
        this.runtimes.delete(runtime.record.taskId)
        return
      }
      if (status.state === 'failed') {
        new GenerationService(this.generation).failAttempt(
          runtime.record.projectId,
          runtime.record.id,
          'failed',
        )
        this.runtimes.delete(runtime.record.taskId)
        return
      }
      const result = await this.broker.result(
        runtime.context,
        runtime.execution,
        runtime.record.generationType as VideoCapability,
        runtime.handle,
        signal,
      )
      if (result.state === 'not-ready') continue
      if (result.state === 'failed') {
        new GenerationService(this.generation).failAttempt(
          runtime.record.projectId,
          runtime.record.id,
          'malformed-output',
        )
        this.runtimes.delete(runtime.record.taskId)
        return
      }
      this.commit(runtime)
      this.runtimes.delete(runtime.record.taskId)
      return
    }
  }

  private commit(runtime: Runtime) {
    const p = runtime.record.projectId
    const input = runtime.record.parameters.input
    const sourceAssetIds = runtime.record.inputAssetVersionIds.map(
      (id) => this.visual.version(p, id).assetId,
    )
    this.visual.repo.database.transaction(() => {
      this.visual.repo.database.insertEntities(p, [
        {
          ...metadata(),
          id: runtime.assetId,
          projectId: p,
          kind: 'asset',
          name: `${this.generation.entity(p, runtime.record.targetObjectId).name} · Video API 候选`,
          description: '',
          mediaType: 'video',
          uri: null,
          status: 'placeholder',
          source: null,
          previousVersionId: null,
        },
      ])
      const versions = runtime.stored.map((file) =>
        this.visual.commitVersion(p, runtime.assetId, file, {
          sourceType: 'generated',
          provider: runtime.record.toolId,
          model: runtime.record.modelId,
          prompt: 'prompt' in input ? input.prompt : '',
          negativePrompt: 'negativePrompt' in input ? input.negativePrompt : '',
          generationTaskId: runtime.record.taskId,
          sourceAssetIds,
          metadata: {
            targetId: runtime.record.targetObjectId,
            generationRecordId: runtime.record.id,
          },
        }),
      )
      new GenerationService(this.generation).completeAttempt(
        p,
        runtime.record.id,
        versions.map((version, outputIndex) => ({
          id: randomUUID(),
          projectId: p,
          generationRecordId: runtime.record.id,
          assetVersionId: version.id,
          outputIndex,
          role: 'candidate',
          createdAt: new Date().toISOString(),
        })),
      )
    })
  }

  private async restore(projectId: string, taskId: string): Promise<Runtime | null> {
    const task = this.generation.task(projectId, taskId)
    const record = this.generation.findByTask(projectId, taskId)
    if (
      !record ||
      task.input.type !== 'video-api' ||
      task.status !== 'running' ||
      !task.providerTaskId ||
      record.outcome !== 'pending'
    )
      return null
    const adapter = this.tools.get(record.toolId)
    if (!adapter) throw new DomainError('CONFLICT', '原 Video Tool 版本未注册')
    const reservation = this.reservation(projectId, taskId)
    if (!['submitted', 'pending-unknown', 'consumed', 'requires-review'].includes(reservation.status))
      throw new DomainError('CONFLICT', '远端任务的预算状态不可恢复')
    const context: ToolExecutionContext = {
      projectId,
      taskId,
      estimateId: record.estimateId,
      approvalId: record.approvalId,
      routingDecisionId: record.routingDecisionId,
      model: record.modelId,
      requestFingerprint: record.requestFingerprint,
    }
    const handle: ToolTaskHandle = {
      toolId: record.toolId,
      toolVersion: record.toolVersion,
      externalTaskId: task.providerTaskId,
    }
    const assetId = randomUUID()
    const stored: StoredImage[] = []
    const executionRef = { value: '' }
    const access = await this.runtimeAccess(
      record,
      adapter,
      reservation.id,
      assetId,
      stored,
      context,
      executionRef,
    )
    adapter.authorizeRecovery(context, handle, access)
    executionRef.value = this.broker.restoreExecution(
      record.parameters,
      context,
      record.toolId,
      record.toolVersion,
      handle,
      {
        allowProviderSelectedResolution: adapter.profile.resolutionMode === 'provider-auto',
        durationToleranceSeconds: adapter.profile.durationToleranceSeconds,
      },
    )
    const recovered = await this.broker.recover(
      context,
      executionRef.value,
      handle,
      new AbortController().signal,
    )
    if (recovered.state !== 'recovered') return null
    const runtime = {
      execution: executionRef.value,
      context,
      handle,
      adapter,
      record,
      reservationId: reservation.id,
      assetId,
      stored,
    }
    this.runtimes.set(taskId, runtime)
    return runtime
  }

  async wait(taskId: string) {
    await this.pending.get(taskId)
  }

  async query(projectId: string, taskId: string) {
    const task = this.generation.task(projectId, taskId)
    if (task.input.type !== 'video-api')
      throw new DomainError('NOT_FOUND', 'Video API 任务不存在')
    if (task.status === 'running' && task.providerTaskId && !this.pending.has(taskId)) {
      const work = (async () => {
        const runtime = this.runtimes.get(taskId) ?? (await this.restore(projectId, taskId))
        if (runtime) await this.poll(runtime, new AbortController().signal)
      })().finally(() => this.pending.delete(taskId))
      this.pending.set(taskId, work)
      await work
    }
    const record = this.generation.findByTask(projectId, taskId)
    if (!record) throw new DomainError('NOT_FOUND', 'GenerationRecord 不存在')
    return {
      task: this.generation.task(projectId, taskId),
      record: this.generation.getRecord(projectId, record.id),
      reservationStatus: this.reservation(projectId, taskId).status,
      versions: record.outputAssetVersionIds.map((id) => this.visual.version(projectId, id)),
      diagnostic: this.diagnostics.get(taskId) ?? null,
    }
  }

  async cancel(projectId: string, taskId: string) {
    const task = this.generation.task(projectId, taskId)
    if (task.input.type !== 'video-api' || !task.providerTaskId)
      throw new DomainError('CONFLICT', '远端 Video API 任务尚未接受')
    const runtime = this.runtimes.get(taskId) ?? (await this.restore(projectId, taskId))
    if (!runtime) throw new DomainError('CONFLICT', '远端任务不可恢复')
    const result = await this.broker.cancel(
      runtime.context,
      runtime.execution,
      runtime.handle,
      new AbortController().signal,
    )
    if (result.state === 'cancelled' || result.state === 'waiting-stopped') {
      this.controllers.get(taskId)?.abort()
      const record = this.generation.findByTask(projectId, taskId)
      if (record?.outcome === 'pending')
        new GenerationService(this.generation).failAttempt(projectId, record.id, 'cancelled')
      this.runtimes.delete(taskId)
    }
    return result
  }

  review(
    projectId: string,
    versionId: string,
    revision: number,
    adopt: boolean,
    targetRevision: number,
  ) {
    const version = this.visual.version(projectId, versionId)
    const record = version.generationTaskId
      ? this.generation.findByTask(projectId, version.generationTaskId)
      : null
    if (
      version.mimeType !== 'video/mp4' ||
      !record ||
      !record.outputAssetVersionIds.includes(versionId) ||
      this.generation.task(projectId, record.taskId).input.type !== 'video-api'
    )
      throw new DomainError('FORBIDDEN', '不是 Video API 候选版本')
    return this.visual.review(
      projectId,
      versionId,
      revision,
      'approved',
      adopt ? record.targetObjectId : null,
      adopt ? targetRevision : null,
    )
  }

  hasPending(projectId: string) {
    return [...this.pending.keys()].some(
      (id) => this.generation.findByTask(projectId, id) !== null,
    )
  }
}
