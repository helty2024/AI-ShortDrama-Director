import { diagnoseComfy } from './diagnostics.js'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { randomInt } from 'node:crypto'
import { imageRequestSchema } from '../../../src/shared/visual.js'
import type { VisualCommand } from '../../../src/shared/visual.js'
import { VisualRepository } from './repository.js'
import { AITaskQueue } from '../intelligence/queue.js'
import { DomainError } from '../database.js'
import { MockImageProvider, ComfyUIImageProvider } from './providers.js'
export interface VisualPicker {
  images: () => Promise<string[]>
  workflow: () => Promise<string | null>
}
export class VisualService {
  readonly visual: VisualRepository
  readonly queue: AITaskQueue
  private picker: VisualPicker
  constructor(
    visual: VisualRepository,
    queue: AITaskQueue,
    picker: VisualPicker,
  ) {
    this.visual = visual
    this.queue = queue
    this.picker = picker
  }
  async execute(c: VisualCommand) {
    const p = c.projectId
    this.visual.repo.database.get(p)
    switch (c.operation) {
      case 'snapshot':
        return this.visual.snapshot(p)
      case 'settings.save':
        return this.visual.saveSettings(p, c.settings)
      case 'health': {
        const s = this.visual.settings(p)
        return (
          s.provider === 'mock-image'
            ? new MockImageProvider()
            : new ComfyUIImageProvider(s.baseUrl)
        ).healthCheck()
      }
      case 'workflow.import': {
        const path = await this.picker.workflow()
        if (!path) return null
        if ((await stat(path)).size > 1000000)
          throw new DomainError('INVALID_INPUT', '工作流不能超过 1 MB')
        return this.visual.importWorkflow(
          p,
          basename(path),
          JSON.parse(await readFile(path, 'utf8')) as unknown,
        )
      }
      case 'asset.import': {
        const paths = await this.picker.images()
        if (paths.length > 20)
          throw new DomainError('INVALID_INPUT', '单次最多导入 20 张图片')
        const ids: string[] = []
        for (const path of paths) {
          if (
            !['.png', '.jpg', '.jpeg', '.webp'].includes(
              extname(path).toLowerCase(),
            )
          )
            throw new DomainError('INVALID_INPUT', '文件类型不支持')
          const version = await this.visual.importFile(
            p,
            path,
            basename(path),
            c.assetId,
          )
          ids.push(version.assetId)
          if (c.targetId) {
            const target = this.visual.repo.entity(p, c.targetId)
            if (
              target.kind === 'character' ||
              target.kind === 'location' ||
              target.kind === 'prop'
            )
              this.visual.saveReferences(p, target.id, target.revision, [
                ...target.visualReferences.filter(
                  (r) => r.assetId !== version.assetId,
                ),
                {
                  assetId: version.assetId,
                  role:
                    target.kind === 'character'
                      ? 'faceReference'
                      : 'masterReference',
                  primary: false,
                },
              ])
          }
        }
        return ids
      }
      case 'asset.delete':
        return this.visual.deleteAsset(p, c.id, c.expectedRevision)
      case 'media.read':
        return this.visual.media(p, c.versionId, c.thumbnail)
      case 'compile':
        return this.visual.compile(p, c.targetId, c.previousShot)
      case 'version.review':
        return this.visual.review(
          p,
          c.id,
          c.expectedRevision,
          c.status,
          c.targetId,
          c.targetRevision,
        )
      case 'references.save':
        return this.visual.saveReferences(
          p,
          c.id,
          c.expectedRevision,
          c.references,
        )
      case 'orphans.scan':
        return this.visual.scan()
      case 'generate': {
        const target = this.visual.repo.entity(p, c.targetId),
          compiled = this.visual.compile(p, c.targetId, c.previousShot),
          settings = this.visual.settings(p)
        const prompt = {
          ...compiled,
          positivePrompt: c.positivePrompt ?? compiled.positivePrompt,
          negativePrompt: c.negativePrompt ?? compiled.negativePrompt,
        }
        const template = this.visual
          .templates(p)
          .find((t) => t.id === settings.templateId)
        if (!template) throw new DomainError('CONFLICT', '工作流不存在')
        if (c.provider === 'comfyui') {
          const diagnostics = await diagnoseComfy(
            { ...settings, provider: 'comfyui' },
            template,
          )
          if (!diagnostics.ready)
            throw new DomainError('CONFLICT', diagnostics.errors.join('；'))
        }
        const referenceVersionIds = prompt.referenceAssetIds.map((id) => {
          const asset = this.visual.asset(p, id)
          const previous = prompt.providerHints.previousKeyframeVersionId
          if (
            typeof previous === 'string' &&
            this.visual.version(p, previous).assetId === id
          )
            return previous
          if (!asset.approvedVersionId)
            throw new DomainError('CONFLICT', '参考资产尚未批准版本')
          return asset.approvedVersionId
        })
        const request = imageRequestSchema.parse({
          prompt,
          provider: c.provider,
          width: settings.width,
          height: settings.height,
          seed:
            settings.seedMode === 'fixed'
              ? settings.seed
              : randomInt(2147483647),
          referenceVersionIds,
          providerOptions: {
            baseUrl: settings.baseUrl,
            workflow: template.workflow,
            templateId: template.id,
            checkpoint: settings.checkpoint,
            steps: settings.steps,
            cfg: settings.cfg,
          },
        })
        if (
          c.provider === 'comfyui' &&
          !settings.checkpoint &&
          JSON.stringify(template.workflow).includes('{{checkpoint}}')
        )
          throw new DomainError('CONFLICT', '请先配置本机 Checkpoint 名称')
        return this.visual.repo.database.transaction(() => {
          const asset = c.assetId
            ? this.visual.asset(p, c.assetId)
            : this.visual.repo.database.createDraft({
                projectId: p,
                kind: 'asset',
                name: (
                  target.name +
                  ' · ' +
                  (target.kind === 'shot' ? '关键帧' : '视觉资产')
                ).slice(0, 120),
              })
          const type =
            target.kind === 'character'
              ? 'character-image'
              : target.kind === 'location'
                ? 'location-image'
                : target.kind === 'prop'
                  ? 'prop-image'
                  : 'shot-keyframe'
          return this.queue.start(p, {
            type,
            targetId: target.id,
            assetId: asset.id,
            request,
          })
        })
      }
    }
  }
}
