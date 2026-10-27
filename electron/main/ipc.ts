import type { ServiceSettingsCommand } from '../../src/shared/service-settings.js'
import { SkillExperimentService, type SkillTextBinding } from './skills/experiment.js'
import { Seedance20Loader } from './skills/seedance-20.js'
import { join } from 'node:path'
import { WorkflowService } from './workflow/service.js'
import { LineageService } from './generation/lineage.js'
import { toolReadiness } from './tools/readiness.js'
import type { ImageGenerationService } from './generation/image-service.js'
import type { VideoApiGenerationService } from './generation/video-api-service.js'
import { OperationsService } from './operations/service.js'
import { app } from 'electron'
import { VideoBatchService } from './generation/video-batch.js'
import { copyFile } from 'node:fs/promises'
import { ProductionService } from './video/service.js'
import { AIError } from './intelligence/provider.js'
import { VisualService } from './visual/service.js'
import { ipcMain, dialog } from 'electron'
import { ProductionIntelligenceService } from './production/service.js'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { requestSchema } from '../../src/shared/api.js'
import type { Result } from '../../src/shared/api.js'
import { DomainError, ProjectDatabase } from './database.js'
import { buildSeed } from './seed.js'
import { IntelligenceService } from './intelligence/service.js'

declare const __DIRECTOR_BUILD__: string
export function isTrustedSender(
  event: IpcMainInvokeEvent,
  windows: Set<number>,
  expectedUrl: string,
): boolean {
  return (
    windows.has(event.sender.id) &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url === expectedUrl
  )
}
export function registerWorkspaceIPC(
  database: ProjectDatabase,
  windows: Set<number>,
  expectedUrl: string,
  allowSeed: boolean,
  intelligence: IntelligenceService,
  visual: VisualService,
  production: ProductionService,
  imageApi?: ImageGenerationService,
  videoApi?: VideoApiGenerationService,
  importImage?: () => Promise<null>,
  hasToolCredential: (toolId: string) => Promise<boolean> = async () => false,
  compshareH3?: {
    configuration: () => Promise<unknown>
    importCredential: () => Promise<null>
    probe: () => Promise<unknown>
  },
  serviceSettings?: (command: ServiceSettingsCommand) => Promise<unknown>,
  skillText: () => SkillTextBinding | null = () => null,
) {
  const skillExperiments = new SkillExperimentService(database, new Seedance20Loader(join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'skills/seedance-20' : 'resources/skills/seedance-20')), join(app.getPath('userData'), 'skill-experiments'), skillText)
  let configuringComfy = false
  let activeImageCommands = 0
  const workflows = imageApi && videoApi ? new WorkflowService(imageApi, videoApi) : null
  const videoBatches = videoApi ? new VideoBatchService(videoApi) : null
  if (videoBatches) {
    const timer = setInterval(() => { void videoBatches.tick().catch(() => { /* Batch/task records retain the actionable state. */ }) }, 2000)
    timer.unref()
    app.once('will-quit', () => clearInterval(timer))
  }
  workflows?.runner.recoverUnfinished()
  const pilot = new ProductionIntelligenceService(
    production,
    intelligence.queue,
    async (kind, filename) => {
      const r = await dialog.showSaveDialog({
        title: kind === 'storyboard' ? '导出离线分镜表' : '导出 Production Manifest',
        defaultPath: kind === 'storyboard' ? filename : 'production-manifest.json',
        filters: kind === 'storyboard' ? [{ name: '离线分镜表', extensions: ['html'] }] : [{ name: 'Production Manifest', extensions: ['json'] }],
      })
      return r.canceled ? null : (r.filePath ?? null)
    },
  )
  const operations = new OperationsService(pilot, {
    version: app.getVersion(),
    platform: process.platform,
    build: __DIRECTOR_BUILD__,
    directory: async (title) => {
      const r = await dialog.showOpenDialog({
        title,
        properties: ['openDirectory', 'createDirectory'],
      })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    save: async () => {
      const r = await dialog.showSaveDialog({
        title: '导出诊断包（不含剧本和素材）',
        defaultPath: 'director-diagnostics.json',
      })
      return r.canceled ? null : (r.filePath ?? null)
    },
    restart: () => {
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 250)
    },
  })
  ipcMain.handle(
    'workspace:request',
    async (event, raw: unknown): Promise<Result> => {
      if (!isTrustedSender(event, windows, expectedUrl))
        return { ok: false, code: 'FORBIDDEN', message: '不允许访问项目数据' }
      try {
        const request = requestSchema.parse(raw)
        switch (request.action) {
          case 'skillExperiment': return { ok: true, data: z.json().parse(await skillExperiments.execute(request.command)) }
          case 'compatibility': {
            const c = request.command, lineage = new LineageService(database)
            const data = c.op === 'lineage' ? lineage.version(c.projectId, c.versionId)
              : c.op === 'generation' ? lineage.generation(c.projectId, c.recordId)
                : await toolReadiness([...(imageApi ? [imageApi.registry] : []), ...(videoApi ? [videoApi.registry] : [])], hasToolCredential)
            return { ok: true, data: z.json().parse(data) }
          }
          case 'workflow':
            if (configuringComfy && !['getWorkflowRun', 'listWorkflowRuns'].includes(request.command.op)) throw new DomainError('CONFLICT', '正在保存图像连接，请稍候重试')
            if (!workflows) throw new DomainError('CONFLICT', '工作流服务未配置')
            return { ok: true, data: z.json().parse(workflows.execute(request.command)) }
          case 'operations':
            return {
              ok: true,
              data: z.json().parse(await operations.execute(request.command)),
            }
          case 'pilot': {
            if (configuringComfy && request.command.operation !== 'snapshot') throw new DomainError('CONFLICT','正在保存 AI 服务配置，请稍候再开始制作')
            const data = await pilot.execute(request.command)
            if (request.command.operation === 'manifest.export' && data)
              operations.record({
                id: crypto.randomUUID(),
                projectId: request.command.projectId,
                kind: 'manifest',
                testedAt: new Date().toISOString(),
                result: 'validated',
                details: {},
              })
            return { ok: true, data }
          }
          case 'production':
            return { ok: true, data: await production.execute(request.command) }
          case 'imageApi': {
            if (!imageApi) throw new DomainError('CONFLICT','Image API 未配置')
            if (configuringComfy) throw new DomainError('CONFLICT', '正在保存本机图像连接，请稍候重试')
            activeImageCommands++
            try {
            const c=request.command
            let data:unknown
            switch(c.op){
              case 'probe': data=await imageApi.probe(c.toolId);break
              case 'profiles': data=imageApi.profiles();break
              case 'importProfile': data=await importImage?.();break
              case 'preview': data=await imageApi.preview(c.input);break
              case 'confirm': data=imageApi.confirm(c.projectId,c.previewId,c.maxCostMicro,c.allowUnknownCost);break
              case 'query': data=imageApi.query(c.projectId,c.taskId);break
              case 'review': data=imageApi.review(c.projectId,c.versionId,c.revision,c.adopt,c.targetRevision);break
            }
            return {ok:true,data:z.json().parse(data??null)}
            } finally { activeImageCommands-- }
          }
          case 'videoBatch': {
            if (!videoBatches || !videoApi) throw new DomainError('CONFLICT', '视频服务未配置')
            const c = request.command
            let data: unknown
            switch (c.op) {
              case 'list': data = videoBatches.list(c.projectId); break
              case 'prepare': data = await videoBatches.prepare(c.projectId, c.shotIds, c.referenceVersionId, c.purpose); break
              case 'authorize': data = videoBatches.authorize(c.projectId, c.batchId, c.expectedRevision, c.maxPoints, c.maxCostMicro); break
              case 'pause': data = videoBatches.pause(c.projectId, c.batchId); break
              case 'resume': data = videoBatches.resume(c.projectId, c.batchId); break
              case 'rework': data = await videoBatches.rework(c.projectId, c.batchId, c.shotId); break
              case 'recoverOutput': data = await videoBatches.recoverOutput(c.projectId, c.batchId, c.shotId); break
              case 'saveTimeline': data = videoBatches.saveTimeline(c.projectId, c.batchId, c.expectedRevision, c.clips); break
              case 'export': {
                const version = await videoBatches.export(c.projectId, c.batchId)
                const save = await dialog.showSaveDialog({ title: '导出已选镜头连续成片', defaultPath: '短剧成片.mp4', filters: [{ name: 'MP4 无声视频', extensions: ['mp4'] }] })
                if (!save.canceled && save.filePath) await copyFile(await videoApi.visual.storage.resolveRegisteredFile(version.storageKey), save.filePath)
                data = version
                break
              }
            }
            return { ok: true, data: z.json().parse(data ?? null) }
          }
          case 'videoApi': {
            if (!videoApi) throw new DomainError('CONFLICT', 'Video API 未配置')
            const c = request.command
            let data: unknown
            switch (c.op) {
              case 'configuration':
                data = videoApi.configuration()
                break
              case 'profiles':
                data = videoApi.profiles()
                break
              case 'preview':
                data = await videoApi.preview(c.input)
                break
              case 'confirm':
                data = videoApi.confirm(
                  c.projectId,
                  c.previewId,
                  c.maxCostMicro,
                  c.allowUnknownCost,
                )
                break
              case 'query':
                data = await videoApi.query(c.projectId, c.taskId)
                break
              case 'cancel':
                data = await videoApi.cancel(c.projectId, c.taskId)
                break
              case 'review':
                data = videoApi.review(
                  c.projectId,
                  c.versionId,
                  c.revision,
                  c.adopt,
                  c.targetRevision,
                )
                break
            }
            return { ok: true, data: z.json().parse(data ?? null) }
          }
          case 'serviceSettings': {
            if (!serviceSettings) throw new DomainError('CONFLICT', '服务设置暂不可用')
            if (['comfy.configuration', 'ai.list', 'ai.probe', 'ai.verifyVideoDownload'].includes(request.command.op)) return { ok:true, data:z.json().parse(await serviceSettings(request.command)) }
            if (configuringComfy || activeImageCommands) throw new DomainError('CONFLICT', '图像操作正在处理中，请稍候保存连接')
            configuringComfy = true
            try { return { ok:true, data:z.json().parse(await serviceSettings(request.command)) } }
            finally { configuringComfy = false }
          }
          case 'compshareH3': {
            if (!compshareH3) throw new DomainError('CONFLICT', 'CompShare 未配置')
            const c = request.command
            const data = c.op === 'configuration' ? await compshareH3.configuration()
              : c.op === 'importCredential' ? await compshareH3.importCredential()
                : await compshareH3.probe()
            return { ok: true, data: z.json().parse(data ?? null) }
          }
          case 'visual':
            return { ok: true, data: await visual.execute(request.command) }
          case 'intelligence':
            if (configuringComfy && ['task.start','task.retry'].includes(request.command.operation)) throw new DomainError('CONFLICT','正在保存 AI 服务配置，请稍候再开始文本任务')
            return { ok: true, data: intelligence.execute(request.command) }
          case 'projects.list':
            return { ok: true, data: database.list() }
          case 'projects.create':
            return { ok: true, data: database.create(request.input) }
          case 'projects.get':
            return { ok: true, data: database.get(request.id) }
          case 'projects.open':
            return { ok: true, data: database.open(request.id) }
          case 'projects.update':
            return { ok: true, data: database.update(request.input) }
          case 'projects.delete':
            if (imageApi?.hasPending(request.id) || videoApi?.hasPending(request.id))
              throw new DomainError('CONFLICT','请等待 API 提交处理结束后删除项目')
            intelligence.queue.cancelProject(request.id)
            return { ok: true, data: database.delete(request.id) }
          case 'workspace.get':
            return { ok: true, data: database.workspace(request.id) }
          case 'entities.createDraft':
            return { ok: true, data: database.createDraft(request.input) }
          case 'projects.seed':
            if (!allowSeed)
              throw new DomainError('FORBIDDEN', '示例数据仅在开发模式可用')
            return { ok: true, data: database.seed(buildSeed) }
        }
      } catch (error) {
        if (error instanceof z.ZodError)
          return {
            ok: false,
            code: 'INVALID_INPUT',
            message: '输入格式错误，请检查字段和关联对象',
          }
        if (error instanceof AIError)
          return { ok: false, code: 'CONFLICT', message: error.message }
        if (error instanceof DomainError)
          return { ok: false, code: error.code, message: error.message }
        console.error('Workspace operation failed (details withheld)')
        return { ok: false, code: 'INTERNAL', message: '数据操作失败，请重试' }
      }
    },
  )
}
