import { jobSchema } from '../../../src/shared/operations.js'
import type { QCJob } from '../../../src/shared/operations.js'
import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import { metadata, DomainError } from '../database.js'
import type { Shot } from '../../../src/shared/domain.js'
import { aiTaskSchema } from '../../../src/shared/intelligence.js'
import { batchSchema, videoPromptSchema } from '../../../src/shared/video.js'
import {
  continuitySnapshotSchema,
  qcReportSchema,
  qcOutputSchema,
  productionSettingsSchema,
  defaultProductionSettings,
  batchPreviewSchema,
  regenerationPlanSchema,
  pilotSnapshotSchema,
} from '../../../src/shared/production.js'
import type {
  PilotCommand,
  PilotResult,
  ProductionSettings,
  BatchPreview,
  CostLine,
} from '../../../src/shared/production.js'
import type { ProductionService } from '../video/service.js'
import type { AITaskQueue } from '../intelligence/queue.js'
import { readContinuity, resolveContinuity, fingerprint } from './continuity.js'
import {
  capabilityMatrix,
  routeGeneration,
  estimate,
  aggregateCost,
} from './router.js'
import { productionCosts, deriveShotStatus } from './status.js'
import { MockMediaQCProvider, planRegeneration } from './qc.js'
import type { MediaQCProvider } from './qc.js'
export class ProductionIntelligenceService {
  readonly qcControllers = new Map<string, AbortController>()
  readonly production: ProductionService
  readonly queue: AITaskQueue
  private saveManifest: () => Promise<string | null>
  private qc: MediaQCProvider
  constructor(
    production: ProductionService,
    queue: AITaskQueue,
    saveManifest: () => Promise<string | null>,
    qc: MediaQCProvider = new MockMediaQCProvider(),
  ) {
    this.production = production
    this.queue = queue
    this.saveManifest = saveManifest
    this.qc = qc
    this.db.connection.exec(
      "UPDATE qc_jobs SET data=json_set(data,'$.status','failed','$.error','应用关闭导致 QC 中断，请重试') WHERE json_extract(data,'$.status') IN ('queued','running')",
    )
  }
  saveJob(job: QCJob) {
    this.db.connection
      .prepare(
        'INSERT INTO qc_jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(job.id, job.projectId, JSON.stringify(jobSchema.parse(job)))
  }
  get visual() {
    return this.production.visual
  }
  get repo() {
    return this.visual.repo
  }
  get db() {
    return this.repo.database
  }
  list<T>(
    table: 'qc_reports' | 'production_previews' | 'regeneration_plans',
    p: string,
    schema: z.ZodType<T>,
  ) {
    return this.db.connection
      .prepare(`SELECT data FROM ${table} WHERE project_id=? ORDER BY rowid`)
      .all(p)
      .map((r) => schema.parse(JSON.parse(String(r.data))))
  }
  settings(p: string): ProductionSettings {
    const row = this.db.connection
      .prepare('SELECT data FROM production_preferences WHERE project_id=?')
      .get(p)
    return row
      ? productionSettingsSchema.parse(JSON.parse(String(row.data)))
      : defaultProductionSettings
  }
  shot(p: string, id: string): Shot {
    const e = this.repo.entity(p, id)
    if (e.kind !== 'shot') throw new DomainError('CONFLICT', '请选择 Shot')
    return e
  }
  context(p: string, id: string) {
    return resolveContinuity(
      this.shot(p, id),
      this.db.workspace(p).entities,
      readContinuity(this.db, p),
    )
  }
  reports(p: string) {
    return this.list('qc_reports', p, qcReportSchema)
  }
  putPreview(b: BatchPreview) {
    this.db.connection
      .prepare(
        'INSERT INTO production_previews VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(b.id, b.projectId, JSON.stringify(batchPreviewSchema.parse(b)))
    return b
  }
  async matrix(p: string) {
    const snapshot = await this.production.execute({
      operation: 'snapshot',
      projectId: p,
    })
    const profileData = z
      .object({ credentials: z.record(z.string(), z.boolean()) })
      .parse(snapshot)
    return capabilityMatrix(
      this.production.profiles(p),
      profileData.credentials,
      this.settings(p),
    )
  }
  signature(p: string, shotId: string, profileId: string) {
    const s = this.shot(p, shotId)
    return fingerprint({
      context: this.context(p, shotId),
      direction: s.direction,
      duration: s.durationSeconds,
      keyframe: s.approvedKeyframeVersionId,
      profile: this.production.profile(p, profileId),
      settings: this.settings(p),
    })
  }
  async snapshot(p: string) {
    const entities = this.db.workspace(p).entities,
      versions = this.visual.versions(p),
      tasks = this.repo.list(p, 'ai_tasks', aiTaskSchema),
      reports = this.reports(p),
      settings = this.settings(p),
      costLines = productionCosts(entities, tasks, reports)
    const continuity = readContinuity(this.db, p)
    const statuses = entities
      .filter((e): e is Shot => e.kind === 'shot')
      .map((s) =>
        deriveShotStatus(
          s,
          entities,
          versions,
          tasks,
          reports,
          settings,
          resolveContinuity(s, entities, continuity).fingerprint,
          costLines,
        ),
      )
    const summarize = (kind: 'episode' | 'scene') =>
      entities
        .filter((e) => e.kind === kind)
        .map((e) => {
          const rows = statuses.filter((s) =>
            kind === 'episode' ? s.episodeId === e.id : s.sceneId === e.id,
          )
          return {
            id: e.id,
            name: e.name,
            total: rows.length,
            complete: rows.filter((s) => s.complete).length,
            keyframes: rows.filter((s) => s.keyframe === 'confirmed').length,
            videos: rows.filter((s) => s.video === 'confirmed').length,
            qcPassed: rows.filter((s) => s.qc === 'passed').length,
            review: rows.filter(
              (s) =>
                s.keyframe === 'review' ||
                s.video === 'review' ||
                s.qc === 'pending',
            ).length,
            warnings: rows.filter((s) => ['warning', 'stale'].includes(s.qc))
              .length,
            failed: rows.reduce((n, s) => n + s.failedTasks.length, 0),
            cost: aggregateCost(
              costLines.filter((l) =>
                kind === 'episode' ? l.episodeId === e.id : l.sceneId === e.id,
              ),
            ),
          }
        })
    return pilotSnapshotSchema.parse({
      continuity,
      reports,
      settings,
      statuses,
      episodes: summarize('episode'),
      scenes: summarize('scene'),
      projectCost: aggregateCost(costLines),
      categoryCosts: {
        image: aggregateCost(costLines.filter((l) => l.kind === 'image')),
        video: aggregateCost(costLines.filter((l) => l.kind === 'video')),
        qc: aggregateCost(costLines.filter((l) => l.kind === 'qc')),
      },
      costLines,
      capabilities: await this.matrix(p),
      batches: (
        (await this.production.execute({
          operation: 'snapshot',
          projectId: p,
        })) as { batches: unknown }
      ).batches,
      previews: this.list('production_previews', p, batchPreviewSchema),
      plans: this.list('regeneration_plans', p, regenerationPlanSchema),
    })
  }
  async execute(c: PilotCommand): Promise<PilotResult> {
    const p = c.projectId
    this.db.get(p)
    switch (c.operation) {
      case 'snapshot':
        return this.snapshot(p)
      case 'continuity.resolve':
        return this.context(p, c.shotId)
      case 'settings.save': {
        if (c.settings.revision !== this.settings(p).revision)
          throw new DomainError('CONFLICT', '生产设置已更新')
        if (c.settings.preferredProfileId)
          this.production.profile(p, c.settings.preferredProfileId)
        for (const r of c.settings.rates)
          this.production.profile(p, r.profileId)
        this.db.connection
          .prepare(
            'INSERT INTO production_preferences VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data',
          )
          .run(
            p,
            JSON.stringify({
              ...c.settings,
              revision: c.settings.revision + 1,
            }),
          )
        return null
      }
      case 'continuity.save': {
        const target = this.repo.entity(p, c.targetId)
        if (!['shot', 'scene'].includes(target.kind))
          throw new DomainError('CONFLICT', '连续性只能绑定场次或镜头')
        const requireKind = (id: string, kind: string) => {
          if (this.repo.entity(p, id).kind !== kind)
            throw new DomainError('CONFLICT', '连续性引用类型错误')
        }
        for (const s of c.state.characters) {
          requireKind(s.characterId, 'character')
          s.carriedProps.forEach((id) => requireKind(id, 'prop'))
        }
        for (const s of c.state.props) {
          requireKind(s.propId, 'prop')
          if (s.holderCharacterId) requireKind(s.holderCharacterId, 'character')
        }
        for (const s of c.state.locations) requireKind(s.locationId, 'location')
        for (const list of [
          c.state.characters.map((s) => s.characterId),
          c.state.props.map((s) => s.propId),
          c.state.locations.map((s) => s.locationId),
        ])
          if (new Set(list).size !== list.length)
            throw new DomainError('CONFLICT', '连续性主体重复')
        const old = readContinuity(this.db, p).find(
          (s) => s.targetId === c.targetId,
        )
        if ((old?.revision ?? 0) !== c.expectedRevision)
          throw new DomainError('CONFLICT', '连续性已更新，请重新读取')
        const saved = continuitySnapshotSchema.parse({
          ...old,
          ...(!old ? metadata() : {}),
          projectId: p,
          targetId: c.targetId,
          source: c.source,
          state: c.state,
          revision: (old?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        })
        this.db.connection
          .prepare(
            'INSERT INTO continuity_snapshots VALUES (?,?,?,?) ON CONFLICT(project_id,target_id) DO UPDATE SET data=excluded.data',
          )
          .run(saved.id, p, c.targetId, JSON.stringify(saved))
        return saved
      }
      case 'qc.run': {
        const controller = new AbortController()
        const job: QCJob = {
          ...metadata(),
          projectId: p,
          shotId: c.shotId,
          versionId: c.versionId,
          status: 'running',
          error: null,
          provider: this.qc.id,
          reportId: null,
        }
        this.saveJob(job)
        this.qcControllers.set(job.id, controller)
        try {
          const shot = this.shot(p, c.shotId),
            version = this.visual.version(p, c.versionId)
          if (
            version.metadata.targetId !== shot.id &&
            !shot.assetIds.includes(version.assetId)
          )
            throw new DomainError('CONFLICT', '版本不属于该镜头')
          const context = this.context(p, shot.id),
            output = qcOutputSchema.parse(
              await this.qc.evaluate(
                {
                  version,
                  shot,
                  approvedKeyframe: shot.approvedKeyframeVersionId
                    ? this.visual.version(p, shot.approvedKeyframeVersionId)
                    : null,
                  references: this.db
                    .workspace(p)
                    .entities.filter(
                      (e) =>
                        shot.characterIds.includes(e.id) ||
                        shot.propIds.includes(e.id) ||
                        e.id === shot.locationId,
                    ),
                  continuity: context,
                  media: await this.visual.storage.read(version.storageKey),
                },
                controller.signal,
              ),
            )
          controller.signal.throwIfAborted()
          if (this.context(p, shot.id).fingerprint !== context.fingerprint)
            throw new DomainError('CONFLICT', 'QC 期间连续性已变更，请重新运行')
          const report = qcReportSchema.parse({
            ...metadata(),
            projectId: p,
            shotId: shot.id,
            versionId: version.id,
            provider: this.qc.id,
            contextFingerprint: context.fingerprint,
            status: 'pending',
            output,
          })
          this.db.connection
            .prepare('INSERT INTO qc_reports VALUES (?,?,?,?,?)')
            .run(report.id, p, shot.id, version.id, JSON.stringify(report))
          this.saveJob({
            ...job,
            status: 'succeeded',
            updatedAt: new Date().toISOString(),
            reportId: report.id,
          })
          return report
        } catch (error) {
          this.saveJob({
            ...job,
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            updatedAt: new Date().toISOString(),
            error: 'QC 未完成，请检查素材、连续性状态后重试',
          })
          throw error
        } finally {
          this.qcControllers.delete(job.id)
        }
      }
      case 'qc.review': {
        const report = this.reports(p).find((r) => r.id === c.id)
        if (!report) throw new DomainError('NOT_FOUND', '报告不存在')
        this.repo.checkRevision(report.revision, c.expectedRevision)
        if (
          report.contextFingerprint !==
          this.context(p, report.shotId).fingerprint
        )
          throw new DomainError('CONFLICT', '报告已过期，请重新 QC')
        return this.db.transaction(() => {
          if (c.decision === 'rejected') {
            const v = this.visual.version(p, report.versionId)
            this.visual.review(p, v.id, v.revision, 'rejected', null, null)
          }
          const updated = {
            ...report,
            status: c.decision,
            revision: report.revision + 1,
            updatedAt: new Date().toISOString(),
          }
          this.db.connection
            .prepare('UPDATE qc_reports SET data=? WHERE id=?')
            .run(JSON.stringify(updated), report.id)
          return updated
        })
      }
      case 'batch.preview': {
        const settings = this.settings(p),
          rows = await this.matrix(p)
        const items: BatchPreview['items'] = []
        for (const shotId of [...new Set(c.shotIds)]) {
          try {
            const shot = this.shot(p, shotId),
              route = routeGeneration(
                shot,
                rows,
                settings,
                this.db.get(p).aspectRatio,
                c.profileId,
              ),
              profileId = c.profileId ?? route.recommendedId
            if (!profileId) throw new DomainError('CONFLICT', route.reason)
            const row = rows.find((r) => r.profile.id === profileId)
            if (!row?.available)
              throw new DomainError('CONFLICT', 'Profile 不可用')
            if (
              !row.profile.capabilities.resolutions.includes(
                settings.resolution,
              )
            )
              throw new DomainError('CONFLICT', '分辨率不支持')
            const prompt = videoPromptSchema.parse(
              await this.production.execute({
                operation: 'video.compile',
                projectId: p,
                shotId,
                profileId,
                assetId: null,
                duration: Math.round(shot.durationSeconds),
                resolution: settings.resolution,
                seed: 42,
                endFrameVersionId: null,
                actionOverride: null,
                costAccepted: false,
              }),
            )
            items.push({
              shotId,
              profileId,
              prompt,
              resolution: settings.resolution,
              reason: route.reason,
              error: null,
              ...estimate(row, prompt.duration),
              fingerprint: this.signature(p, shotId, profileId),
            })
          } catch (e) {
            items.push({
              shotId,
              profileId: null,
              prompt: null,
              resolution: settings.resolution,
              reason: '',
              error: e instanceof DomainError ? e.message : '无法编译该镜头',
              estimatedMin: null,
              estimatedMax: null,
              currency: null,
              fingerprint: '',
            })
          }
        }
        const lines: CostLine[] = items.map((i) => ({
          id: i.shotId,
          taskId: null,
          versionId: null,
          shotId: i.shotId,
          sceneId: null,
          episodeId: null,
          kind: 'video',
          estimatedMin: i.estimatedMin,
          estimatedMax: i.estimatedMax,
          actual: null,
          currency: i.currency,
        }))
        return this.putPreview({
          ...metadata(),
          projectId: p,
          items,
          cost: aggregateCost(lines),
          submittedGroupId: null,
        })
      }
      case 'batch.confirm': {
        const b = this.list('production_previews', p, batchPreviewSchema).find(
          (b) => b.id === c.id,
        )
        if (!b) throw new DomainError('NOT_FOUND', '预览不存在')
        if (b.submittedGroupId) return '该预览已提交，不会重复创建任务'
        this.repo.checkRevision(b.revision, c.expectedRevision)
        for (const i of b.items.filter((i) => !i.error && i.profileId)) {
          if (this.signature(p, i.shotId, i.profileId!) !== i.fingerprint)
            throw new DomainError(
              'CONFLICT',
              '预览后生产数据已变化，请重新编译',
            )
          if (
            this.production.profile(p, i.profileId!).provider !==
              'mock-video' &&
            !c.costAccepted
          )
            throw new DomainError('CONFLICT', '批量付费任务需要明确费用确认')
        }
        const groupMeta = metadata()
        let group = batchSchema.parse({
          id: groupMeta.id,
          createdAt: groupMeta.createdAt,
          updatedAt: groupMeta.updatedAt,
          projectId: p,
          name: '视频批次 ' + new Date().toLocaleString('zh-CN'),
          kind: 'video',
          status: 'active',
          entries: b.items.map((i) => ({
            shotId: i.shotId,
            taskId: null,
            error: i.error ?? '提交准备中；若应用中断，请重新预览未提交镜头',
          })),
        })
        this.db.transaction(() => {
          this.db.connection
            .prepare('INSERT INTO production_batches VALUES (?,?,?)')
            .run(group.id, p, JSON.stringify(group))
          this.putPreview({
            ...b,
            submittedGroupId: group.id,
            revision: b.revision + 1,
          })
        })
        for (const i of b.items.filter(
          (i) => !i.error && i.profileId && i.prompt,
        )) {
          let taskId: string | null = null,
            error: string | null = null
          try {
            const t = aiTaskSchema.parse(
              await this.production.execute({
                operation: 'video.generate',
                projectId: p,
                shotId: i.shotId,
                profileId: i.profileId!,
                assetId: null,
                duration: i.prompt!.duration,
                resolution: i.resolution,
                seed: 42,
                endFrameVersionId: null,
                actionOverride: i.prompt!.action,
                costAccepted: c.costAccepted,
              }),
            )
            taskId = t.id
            this.repo.putTask({
              ...t,
              costMetadata: {
                ...t.costMetadata,
                currency: i.currency,
                estimatedCost: i.estimatedMax,
                billingMetadata: {
                  ...t.costMetadata.billingMetadata,
                  estimateRange: { min: i.estimatedMin, max: i.estimatedMax },
                },
              },
            })
          } catch (e) {
            error = e instanceof DomainError ? e.message : '任务准备失败'
          }
          group = {
            ...group,
            entries: group.entries.map((e) =>
              e.shotId === i.shotId ? { shotId: i.shotId, taskId, error } : e,
            ),
            updatedAt: new Date().toISOString(),
          }
          this.db.connection
            .prepare('UPDATE production_batches SET data=? WHERE id=?')
            .run(JSON.stringify(group), group.id)
        }
        return '批量任务已提交，所有结果仍需人工审核'
      }
      case 'batch.cancel': {
        const row = this.db.connection
          .prepare(
            'SELECT data FROM production_batches WHERE id=? AND project_id=?',
          )
          .get(c.id, p)
        if (!row) throw new DomainError('NOT_FOUND', '批次不存在')
        for (const e of batchSchema.parse(JSON.parse(String(row.data))).entries)
          if (e.taskId) this.queue.cancel(p, e.taskId)
        return '等待项已取消；运行项按 Provider 能力尽力取消，不能保证停止计费'
      }
      case 'tasks.retry': {
        let restarted = 0,
          skipped = 0
        for (const id of c.taskIds) {
          try {
            const t = this.repo.task(p, id)
            if (t.status === 'failed') {
              this.queue.retry(p, id)
              restarted++
            } else skipped++
          } catch {
            skipped++
          }
        }
        return `已重试 ${restarted} 项，跳过 ${skipped} 项；保持已有远端 ID`
      }
      case 'regeneration.plan': {
        const report = this.reports(p).find((r) => r.id === c.reportId)
        if (!report) throw new DomainError('NOT_FOUND', '报告不存在')
        const plan = regenerationPlanSchema.parse({
          ...metadata(),
          projectId: p,
          reportId: report.id,
          shotId: report.shotId,
          versionId: report.versionId,
          ...planRegeneration(report),
          alternateProfileId: null,
          submittedTaskId: null,
          requestFingerprint: this.context(p, report.shotId).fingerprint,
        })
        this.db.connection
          .prepare('INSERT INTO regeneration_plans VALUES (?,?,?)')
          .run(plan.id, p, JSON.stringify(plan))
        return plan
      }
      case 'regeneration.confirm': {
        const plan = this.list(
          'regeneration_plans',
          p,
          regenerationPlanSchema,
        ).find((v) => v.id === c.id)
        if (!plan) throw new DomainError('NOT_FOUND', '重生计划不存在')
        if (plan.executionState !== 'ready' || plan.submittedTaskId)
          return '该计划已开始执行，不重复提交；请检查任务列表'
        this.repo.checkRevision(plan.revision, c.expectedRevision)
        if (
          plan.requestFingerprint !== this.context(p, plan.shotId).fingerprint
        )
          throw new DomainError('CONFLICT', '连续性已更新，请重新规划')
        const v = this.visual.version(p, plan.versionId)
        if (v.mimeType === 'video/mp4') {
          const original = v.generationTaskId
            ? this.repo.task(p, v.generationTaskId)
            : null
          if (
            original?.input.type === 'shot-video' &&
            original.input.request.provider !== 'mock-video' &&
            !c.costAccepted
          )
            throw new DomainError('CONFLICT', '请确认费用后执行重生')
        }
        this.db.connection
          .prepare('UPDATE regeneration_plans SET data=? WHERE id=?')
          .run(
            JSON.stringify({ ...plan, executionState: 'submitting' }),
            plan.id,
          )
        let result: unknown
        if (v.mimeType === 'video/mp4') {
          const old = v.generationTaskId
            ? this.repo.task(p, v.generationTaskId)
            : null
          if (old?.input.type !== 'shot-video')
            throw new DomainError(
              'CONFLICT',
              '导入视频请在批量预览选择 Provider 后重新生成',
            )
          const r = old.input.request
          result = await this.production.execute({
            operation: 'video.generate',
            projectId: p,
            shotId: plan.shotId,
            profileId: plan.alternateProfileId ?? r.profile.id,
            assetId: v.assetId,
            duration: Math.round(this.shot(p, plan.shotId).durationSeconds),
            resolution: r.resolution,
            seed: plan.newSeed ? (r.seed + 1) % 2147483647 : r.seed,
            endFrameVersionId: r.prompt.optionalEndFrameAssetVersionId,
            actionOverride:
              r.prompt.action + '\n' + plan.instructions.join('\n'),
            costAccepted: c.costAccepted,
          })
        } else {
          result = await this.production.generateImage(
            p,
            plan.shotId,
            v.assetId,
            plan.instructions.join('\n'),
            plan.newSeed,
          )
        }
        const task = aiTaskSchema.parse(result)
        this.db.connection
          .prepare('UPDATE regeneration_plans SET data=? WHERE id=?')
          .run(
            JSON.stringify({
              ...plan,
              executionState: 'submitted',
              submittedTaskId: task.id,
              revision: plan.revision + 1,
            }),
            plan.id,
          )
        return '重生任务已创建一次，结果需重新审核'
      }
      case 'manifest.export': {
        const episode = this.repo.entity(p, c.episodeId)
        if (episode.kind !== 'episode')
          throw new DomainError('CONFLICT', '请选择分集')
        const snapshot = await this.snapshot(p),
          entities = this.db.workspace(p).entities
        const shots = entities
          .filter(
            (e): e is Shot =>
              e.kind === 'shot' &&
              snapshot.statuses.some(
                (s) => s.shotId === e.id && s.episodeId === episode.id,
              ),
          )
          .sort((a, b) => {
            const sa = entities.find((e) => e.id === a.sceneId),
              sb = entities.find((e) => e.id === b.sceneId)
            return (
              (sa?.kind === 'scene' ? sa.order : 0) -
                (sb?.kind === 'scene' ? sb.order : 0) || a.order - b.order
            )
          })
        const manifest = {
          schemaVersion: 1,
          project: this.db.get(p).name,
          episode: episode.name,
          generatedAt: new Date().toISOString(),
          shots: shots.map((shot) => {
            const v = shot.confirmedVideoAssetVersionId
              ? this.visual.version(p, shot.confirmedVideoAssetVersionId)
              : null
            return {
              episode: episode.name,
              scene: entities.find((e) => e.id === shot.sceneId)?.name,
              shotId: shot.id,
              shotNumber: shot.plan?.shotNumber ?? shot.order + 1,
              duration: v?.duration ?? shot.durationSeconds,
              confirmedVideoAssetVersionId: v?.id ?? null,
              media: v
                ? {
                    scheme: 'director-media',
                    reference: v.storageKey,
                    hash: v.hash,
                  }
                : null,
              characters: entities
                .filter((e) => shot.characterIds.includes(e.id))
                .map((e) => e.name),
              location:
                entities.find((e) => e.id === shot.locationId)?.name ?? null,
              promptVersion: v?.promptVersion ?? null,
              provider: v?.provider ?? null,
              cost: v?.cost ?? null,
              qcStatus: snapshot.statuses.find((s) => s.shotId === shot.id)?.qc,
              productionComplete: snapshot.statuses.find(
                (s) => s.shotId === shot.id,
              )?.complete,
            }
          }),
        }
        const path = await this.saveManifest()
        if (!path) return null
        await writeFile(path, JSON.stringify(manifest, null, 2), 'utf8')
        return 'Production Manifest 已导出（仅确认版本引用，无剪辑或编码）'
      }
    }
  }
}
