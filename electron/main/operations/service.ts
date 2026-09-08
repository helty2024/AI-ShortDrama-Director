import { fingerprint } from '../production/continuity.js'
import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import { metadata, DomainError } from '../database.js'
import type { ProductionIntelligenceService } from '../production/service.js'
import { buildSeed } from '../seed.js'
import { runMediaTool } from '../video/ffmpeg.js'
import { diagnoseComfy } from '../visual/diagnostics.js'
import { aiTaskSchema } from '../../../src/shared/intelligence.js'
import {
  productionSnapshotSchema,
  videoPromptSchema,
} from '../../../src/shared/video.js'
import {
  operationsSnapshotSchema,
  validationRecordSchema,
  jobSchema,
} from '../../../src/shared/operations.js'
import type {
  OperationsCommand,
  ValidationRecord,
} from '../../../src/shared/operations.js'
import { backupProject, restoreProject } from './backup.js'
export interface OperationsHost {
  version: string
  platform: string
  build: string
  directory: (title: string) => Promise<string | null>
  save: () => Promise<string | null>
  restart: () => void
}
export function explainError(code: string) {
  if (/CREDENTIAL|AUTH|401|403/.test(code))
    return {
      reason: '服务凭据未配置或失效',
      fix: '打开设置，重新导入凭据并检查模型权限',
    }
  if (/DOWNLOAD|NETWORK|PROVIDER/.test(code))
    return {
      reason: '生成服务或结果下载不可用',
      fix: '检查服务地址、网络和任务状态；有远程 ID 时重试会恢复结果获取',
    }
  if (/TIMEOUT/.test(code))
    return {
      reason: '等待服务超时',
      fix: '检查服务队列后重试；不要重复创建远程任务',
    }
  if (/CANCEL/.test(code))
    return { reason: '任务已取消', fix: '确认仍需生成后重试' }
  return {
    reason: '任务未完成',
    fix: '检查输入素材、工作流节点与 FFmpeg，修正后重试',
  }
}
export class OperationsService {
  readonly pilot: ProductionIntelligenceService
  private host: OperationsHost
  private readonly sessionId = metadata().id
  private busy = false
  private environmentErrors: string[] = []
  constructor(pilot: ProductionIntelligenceService, host: OperationsHost) {
    this.pilot = pilot
    this.host = host
  }
  get db() {
    return this.pilot.db
  }
  records(p: string) {
    return this.db.connection
      .prepare(
        'SELECT data FROM validation_records WHERE project_id=? ORDER BY rowid DESC LIMIT 100',
      )
      .all(p)
      .map((r) => validationRecordSchema.parse(JSON.parse(String(r.data))))
  }
  record(record: ValidationRecord) {
    this.db.connection
      .prepare(
        'INSERT INTO validation_records VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(
        record.id,
        record.projectId,
        JSON.stringify(validationRecordSchema.parse(record)),
      )
    return record
  }
  async about() {
    const tools = await Promise.all(
      ['ffmpeg', 'ffprobe'].map(async (tool) => {
        try {
          const r = await runMediaTool(tool as 'ffmpeg' | 'ffprobe', [
            '-version',
          ])
          return r.stdout.split(/\r?\n/)[0]?.slice(0, 180) ?? 'available'
        } catch {
          return 'Not available — 请安装 FFmpeg 并加入 PATH'
        }
      }),
    )
    this.environmentErrors = tools.filter((t) => t.startsWith('Not available'))
    return {
      version: this.host.version,
      platform: this.host.platform,
      build: this.host.build,
      schema: Number(
        this.db.connection.prepare('PRAGMA user_version').get()?.user_version,
      ),
      ffmpeg: tools[0]!,
      ffprobe: tools[1]!,
    }
  }
  async snapshot(p: string, page: number) {
    const pilot = await this.pilot.snapshot(p),
      entities = this.db.workspace(p).entities
    const all = this.pilot.repo.list(p, 'ai_tasks', aiTaskSchema)
    const versions = this.pilot.visual.versions(p)
    // SQLite compound SELECT ordering uses a projected sort key.
    const rows = this.db.connection
      .prepare(
        `SELECT data,kind FROM (SELECT data,'ai' kind,json_extract(data,'$.createdAt') created FROM ai_tasks WHERE project_id=? UNION ALL SELECT data,'qc' kind,json_extract(data,'$.createdAt') created FROM qc_jobs WHERE project_id=?) ORDER BY created DESC LIMIT 50 OFFSET ?`,
      )
      .all(p, p, page * 50)
    const tasks = rows.map((r) => {
      if (r.kind === 'qc') {
        const j = jobSchema.parse(JSON.parse(String(r.data)))
        return {
          id: j.id,
          kind: 'qc',
          target: entities.find((e) => e.id === j.shotId)?.name ?? j.shotId,
          provider: j.provider,
          status: j.status,
          progress: j.status === 'succeeded' ? 1 : 0,
          elapsed: Math.max(
            0,
            ((['running', 'queued'].includes(j.status)
              ? Date.now()
              : Date.parse(j.updatedAt)) -
              Date.parse(j.createdAt)) /
              1000,
          ),
          cost: 'LOCAL 0',
          error: j.error,
          remoteId: null,
        }
      }
      const t = aiTaskSchema.parse(JSON.parse(String(r.data)))
      return {
        id: t.id,
        kind: t.input.type,
        target:
          'targetId' in t.input
            ? (entities.find(
                (e) => e.id === ('targetId' in t.input ? t.input.targetId : ''),
              )?.name ?? t.input.targetId)
            : '剧本导入',
        provider: t.provider ?? 'text',
        status: t.status,
        progress: t.progress,
        elapsed: Math.max(
          0,
          ((t.completedAt ? Date.parse(t.completedAt) : Date.now()) -
            Date.parse(t.startedAt ?? t.createdAt)) /
            1000,
        ),
        cost: ['mock-image', 'mock-video'].includes(t.provider ?? '')
          ? 'LOCAL 0'
          : t.costMetadata.estimatedCost === null
            ? '未知'
            : `${t.costMetadata.currency ?? ''} ${t.costMetadata.estimatedCost}`,
        error: t.error ? explainError(t.error.code).reason : null,
        remoteId: t.providerTaskId,
      }
    })
    const jobs = this.db.connection
      .prepare('SELECT data FROM qc_jobs WHERE project_id=?')
      .all(p)
      .map((r) => jobSchema.parse(JSON.parse(String(r.data))))
    const errors = all
      .filter((t) => t.status === 'failed')
      .map((t) => ({
        id: t.id,
        target: 'targetId' in t.input ? t.input.targetId : '剧本',
        ...explainError(t.error?.code ?? ''),
      }))
    for (const r of pilot.capabilities.filter((r) => !r.available))
      errors.push({
        id: r.profile.id,
        target: r.profile.name,
        reason: '服务凭据未配置',
        fix: '打开设置导入该服务的 API Key；恢复项目后需要重新绑定',
      })
    this.environmentErrors.forEach((reason, i) =>
      errors.push({
        id: 'environment-' + i,
        target: 'FFmpeg / FFprobe',
        reason,
        fix: '安装工具并加入 PATH，再重新检查环境',
      }),
    )
    for (const j of jobs.filter((j) => j.status === 'failed'))
      errors.push({
        id: j.id,
        target: j.shotId,
        reason: 'QC 未完成',
        fix: '检查素材可读性与连续性后重试 QC',
      })
    for (const s of pilot.statuses.filter((s) =>
      ['stale', 'warning'].includes(s.qc),
    ))
      errors.push({
        id: s.shotId,
        target: s.shotId,
        reason: s.qc === 'stale' ? '素材源或连续性已变更' : 'QC 发现问题',
        fix: '打开生产看板，检查报告，修改后重新 QC',
      })
    for (const r of this.records(p).filter(
      (r) => r.kind === 'recovery' && r.result === 'submitted',
    )) {
      const t = all.find((t) => t.id === r.details.taskId)
      if (r.details.sessionId !== this.sessionId && t?.status === 'succeeded')
        this.record({
          ...r,
          result:
            t.providerTaskId === r.details.remoteId ? 'validated' : 'failed',
          details: {
            ...r.details,
            recoveredAt: new Date().toISOString(),
            sameRemoteId: t.providerTaskId === r.details.remoteId,
            outputVersionIds: t.outputAssetVersionIds,
          },
        })
      else if (t?.status === 'failed') this.record({ ...r, result: 'failed' })
    }
    const records = this.records(p)
    for (const r of records
      .filter((r) => r.kind === 'comfy')
      .slice(0, 1)
      .filter((r) => r.result === 'failed' || r.result === 'Not validated'))
      if (r.kind === 'comfy')
        errors.push({
          id: r.id,
          target: 'ComfyUI',
          reason: 'ComfyUI 尚未通过实机验收',
          fix: '启动 ComfyUI；检查地址、checkpoint、缺失节点；重新测试连接和工作流',
        })
    const generations = new Map<string, number>()
    for (const task of all)
      if ('request' in task.input) {
        const key = task.input.type + ':' + task.input.targetId
        generations.set(key, (generations.get(key) ?? 0) + task.attempt)
      }
    const done = (kind: string) => entities.some((e) => e.kind === kind)
    const allShots = pilot.statuses.length > 0
    return operationsSnapshotSchema.parse({
      records,
      tasks,
      totalTasks: all.length + jobs.length,
      errors: errors.toReversed().slice(0, 50),
      checklist: [
        { label: '结构化剧本与 Scene', done: done('scene') },
        {
          label: 'Character / Location / Prop Bible',
          done: ['character', 'location', 'prop'].every(done),
        },
        { label: 'Shot 规划', done: allShots },
        {
          label: '全部关键帧审核',
          done:
            allShots && pilot.statuses.every((s) => s.keyframe === 'confirmed'),
        },
        {
          label: 'ComfyUI 实机链路（不包含 Mock）',
          done: records.some(
            (r) => r.kind === 'comfy' && r.result === 'validated',
          ),
        },
        {
          label: 'Seedance 实机链路（不包含 Mock）',
          done: all.some(
            (t) =>
              t.provider === 'seedance' &&
              t.status === 'succeeded' &&
              t.providerTaskId &&
              t.outputAssetVersionIds.some((id) =>
                versions.some((v) => v.id === id && v.status === 'approved'),
              ),
          ),
        },
        {
          label: '全部视频审核',
          done:
            allShots && pilot.statuses.every((s) => s.video === 'confirmed'),
        },
        {
          label: '连续性 / QC / Confirm',
          done: allShots && pilot.statuses.every((s) => s.complete),
        },
        {
          label: 'Manifest 导出',
          done: records.some(
            (r) => r.kind === 'manifest' && r.result === 'validated',
          ),
        },
      ],
      summary: {
        镜头总数: pilot.statuses.length,
        关键帧成功: pilot.statuses.filter(
          (s) => s.keyframe === 'confirmed' || s.keyframe === 'review',
        ).length,
        视频成功: pilot.statuses.filter(
          (s) => s.video === 'confirmed' || s.video === 'review',
        ).length,
        失败任务: all.filter((t) => t.status === 'failed').length,
        重新生成: [...generations.values()].reduce(
          (n, count) => n + Math.max(0, count - 1),
          0,
        ),
        生成秒数: Math.round(
          all.reduce(
            (n, t) =>
              n +
              (t.startedAt && t.completedAt
                ? Math.max(
                    0,
                    Date.parse(t.completedAt) - Date.parse(t.startedAt),
                  ) / 1000
                : 0),
            0,
          ),
        ),
        已知费用:
          pilot.projectCost.currencies
            .map((c) => `${c.currency} ${c.actual}`)
            .join(' / ') || '无',
        未知费用项: pilot.projectCost.unknownActual,
        'QC 警告': pilot.statuses.filter((s) =>
          ['warning', 'stale'].includes(s.qc),
        ).length,
        已完成: pilot.statuses.filter((s) => s.complete).length,
      },
    })
  }
  async diagnostics(p: string) {
    const about = await this.about(),
      tasks = this.pilot.repo.list(p, 'ai_tasks', aiTaskSchema)
    // Allowlist only: no raw errors, prompts, asset paths, project names or payloads.
    return {
      ...about,
      providers: this.pilot.production.profiles(p).map((v) => ({
        provider: v.provider,
        model: v.model,
        endpoint: new URL(v.baseUrl).origin,
      })),
      imageProvider: {
        provider: this.pilot.visual.settings(p).provider,
        endpoint: new URL(this.pilot.visual.settings(p).baseUrl).origin,
      },
      taskErrors: tasks
        .filter((t) => t.error)
        .map((t) => ({
          id: t.id,
          status: t.status,
          reason: explainError(t.error!.code).reason,
        })),
      workflowDiagnostics: this.records(p)
        .filter((r) => r.kind === 'comfy')
        .map((r) => ({
          testedAt: r.testedAt,
          result: r.result,
          reachable: r.details.connection,
          workflowReady: r.details.workflowReady,
          requiredNodes: r.details.requiredNodes,
          missingNodes: r.details.missingNodes,
        })),
      recentSanitizedLogs: tasks.slice(-50).map((t) => ({
        at: t.updatedAt,
        event: 'task-state',
        status: t.status,
      })),
      excluded: ['credentials', 'scripts', 'prompts', 'media', 'raw logs'],
    }
  }
  async execute(c: OperationsCommand): Promise<unknown> {
    if (c.operation === 'about') return this.about()
    if (c.operation === 'validation.create') {
      const p = this.db.create({
        name: '生产验收 · 雨夜车站',
        description: '3 镜头最小实机验收项目',
        genre: '剧情',
        aspectRatio: '9:16',
        language: 'zh-CN',
      })
      try {
        const seed = buildSeed(p.id),
          scene = seed.find((e) => e.kind === 'scene')!,
          shots = seed.filter(
            (e) => e.kind === 'shot' && e.sceneId === scene.id,
          )
        const keep = new Set(
          shots.flatMap((s) =>
            s.kind === 'shot'
              ? [
                  s.id,
                  s.sceneId,
                  s.storyboardId,
                  ...s.characterIds,
                  ...s.propIds,
                  ...s.assetIds,
                  s.locationId ?? '',
                ]
              : [],
          ),
        )
        this.db.insertEntities(
          p.id,
          seed.filter(
            (e) =>
              keep.has(e.id) || e.kind === 'script' || e.kind === 'episode',
          ),
        )
        return p
      } catch (error) {
        this.db.delete(p.id)
        throw error
      }
    }
    if (c.operation === 'restore') {
      const folder = await this.host.directory(
        '选择备份目录（恢复为新项目，凭据需重新绑定）',
      )
      if (!folder) return null
      if (this.busy) throw new DomainError('CONFLICT', '备份或恢复正在执行')
      this.busy = true
      try {
        return await restoreProject(this.pilot.visual, folder)
      } finally {
        this.busy = false
      }
    }
    const p = c.projectId
    this.db.get(p)
    switch (c.operation) {
      case 'snapshot':
        return this.snapshot(p, c.page)
      case 'backup': {
        const folder = await this.host.directory('选择备份保存目录')
        if (!folder) return null
        if (this.busy) throw new DomainError('CONFLICT', '备份或恢复正在执行')
        this.busy = true
        try {
          return await backupProject(this.pilot.visual, p, folder)
        } finally {
          this.busy = false
        }
      }
      case 'diagnostics.export': {
        const path = await this.host.save()
        if (path)
          await writeFile(
            path,
            JSON.stringify(await this.diagnostics(p), null, 2),
          )
        return path
      }
      case 'comfy.test': {
        const started = Date.now(),
          s = this.pilot.visual.settings(p),
          t = this.pilot.visual.templates(p).find((t) => t.id === s.templateId)
        if (!t) throw new DomainError('NOT_FOUND', '工作流不存在')
        const d = await diagnoseComfy({ ...s, provider: 'comfyui' }, t)
        const tasks = this.pilot.repo
          .list(p, 'ai_tasks', aiTaskSchema)
          .filter(
            (task) =>
              task.provider === 'comfyui' &&
              task.status === 'succeeded' &&
              'request' in task.input &&
              task.input.type !== 'shot-video' &&
              task.input.request.providerOptions.baseUrl === s.baseUrl &&
              fingerprint(task.input.request.providerOptions.workflow) ===
                fingerprint(t.workflow) &&
              task.input.request.providerOptions.checkpoint === s.checkpoint,
          )
        const versions = this.pilot.visual.versions(p),
          outputs = versions.filter(
            (v) =>
              v.provider === 'comfyui' &&
              tasks.some((t) => t.outputAssetVersionIds.includes(v.id)),
          )
        let saved = outputs.length > 0,
          thumb = saved
        for (const v of outputs) {
          try {
            await this.pilot.visual.storage.resolveRegisteredFile(v.storageKey)
            await this.pilot.visual.storage.resolveRegisteredFile(
              v.thumbnailPath,
            )
          } catch {
            saved = false
            thumb = false
          }
        }
        const reference = tasks.some(
          (t) =>
            'request' in t.input &&
            t.input.request.referenceVersionIds.length > 0 &&
            outputs.some(
              (v) =>
                v.generationTaskId === t.id &&
                Array.isArray(v.metadata.referenceSlots) &&
                v.metadata.referenceSlots.includes('reference_image'),
            ),
        )
        const reviewed = outputs.some((v) => v.status === 'approved'),
          imported = versions.some((v) => v.sourceType === 'imported')
        return this.record({
          id: metadata().id,
          projectId: p,
          kind: 'comfy',
          testedAt: new Date().toISOString(),
          result:
            d.ready && saved && thumb && reference && reviewed && imported
              ? 'validated'
              : d.ready
                ? 'ready'
                : 'Not validated',
          details: {
            baseUrl: new URL(s.baseUrl).origin,
            workflow: t.id,
            checkpoint: s.checkpoint,
            requiredNodes: [
              ...new Set(Object.values(t.workflow).map((n) => n.class_type)),
            ],
            connection: d.reachable,
            workflowReady: d.ready,
            missingNodes: d.missingNodes,
            imageGeneration: outputs.length > 0,
            referenceInput: reference,
            assetImport: imported,
            resultSave: saved,
            thumbnail: thumb,
            versionReview: reviewed,
            connectionCheckMs: Date.now() - started,
            executionMs: tasks.reduce(
              (n, t) =>
                n +
                (t.startedAt && t.completedAt
                  ? Math.max(
                      0,
                      Date.parse(t.completedAt) - Date.parse(t.startedAt),
                    )
                  : 0),
              0,
            ),
            outputDimensions: outputs.map((v) => `${v.width}x${v.height}`),
            error: d.ready
              ? null
              : '请启动 ComfyUI 并检查 checkpoint、节点和工作流输入；尚未完成的生成项目需实际执行后重新检测',
          },
        })
      }
      case 'paid.preview': {
        const profile = this.pilot.production.profile(p, c.profileId),
          duration = Math.min(...profile.capabilities.durations),
          resolution = (['480p', '720p', '1080p'] as const).find((r) =>
            profile.capabilities.resolutions.includes(r),
          )
        if (!resolution || !Number.isFinite(duration))
          throw new DomainError('CONFLICT', '服务没有可用于最小验收的能力')
        const input = {
          projectId: p,
          shotId: c.shotId,
          profileId: c.profileId,
          assetId: null,
          duration,
          resolution,
          seed: 42,
          endFrameVersionId: null,
          actionOverride: null,
          costAccepted: false,
        }
        const prompt = videoPromptSchema.parse(
          await this.pilot.production.execute({
            ...input,
            operation: 'video.compile',
          }),
        )
        const snapshot = productionSnapshotSchema.parse(
          await this.pilot.production.execute({
            projectId: p,
            operation: 'snapshot',
          }),
        )
        const rate = this.pilot
          .settings(p)
          .rates.find((r) => r.profileId === profile.id)
        return this.record({
          id: metadata().id,
          projectId: p,
          kind: 'paid',
          testedAt: new Date().toISOString(),
          result: 'ready',
          details: {
            input,
            provider: profile.provider,
            endpoint: profile.baseUrl + profile.taskPath,
            model: profile.model,
            duration,
            resolution,
            keyframe: prompt.startFrameAssetVersionId,
            prompt,
            estimatedCost:
              profile.provider === 'mock-video'
                ? 'LOCAL 0'
                : rate
                  ? `${rate.currency} ${rate.minPerSecond * duration}–${rate.maxPerSecond * duration}`
                  : '未知（可能产生费用）',
            estimatedMin:
              profile.provider === 'mock-video'
                ? 0
                : rate
                  ? rate.minPerSecond * duration
                  : null,
            estimatedMax:
              profile.provider === 'mock-video'
                ? 0
                : rate
                  ? rate.maxPerSecond * duration
                  : null,
            currency:
              profile.provider === 'mock-video'
                ? 'LOCAL'
                : (rate?.currency ?? null),
            credentialConfigured: snapshot.credentials[profile.id] ?? false,
            warning: '确认后会提交远程任务，可能产生不可撤回费用；仅一个镜头。',
            signature: this.pilot.signature(p, c.shotId, c.profileId),
          },
        })
      }
      case 'paid.submit': {
        const r = this.records(p).find(
          (r) => r.id === c.previewId && r.kind === 'paid',
        )
        if (!r || r.result !== 'ready')
          throw new DomainError('CONFLICT', '预览已消费，请重新预览')
        const input = z
          .object({
            projectId: z.uuid(),
            shotId: z.uuid(),
            profileId: z.uuid(),
            duration: z.number(),
            resolution: z.enum(['480p', '720p', '1080p']),
            seed: z.number(),
          })
          .parse(r.details.input)
        if (
          r.details.signature !==
          this.pilot.signature(p, input.shotId, input.profileId)
        )
          throw new DomainError('CONFLICT', '预览已过期，请重新预览并确认')
        this.record({ ...r, result: 'submitted' })
        try {
          const result = await this.pilot.production.execute({
            ...input,
            operation: 'video.generate',
            assetId: null,
            endFrameVersionId: null,
            actionOverride: null,
            costAccepted: true,
          })
          const task = aiTaskSchema.parse(result)
          this.db.connection
            .prepare(
              "UPDATE ai_tasks SET data=json_set(data,'$.costMetadata.estimatedCost',?,'$.costMetadata.currency',?,'$.costMetadata.billingMetadata.estimateRange',json(?)) WHERE project_id=? AND id=?",
            )
            .run(
              typeof r.details.estimatedMax === 'number'
                ? r.details.estimatedMax
                : null,
              typeof r.details.currency === 'string'
                ? r.details.currency
                : null,
              JSON.stringify({
                min: r.details.estimatedMin,
                max: r.details.estimatedMax,
              }),
              p,
              task.id,
            )
          return this.record({
            ...r,
            result: 'submitted',
            details: { ...r.details, taskId: task.id },
          })
        } catch (error) {
          this.record({ ...r, result: 'failed' })
          throw error
        }
      }
      case 'recovery.restart': {
        const t = this.pilot.repo.task(p, c.taskId)
        if (
          !t.providerTaskId ||
          !['running', 'queued'].includes(t.status) ||
          !['comfyui', 'seedance'].includes(t.provider ?? '')
        )
          throw new DomainError(
            'CONFLICT',
            '仅已取得远程 ID 的 ComfyUI / Seedance 运行任务可验证恢复',
          )
        this.record({
          id: metadata().id,
          projectId: p,
          kind: 'recovery',
          testedAt: new Date().toISOString(),
          result: 'submitted',
          details: {
            taskId: t.id,
            provider: t.provider,
            remoteId: t.providerTaskId,
            sessionId: this.sessionId,
            recoveryCapability:
              'poll-known-id; unknown submission cannot be safely recovered',
          },
        })
        this.host.restart()
        return null
      }
      case 'qc.cancel': {
        const row = this.db.connection
          .prepare('SELECT data FROM qc_jobs WHERE project_id=? AND id=?')
          .get(p, c.taskId)
        if (!row) throw new DomainError('NOT_FOUND', '任务不存在')
        this.pilot.qcControllers.get(c.taskId)?.abort()
        return null
      }
      case 'qc.retry': {
        const row = this.db.connection
          .prepare('SELECT data FROM qc_jobs WHERE project_id=? AND id=?')
          .get(p, c.taskId)
        if (!row) throw new DomainError('NOT_FOUND', '任务不存在')
        const job = jobSchema.parse(JSON.parse(String(row.data)))
        if (!['failed', 'cancelled'].includes(job.status))
          throw new DomainError('CONFLICT', '任务不可重试')
        return this.pilot.execute({
          operation: 'qc.run',
          projectId: p,
          shotId: job.shotId,
          versionId: job.versionId,
        })
      }
    }
  }
}
