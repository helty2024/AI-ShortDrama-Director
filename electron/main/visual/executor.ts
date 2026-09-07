import type { AITask } from '../../../src/shared/intelligence.js'
import type { AssetVersion } from '../../../src/shared/visual.js'
import { VisualRepository } from './repository.js'
import { MockImageProvider, ComfyUIImageProvider } from './providers.js'
import type { ImageGenerationProvider } from './providers.js'
import { AIError } from '../intelligence/provider.js'
export interface MediaTaskExecutor {
  execute(
    task: AITask,
    signal: AbortSignal,
    update: (id: string, progress: number) => void,
  ): Promise<() => string[]>
  cancel(task: AITask): Promise<void>
}
export class ImageTaskExecutor implements MediaTaskExecutor {
  readonly visual: VisualRepository
  private factory: (id: string, baseUrl: string) => ImageGenerationProvider
  constructor(
    visual: VisualRepository,
    factory = (id: string, baseUrl: string): ImageGenerationProvider =>
      id === 'mock-image'
        ? new MockImageProvider()
        : new ComfyUIImageProvider(baseUrl),
  ) {
    this.visual = visual
    this.factory = factory
  }
  private provider(task: AITask) {
    if (!('request' in task.input)) throw new AIError('PROVIDER', '非图像任务')
    return this.factory(
      task.input.request.provider,
      String(task.input.request.providerOptions.baseUrl ?? ''),
    )
  }
  async cancel(task: AITask) {
    if (task.providerTaskId)
      await this.provider(task).cancel(task.providerTaskId)
  }
  async execute(
    task: AITask,
    signal: AbortSignal,
    update: (id: string, progress: number) => void,
  ) {
    if (!('request' in task.input)) throw new AIError('PROVIDER', '非图像任务')
    const input = task.input,
      request = input.request
    this.visual.asset(task.projectId, input.assetId)
    const references = await Promise.all(
      request.referenceVersionIds.map(async (id) => {
        const v = this.visual.version(task.projectId, id)
        return this.visual.storage.read(v.storageKey)
      }),
    )
    const output = await this.provider(task).generate(request, {
      signal,
      providerTaskId: task.providerTaskId,
      update,
      references,
    })
    if (!output.length || output.length > 8)
      throw new AIError('INVALID_OUTPUT', '图像输出数量无效')
    const staged = await Promise.all(
      output.map(async (image) => ({
        stored: await this.visual.storage.store(
          task.projectId,
          input.assetId,
          image.bytes,
        ),
        image,
      })),
    )
    if (signal.aborted) throw new AIError('CANCELLED', '任务已取消')
    return () => {
      const existing = this.visual
        .versions(task.projectId)
        .filter((v) => v.generationTaskId === task.id)
      if (existing.length) return existing.map((v) => v.id)
      const versions: AssetVersion[] = staged.map(({ stored, image }) =>
        this.visual.commitVersion(task.projectId, input.assetId, stored, {
          sourceType: 'generated',
          provider: request.provider,
          model: image.model,
          prompt: request.prompt.positivePrompt,
          negativePrompt: request.prompt.negativePrompt,
          generationTaskId: task.id,
          sourceAssetIds: request.prompt.referenceAssetIds,
          metadata: {
            ...image.metadata,
            targetId: input.targetId,
            promptPackage: request.prompt,
            referenceVersionIds: request.referenceVersionIds,
          },
        }),
      )
      return versions.map((v) => v.id)
    }
  }
}
