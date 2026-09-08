import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  videoProfileSchema,
  defaultVideoProfile,
  batchSchema,
  videoRequestSchema,
  costSchema,
} from '../../../src/shared/video.js'
import type {
  ProductionCommand,
  VideoProfile,
  BatchGenerationGroup,
} from '../../../src/shared/video.js'
import { VisualService } from '../visual/service.js'
import { VisualRepository } from '../visual/repository.js'
import { AITaskQueue } from '../intelligence/queue.js'
import { DomainError, metadata } from '../database.js'
import { diagnoseComfy } from '../visual/diagnostics.js'
import { compileShotVideoPrompt } from './compiler.js'
import { validateVideoUrl } from './providers.js'
import type { CredentialStore } from './credentials.js'
import type { VideoFactory } from './executor.js'
export interface ProductionPicker {
  credential: () => Promise<string | null>
  video: () => Promise<string | null>
}
export class ProductionService {
  readonly visual: VisualRepository
  private images: VisualService
  private queue: AITaskQueue
  private credentials: CredentialStore
  private factory: VideoFactory
  private picker: ProductionPicker
  constructor(
    visual: VisualRepository,
    images: VisualService,
    queue: AITaskQueue,
    credentials: CredentialStore,
    factory: VideoFactory,
    picker: ProductionPicker,
  ) {
    this.visual = visual
    this.images = images
    this.queue = queue
    this.credentials = credentials
    this.factory = factory
    this.picker = picker
  }
  profiles(projectId: string) {
    this.visual.repo.database.get(projectId)
    const rows = this.visual.repo.database.connection
      .prepare('SELECT data FROM video_profiles WHERE project_id=?')
      .all(projectId)
      .map((r) => videoProfileSchema.parse(JSON.parse(String(r.data))))
    return rows.some((r) => r.id === defaultVideoProfile.id)
      ? rows
      : [defaultVideoProfile, ...rows]
  }
  profile(projectId: string, id: string) {
    const p = this.profiles(projectId).find((p) => p.id === id)
    if (!p) throw new DomainError('NOT_FOUND', '视频 Profile 不存在')
    return p
  }
  private writeProfile(projectId: string, profile: VideoProfile) {
    this.visual.repo.database.connection
      .prepare(
        'INSERT INTO video_profiles VALUES (?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET data=excluded.data',
      )
      .run(projectId, profile.id, JSON.stringify(profile))
    return null
  }
  private batches(projectId: string) {
    return this.visual.repo.database.connection
      .prepare('SELECT data FROM production_batches WHERE project_id=?')
      .all(projectId)
      .map((r) => batchSchema.parse(JSON.parse(String(r.data))))
  }
  private putBatch(batch: BatchGenerationGroup) {
    const b = batchSchema.parse(batch)
    this.visual.repo.database.connection
      .prepare(
        'INSERT INTO production_batches VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(b.id, b.projectId, JSON.stringify(b))
    return b
  }
  async diagnostics(projectId: string) {
    const s = this.visual.settings(projectId),
      t = this.visual.templates(projectId).find((t) => t.id === s.templateId)
    if (!t) throw new DomainError('NOT_FOUND', '工作流不存在')
    return diagnoseComfy(s, t)
  }
  async execute(c: ProductionCommand) {
    const p = c.projectId
    this.visual.repo.database.get(p)
    switch (c.operation) {
      case 'snapshot': {
        const profiles = this.profiles(p)
        const credentials: Record<string, boolean> = {}
        for (const profile of profiles)
          credentials[profile.id] = profile.credentialRef
            ? await this.credentials.has(profile.credentialRef)
            : false
        return { profiles, batches: this.batches(p), credentials }
      }
      case 'diagnostics':
        return this.diagnostics(p)
      case 'diagnostics.test': {
        const s = this.visual.settings(p),
          d = await this.diagnostics(p)
        if (!d.ready) throw new DomainError('CONFLICT', d.errors.join('；'))
        return this.images.execute({
          operation: 'generate',
          projectId: p,
          targetId: c.shotId,
          assetId: null,
          provider: s.provider,
          positivePrompt: null,
          negativePrompt: null,
          previousShot: false,
        })
      }
      case 'batch.compile':
        return [...new Set(c.shotIds)].map((shotId) => {
          try {
            const shot = this.visual.repo.entity(p, shotId)
            if (shot.kind !== 'shot') throw Error('必须选择镜头')
            return {
              shotId,
              positivePrompt: this.visual.compile(p, shotId, false)
                .positivePrompt,
              error: null,
            }
          } catch (e) {
            return {
              shotId,
              positivePrompt: '',
              error: e instanceof Error ? e.message : '编译失败',
            }
          }
        })
      case 'batch.start': {
        let group = this.putBatch({
          id: randomUUID(),
          projectId: p,
          name: '关键帧批次 ' + new Date().toLocaleString('zh-CN'),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'active',
          kind: 'keyframe',
          entries: [],
        })
        for (const shotId of [...new Set(c.shotIds)]) {
          let taskId: string | null = null,
            error: string | null = null
          try {
            if (this.visual.repo.entity(p, shotId).kind !== 'shot')
              throw new DomainError('CONFLICT', '必须选择镜头')
            const task = await this.images.execute({
              operation: 'generate',
              projectId: p,
              targetId: shotId,
              assetId: null,
              provider: c.provider,
              positivePrompt: null,
              negativePrompt: null,
              previousShot: false,
            })
            taskId = z.object({ id: z.uuid() }).parse(task).id
          } catch (e) {
            error = e instanceof DomainError ? e.message : '该镜头创建任务失败'
          }
          group = this.putBatch({
            ...group,
            updatedAt: new Date().toISOString(),
            entries: [...group.entries, { shotId, taskId, error }],
          })
        }
        return group
      }
      case 'profile.save': {
        const profile = videoProfileSchema.parse(c.profile)
        validateVideoUrl(profile.baseUrl)
        const old = this.profiles(p).find((v) => v.id === profile.id)
        if (profile.credentialRef !== (old?.credentialRef ?? null))
          throw new DomainError('FORBIDDEN', '凭据引用只能由安全导入生成')
        if (profile.provider === 'mock-video' && profile.capabilities.endFrame)
          throw new DomainError('CONFLICT', 'Mock 视频只模拟首帧，不支持尾帧')
        if (profile.capabilities.referenceImages)
          throw new DomainError(
            'CONFLICT',
            '当前首帧适配器不支持混合参考图模式',
          )
        return this.writeProfile(p, profile)
      }
      case 'credential.import': {
        const profile = this.profile(p, c.profileId)
        if (profile.provider !== 'seedance')
          throw new DomainError('CONFLICT', 'Mock 不需要凭据')
        const path = await this.picker.credential()
        if (!path) return null
        if ((await stat(path)).size > 8192)
          throw new DomainError('INVALID_INPUT', '凭据文件过大')
        const secret = (await readFile(path, 'utf8')).trim()
        const ref = profile.credentialRef ?? randomUUID()
        await this.credentials.set(ref, secret)
        this.writeProfile(p, { ...profile, credentialRef: ref })
        return '凭据已通过系统安全存储加密，未发送到页面'
      }
      case 'profile.health':
        return this.factory(this.profile(p, c.profileId)).healthCheck()
      case 'direction.save': {
        if (this.visual.repo.entity(p, c.shotId).kind !== 'shot')
          throw new DomainError('CONFLICT', '必须选择镜头')
        return this.visual.repo.updateEntity(p, c.shotId, c.expectedRevision, {
          direction: c.direction,
          durationSeconds: c.duration,
        })
      }
      case 'video.compile':
      case 'video.generate': {
        const shot = this.visual.repo.entity(p, c.shotId)
        if (shot.kind !== 'shot')
          throw new DomainError('CONFLICT', '必须选择镜头')
        const profile = this.profile(p, c.profileId),
          entities = this.visual.repo.database.workspace(p).entities
        const first = shot.approvedKeyframeVersionId
          ? this.visual.version(p, shot.approvedKeyframeVersionId)
          : null
        if (
          !first ||
          first.mimeType === 'video/mp4' ||
          first.assetId !== shot.approvedKeyframeAssetId ||
          !['approved', 'archived'].includes(first.status)
        )
          throw new DomainError('CONFLICT', '请先确认有效图片关键帧')
        if (c.endFrameVersionId) {
          const end = this.visual.version(p, c.endFrameVersionId)
          if (end.mimeType === 'video/mp4' || end.status !== 'approved')
            throw new DomainError('CONFLICT', '尾帧须为已批准图片')
        }
        const prompt = compileShotVideoPrompt(
          shot,
          entities,
          profile,
          this.visual.repo.database.get(p).aspectRatio,
          c.duration,
          c.endFrameVersionId,
        )
        if (c.actionOverride !== null) prompt.action = c.actionOverride
        if (c.operation === 'video.compile') return prompt
        if (profile.provider === 'seedance' && !c.costAccepted)
          throw new DomainError('CONFLICT', '请确认可能产生费用后再提交')
        if (
          profile.provider === 'seedance' &&
          (!profile.credentialRef ||
            !(await this.credentials.has(profile.credentialRef)))
        )
          throw new DomainError('CONFLICT', '请先配置安全凭据')
        if (!profile.capabilities.resolutions.includes(c.resolution))
          throw new DomainError('CONFLICT', '不支持该分辨率')
        const request = videoRequestSchema.parse({
          provider: profile.provider,
          profile,
          prompt,
          resolution: c.resolution,
          seed: c.seed,
          referenceVersionIds: [
            prompt.startFrameAssetVersionId,
            ...(c.endFrameVersionId ? [c.endFrameVersionId] : []),
          ],
          providerOptions: {},
        })
        return this.visual.repo.database.transaction(() => {
          const asset = c.assetId
            ? this.visual.asset(p, c.assetId)
            : this.visual.repo.database.insertEntities(p, [
                {
                  ...metadata(),
                  projectId: p,
                  kind: 'asset',
                  name: (shot.name + ' · 视频').slice(0, 120),
                  description: '',
                  mediaType: 'video',
                  uri: null,
                  status: 'placeholder',
                  source: null,
                  previousVersionId: null,
                },
              ])[0]!
          if (asset.kind !== 'asset' || asset.mediaType !== 'video')
            throw new DomainError('CONFLICT', '视频版本须属于视频资产')
          const task = this.queue.start(p, {
            type: 'shot-video',
            targetId: shot.id,
            assetId: asset.id,
            request,
          })
          return this.visual.repo.putTask({
            ...task,
            costMetadata: costSchema.parse({
              provider: profile.provider,
              model: profile.model,
              duration: c.duration,
              resolution: c.resolution,
            }),
          })
        })
      }
      case 'video.import': {
        const path = await this.picker.video()
        if (!path) return null
        if ((await stat(path)).size > 256 * 1024 * 1024)
          throw new DomainError('INVALID_INPUT', '视频超过 256 MB')
        const assetId = randomUUID()
        const stored = await this.visual.storage.storeVideo(
          p,
          assetId,
          await readFile(path),
        )
        const existing = this.visual
          .versions(p)
          .find((v) => v.hash === stored.hash)
        if (existing) return existing
        return this.visual.repo.database.transaction(() => {
          this.visual.repo.database.insertEntities(p, [
            {
              ...metadata(),
              id: assetId,
              projectId: p,
              kind: 'asset',
              name: basename(path).slice(0, 120),
              description: '',
              mediaType: 'video',
              uri: null,
              status: 'placeholder',
              source: null,
              previousVersionId: null,
            },
          ])
          return this.visual.commitVersion(p, assetId, stored, {
            sourceType: 'imported',
            provider: null,
            model: null,
            prompt: '',
            negativePrompt: '',
            generationTaskId: null,
            sourceAssetIds: [],
            metadata: {},
          })
        })
      }
    }
  }
}
