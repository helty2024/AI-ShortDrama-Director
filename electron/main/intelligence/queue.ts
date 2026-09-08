import type { MediaTaskExecutor } from '../visual/executor.js'
import { metadata, DomainError } from '../database.js'
import { IntelligenceRepository } from './repository.js'
import { AIError, normalizeAIError } from './provider.js'
import type { TextGenerationProvider } from './provider.js'
import { prompts, PROMPT_VERSION } from './prompts.js'
import { parseScript } from './parser.js'
import {
  taskInputSchema,
  aiTaskSchema,
  breakdownOutputSchema,
  shotOutputSchema,
} from '../../../src/shared/intelligence.js'
import type {
  AITask,
  TaskInput,
  IntelligenceDraft,
} from '../../../src/shared/intelligence.js'

export class AITaskQueue {
  private active: {
    id: string
    projectId: string
    controller: AbortController
  } | null = null
  private stopped = false
  private scheduled: ReturnType<typeof setTimeout> | undefined
  private media: MediaTaskExecutor | undefined
  readonly repo: IntelligenceRepository
  readonly provider: TextGenerationProvider
  constructor(
    repo: IntelligenceRepository,
    provider: TextGenerationProvider,
    media?: MediaTaskExecutor,
  ) {
    this.media = media
    this.repo = repo
    this.provider = provider
    for (const project of repo.database.list())
      for (const task of repo.list(project.id, 'ai_tasks', aiTaskSchema)) {
        if (task.status === 'running')
          repo.putTask({
            ...task,
            status:
              'request' in task.input && task.providerTaskId
                ? 'queued'
                : 'failed',
            error: { code: 'INTERRUPTED', message: '上次运行被中断，可以重试' },
            revision: task.revision + 1,
            updatedAt: new Date().toISOString(),
          })
      }
    this.schedule()
  }
  private sourceRevisions(projectId: string, input: TaskInput) {
    return input.type === 'parse' || 'request' in input
      ? {}
      : Object.fromEntries(
          this.repo
            .selectedScenes(projectId, input.targetId)
            .map((scene) => [scene.id, scene.revision]),
        )
  }
  start(projectId: string, raw: unknown): AITask {
    if (this.stopped) throw new DomainError('CONFLICT', '任务队列已关闭')
    this.repo.database.get(projectId)
    const input = taskInputSchema.parse(raw)
    const pending = this.repo
      .list(projectId, 'ai_tasks', aiTaskSchema)
      .filter((t) => t.status === 'queued' || t.status === 'running')
    if (pending.length >= 20)
      throw new DomainError('CONFLICT', '同一项目最多等待 20 个任务')
    const task = aiTaskSchema.parse({
      ...metadata(),
      projectId,
      input,
      provider: 'request' in input ? input.request.provider : null,
      model:
        'request' in input
          ? String(
              input.type === 'shot-video'
                ? input.request.profile.model
                : (input.request.providerOptions.templateId ?? ''),
            )
          : null,
      status: 'queued',
      attempt: 1,
      error: null,
      resultIds: [],
      sourceRevisions: this.sourceRevisions(projectId, input),
    })
    this.repo.putTask(task)
    this.schedule()
    return task
  }
  cancel(projectId: string, id: string) {
    const task = this.repo.task(projectId, id)
    if (!['queued', 'running'].includes(task.status)) return task
    if ('request' in task.input && task.providerTaskId)
      void this.media?.cancel(task).catch(() => undefined)
    if (this.active?.id === id) this.active.controller.abort()
    return this.repo.putTask({
      ...task,
      status: 'cancelled',
      error: null,
      completedAt: new Date().toISOString(),
      revision: task.revision + 1,
      updatedAt: new Date().toISOString(),
    })
  }
  retry(projectId: string, id: string) {
    const task = this.repo.task(projectId, id)
    if (
      !['failed', 'cancelled'].includes(task.status) ||
      this.active?.id === id
    )
      throw new DomainError('CONFLICT', '任务尚未结束或不可重试')
    const updated = this.repo.putTask({
      ...task,
      status: 'queued',
      attempt: task.attempt + 1,
      error: null,
      resultIds: [],
      progress: 0,
      completedAt: null,
      providerTaskId:
        task.input.type !== 'shot-video' && task.status === 'cancelled'
          ? null
          : task.providerTaskId,
      sourceRevisions: this.sourceRevisions(projectId, task.input),
      revision: task.revision + 1,
      updatedAt: new Date().toISOString(),
    })
    this.schedule()
    return updated
  }
  cancelProject(projectId: string) {
    for (const task of this.repo.list(projectId, 'ai_tasks', aiTaskSchema))
      if (task.status === 'queued' || task.status === 'running')
        this.cancel(projectId, task.id)
  }
  close() {
    this.stopped = true
    clearTimeout(this.scheduled)
    if (this.active) {
      const { projectId, id, controller } = this.active
      if (
        this.repo.database.list().some((project) => project.id === projectId)
      ) {
        if ('request' in this.repo.task(projectId, id).input) controller.abort()
        else this.cancel(projectId, id)
      } else controller.abort()
    }
  }
  private schedule() {
    if (this.stopped || this.scheduled) return
    this.scheduled = setTimeout(() => {
      this.scheduled = undefined
      void this.pump()
    }, 25)
  }
  private async pump() {
    if (this.stopped || this.active) return
    const task = this.repo.database
      .list()
      .flatMap((p) => this.repo.list(p.id, 'ai_tasks', aiTaskSchema))
      .find((t) => t.status === 'queued')
    if (!task) return
    const controller = new AbortController()
    this.active = { id: task.id, projectId: task.projectId, controller }
    this.repo.putTask({
      ...task,
      status: 'running',
      startedAt: task.startedAt ?? new Date().toISOString(),
      revision: task.revision + 1,
      updatedAt: new Date().toISOString(),
    })
    try {
      const drafts: IntelligenceDraft[] = []
      const preview =
        task.input.type === 'parse'
          ? {
              ...metadata(),
              projectId: task.projectId,
              name: task.input.name,
              rawText: task.input.rawText,
              parsed: parseScript(task.input.rawText),
              confirmedScriptId: null,
            }
          : null
      let commitMedia: (() => string[]) | undefined
      if ('request' in task.input) {
        if (!this.media) throw new AIError('PROVIDER', '图像执行器未配置')
        commitMedia = await this.media.execute(
          task,
          controller.signal,
          (id, progress) => {
            if (this.stopped || controller.signal.aborted) return
            const current = this.repo.task(task.projectId, task.id)
            if (current.status === 'running')
              this.repo.putTask({
                ...current,
                providerTaskId: id,
                progress,
                revision: current.revision + 1,
                updatedAt: new Date().toISOString(),
              })
          },
        )
      } else if (task.input.type !== 'parse') {
        const scenes = this.repo.selectedScenes(
          task.projectId,
          task.input.targetId,
        )
        for (const scene of scenes) {
          if (scene.revision !== task.sourceRevisions[scene.id])
            throw new AIError('STALE_SOURCE', '来源场次已修改，请重新分析')
          const request = {
            system: prompts[task.input.type],
            input: {
              type: task.input.type,
              scene,
              knownEntities: this.repo.database
                .workspace(task.projectId)
                .entities.filter(
                  (e) =>
                    e.kind === 'character' ||
                    e.kind === 'location' ||
                    e.kind === 'prop',
                ),
            },
            signal: controller.signal,
          }
          const base = () => ({
            ...metadata(),
            projectId: task.projectId,
            sceneId: scene.id,
            sourceRevision: scene.revision,
            taskId: task.id,
            provider: this.provider.name,
            promptVersion: PROMPT_VERSION,
            status: 'pending' as const,
            targetId: null,
          })
          if (task.input.type === 'shotPlanning') {
            const output = await this.provider.generateStructured({
              ...request,
              schema: shotOutputSchema,
              schemaName: 'shot_plan',
            })
            const known = new Map(
              this.repo.database
                .workspace(task.projectId)
                .entities.map((e) => [e.id, e.kind]),
            )
            for (const item of output.shots) {
              if (
                item.characterRefs.some(
                  (id) => known.get(id) !== 'character',
                ) ||
                item.propRefs.some((id) => known.get(id) !== 'prop') ||
                (item.locationRef && known.get(item.locationRef) !== 'location')
              )
                throw new AIError(
                  'INVALID_OUTPUT',
                  '镜头草稿包含无效或跨项目引用',
                )
              drafts.push({ ...base(), payload: { type: 'shot', item } })
            }
          } else {
            const output = await this.provider.generateStructured({
              ...request,
              schema: breakdownOutputSchema,
              schemaName: 'production_breakdown',
            })
            for (const item of output.elements) {
              if (
                task.input.type === 'characterBible' &&
                item.category !== 'character'
              )
                throw new AIError('INVALID_OUTPUT', '角色建议返回了非角色元素')
              drafts.push({ ...base(), payload: { type: 'breakdown', item } })
            }
          }
        }
      }
      if (this.stopped || controller.signal.aborted) return
      this.repo.database.transaction(() => {
        const current = this.repo.task(task.projectId, task.id)
        if (current.status !== 'running') return
        for (const [id, revision] of Object.entries(task.sourceRevisions))
          if (this.repo.entity(task.projectId, id).revision !== revision)
            throw new AIError(
              'STALE_SOURCE',
              '分析期间场次已修改，结果未入库，请重试',
            )
        if (preview) this.repo.putImport(preview)
        for (const draft of drafts) this.repo.putDraft(draft)
        const mediaIds = commitMedia?.() ?? []
        this.repo.putTask({
          ...this.repo.task(task.projectId, task.id),
          outputAssetVersionIds: mediaIds,
          progress: 1,
          completedAt: new Date().toISOString(),
          status: 'succeeded',
          resultIds: commitMedia
            ? mediaIds
            : preview
              ? [preview.id]
              : drafts.map((d) => d.id),
          error: null,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        })
      })
    } catch (error) {
      if (
        !this.stopped &&
        this.repo.database.list().some((p) => p.id === task.projectId)
      ) {
        const current = this.repo.task(task.projectId, task.id)
        if (current.status !== 'cancelled') {
          const normalized = normalizeAIError(error)
          this.repo.putTask({
            ...current,
            completedAt: new Date().toISOString(),
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            error: { code: normalized.code, message: normalized.message },
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
          })
        }
      }
    } finally {
      this.active = null
      this.schedule()
    }
  }
}
