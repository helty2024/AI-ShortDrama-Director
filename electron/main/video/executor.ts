import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { setTimeout as delay } from 'node:timers/promises'
import type { AITask } from '../../../src/shared/intelligence.js'
import { costSchema } from '../../../src/shared/video.js'
import type { VideoProfile } from '../../../src/shared/video.js'
import { VisualRepository } from '../visual/repository.js'
import { ImageTaskExecutor } from '../visual/executor.js'
import type { MediaTaskExecutor } from '../visual/executor.js'
import { AIError } from '../intelligence/provider.js'
import type { VideoGenerationProvider, VideoInputs } from './providers.js'
export type VideoFactory = (profile: VideoProfile) => VideoGenerationProvider
export class VideoTaskExecutor implements MediaTaskExecutor {
  private visual: VisualRepository
  private factory: VideoFactory
  constructor(visual: VisualRepository, factory: VideoFactory) {
    this.visual = visual
    this.factory = factory
  }
  async cancel(task: AITask) {
    if (task.input.type === 'shot-video' && task.providerTaskId)
      await this.factory(task.input.request.profile).cancel(task.providerTaskId)
  }
  async execute(
    task: AITask,
    signal: AbortSignal,
    update: (id: string, progress: number) => void,
  ) {
    if (task.input.type !== 'shot-video')
      throw new AIError('PROVIDER', '不是视频任务')
    const input = task.input,
      request = input.request,
      p = request.prompt,
      provider = this.factory(request.profile)
    const first = this.visual.version(
      task.projectId,
      p.startFrameAssetVersionId,
    )
    if (first.mimeType === 'video/mp4')
      throw new AIError('INVALID_OUTPUT', '首帧必须是图片')
    const inputs: VideoInputs = {
      start: await this.visual.storage.read(first.storageKey),
      startMime: first.mimeType,
    }
    if (p.optionalEndFrameAssetVersionId) {
      const end = this.visual.version(
        task.projectId,
        p.optionalEndFrameAssetVersionId,
      )
      if (end.mimeType === 'video/mp4')
        throw new AIError('INVALID_OUTPUT', '尾帧必须是图片')
      inputs.end = await this.visual.storage.read(end.storageKey)
      inputs.endMime = end.mimeType
    }
    let id = task.providerTaskId
    const receiptRoot = join(
        dirname(this.visual.storage.root),
        'video-receipts',
      ),
      receiptPath = join(receiptRoot, z.uuid().parse(task.id) + '.json')
    if (!id) {
      let receipt: {
        state: 'submitting' | 'submitted'
        id: string | null
      } | null = null
      try {
        receipt = z
          .object({
            state: z.enum(['submitting', 'submitted']),
            id: z.string().nullable(),
          })
          .parse(JSON.parse(await readFile(receiptPath, 'utf8')))
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw new AIError('PROVIDER', '视频提交回执不可读取，拒绝重复提交')
      }
      if (receipt?.id) {
        id = receipt.id
        update(id, 0.01)
      } else if (receipt)
        throw new AIError(
          'PROVIDER',
          '上次提交结果未知，禁止重复提交此任务；请核对远端后明确创建新任务',
        )
      else {
        await mkdir(receiptRoot, { recursive: true })
        await writeFile(
          receiptPath,
          JSON.stringify({ state: 'submitting', id: null }),
          { flag: 'wx', mode: 0o600 },
        )
        id = await provider.submit(request, inputs, signal)
        await writeFile(
          receiptPath + '.tmp',
          JSON.stringify({ state: 'submitted', id }),
          { mode: 0o600 },
        )
        await rename(receiptPath + '.tmp', receiptPath)
        update(id, 0.01)
      }
    }
    const deadline = Date.now() + request.profile.timeoutSeconds * 1000
    while (Date.now() < deadline) {
      if (signal.aborted) throw new AIError('CANCELLED', '视频任务已取消')
      const status = await provider.getStatus(id, signal)
      update(id, Math.min(0.9, status.progress))
      if (status.status === 'failed' || status.status === 'cancelled')
        throw new AIError(
          'PROVIDER',
          `远端任务 ${status.status}；此 ID 不会重新提交，需要新任务时请明确重新生成`,
        )
      if (status.status === 'succeeded') {
        const bytes = await provider.fetchResult(
          id,
          status,
          request,
          inputs,
          signal,
        )
        const stored = await this.visual.storage.storeVideo(
          task.projectId,
          input.assetId,
          bytes,
        )
        if (signal.aborted) throw new AIError('CANCELLED', '任务已取消')
        const keyframes = [
          p.startFrameAssetVersionId,
          ...(p.optionalEndFrameAssetVersionId
            ? [p.optionalEndFrameAssetVersionId]
            : []),
        ]
        const cost = costSchema.parse({
          provider: request.provider,
          model: request.profile.model,
          duration: stored.duration,
          resolution: request.resolution,
          billingMetadata: status.billing ?? {},
        })
        return () => {
          const old = this.visual
            .versions(task.projectId)
            .find((v) => v.generationTaskId === task.id)
          if (old) return [old.id]
          const v = this.visual.commitVersion(
            task.projectId,
            input.assetId,
            stored,
            {
              sourceType: 'generated',
              provider: request.provider,
              model: request.profile.model,
              prompt: JSON.stringify(p),
              negativePrompt: p.negativePrompt,
              generationTaskId: task.id,
              sourceAssetIds: [
                ...new Set(
                  keyframes.map(
                    (k) => this.visual.version(task.projectId, k).assetId,
                  ),
                ),
              ],
              promptVersion: p.promptVersion,
              sourceKeyframeVersionIds: keyframes,
              cost,
              metadata: {
                targetId: input.targetId,
                videoPrompt: p,
                providerTaskId: id!,
                resolution: request.resolution,
                seed: request.seed,
              },
            },
          )
          const current = this.visual.repo.task(task.projectId, task.id)
          this.visual.repo.putTask({ ...current, costMetadata: cost })
          return [v.id]
        }
      }
      await delay(request.profile.pollingIntervalMs, undefined, { signal })
    }
    throw new AIError(
      'TIMEOUT',
      '视频任务等待超时，重试将查询既有远端 ID，不重新提交',
    )
  }
}
export class ProductionMediaExecutor implements MediaTaskExecutor {
  private image: ImageTaskExecutor
  private video: VideoTaskExecutor
  constructor(image: ImageTaskExecutor, video: VideoTaskExecutor) {
    this.image = image
    this.video = video
  }
  execute(
    task: AITask,
    signal: AbortSignal,
    update: (id: string, progress: number) => void,
  ) {
    return (task.input.type === 'shot-video' ? this.video : this.image).execute(
      task,
      signal,
      update,
    )
  }
  cancel(task: AITask) {
    return (task.input.type === 'shot-video' ? this.video : this.image).cancel(
      task,
    )
  }
}
