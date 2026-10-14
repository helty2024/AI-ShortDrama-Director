import { loadComfySettings, saveComfySettings, validateComfySettings } from './generation/comfy-settings.js'
import { WorkflowRepository, terminalWorkflow } from './workflow/repository.js'
import { builtinTemplates } from './visual/workflows.js'
import { AIServiceManager } from './generation/ai-services.js'
import { PackyImage25Adapter } from './tools/adapters/packy-image-25.js'
import { ProductionPackyAdapter } from './generation/production-packy.js'
import { NativeProductionGate } from './generation/native-production.js'
import { CompShareMiniMaxH3Adapter } from './tools/adapters/compshare-minimax-h3.js'
import { ImageApiAdapter } from './tools/adapters/image-api.js'
import { ImageHttpTransport } from './tools/adapters/image-http.js'
import { ImageGenerationService } from './generation/image-service.js'
import { ComfyUIToolAdapter } from './tools/adapters/comfyui.js'
import { validateLocalComfyUrl } from './tools/adapters/comfyui-runtime.js'
import { builtinComfyProfile } from './tools/adapters/comfyui-template.js'
import { VideoApiGenerationService } from './generation/video-api-service.js'
import { VideoApiAdapter } from './tools/adapters/video-api.js'
import { compshareProfileFileName, legacyVideoProfileFileName, loadCompShareProfile, createCompShareAdapter, importCompShareCredential } from './generation/compshare-minimax-h3-profile.js'
import { loadImageProfiles, imageAdapters, importImageProfile } from './generation/image-profiles.js'
import { MediaBroker } from './media-broker.js'
import { protocol } from 'electron'
import { safeStorage } from 'electron'
import { EncryptedCredentialStore } from './video/credentials.js'
import { MockVideoProvider, SeedanceVideoProvider } from './video/providers.js'
import { VideoTaskExecutor, ProductionMediaExecutor } from './video/executor.js'
import type { VideoFactory } from './video/executor.js'
import { ProductionService } from './video/service.js'
import { MediaStorage } from './visual/storage.js'
import { VisualRepository } from './visual/repository.js'
import { VisualService } from './visual/service.js'
import { ImageTaskExecutor } from './visual/executor.js'
import { app, BrowserWindow, session, dialog } from 'electron'
import { IntelligenceRepository } from './intelligence/repository.js'
import { AITaskQueue } from './intelligence/queue.js'
import { MockTextProvider } from './intelligence/mock-provider.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import { IntelligenceService } from './intelligence/service.js'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { DomainError, ProjectDatabase } from './database.js'
import { registerWorkspaceIPC } from './ipc.js'
import { isolatedUserData } from './release-validation.js'
import { alphaVersion } from '../../src/shared/alpha.js'
import { startAlphaReferenceRuntime } from './alpha/reference-runtime.js'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'director-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
])
const directory = dirname(fileURLToPath(import.meta.url))
const windows = new Set<number>()
let database: ProjectDatabase | undefined
let queue: AITaskQueue | undefined
let alphaRuntime: Awaited<ReturnType<typeof startAlphaReferenceRuntime>> | undefined
const alphaTesting = app.getVersion() === alphaVersion && (app.isPackaged || process.env.DIRECTOR_DISABLE_ALPHA_FIXTURE !== '1')
const rendererUrl =
  !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href
    : pathToFileURL(join(directory, '../renderer/index.html')).href
// Stable across development, installation and future product-name changes.
app.setPath('userData', join(app.getPath('appData'), alphaTesting ? 'ai-shortdrama-director-alpha' : 'ai-shortdrama-director'))
app.setAppUserModelId('com.aishortdrama.director')
// Release validation is opt-in and confined to the OS temp test root. The renderer
// never chooses this path; normal packaged launches always use the stable userData.
const testUserData = isolatedUserData(app.isPackaged, process.env)
if (testUserData) app.setPath('userData', testUserData)

async function createWindow() {
  const window = new BrowserWindow({
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(directory, '../../build/icon.png'),
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f7f6f3',
    title: 'AI ShortDrama Director',
    webPreferences: {
      preload: join(directory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: app.isPackaged ? [] : ['--director-development'],
    },
  })
  windows.add(window.webContents.id)
  const contentsId = window.webContents.id
  window.on('closed', () => windows.delete(contentsId))
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['继续编辑', '放弃修改并离开'],
      defaultId: 0,
      cancelId: 0,
      message: '当前编辑尚未保存。',
      detail: '选择继续编辑可等待保存或处理保存错误。',
    })
    if (choice === 1) event.preventDefault()
  })
  await window.loadURL(rendererUrl)
}

app
  .whenReady()
  .then(async () => {
    if (app.isPackaged && alphaTesting) {
      process.env.DIRECTOR_FFMPEG = join(process.resourcesPath, 'alpha-runtime', 'ffmpeg.exe')
      process.env.DIRECTOR_FFPROBE = join(process.resourcesPath, 'alpha-runtime', 'ffprobe.exe')
    }
    mkdirSync(app.getPath('userData'), { recursive: true })
    app.setAppLogsPath(join(app.getPath('userData'), 'logs'))
    database = new ProjectDatabase(
      join(app.getPath('userData'), 'workspace.sqlite'),
    )
    const repo = new IntelligenceRepository(database)
    const visual = new VisualRepository(
      repo,
      new MediaStorage(join(app.getPath('userData'), 'media')),
    )
    const broker = new MediaBroker(visual)
    visual.videoURL = (projectId, versionId) =>
      broker.issue(projectId, versionId)
    protocol.handle('director-media', (request) => broker.handle(request))
    const credentials = new EncryptedCredentialStore(
      join(app.getPath('userData'), 'credentials'),
      {
        available: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' ||
            safeStorage.getSelectedStorageBackend() !== 'basic_text'),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value),
      },
    )
    const videoFactory: VideoFactory = (profile) =>
      profile.provider === 'mock-video'
        ? new MockVideoProvider(
            join(app.getPath('userData'), 'video-work'),
            profile.capabilities,
          )
        : new SeedanceVideoProvider(profile, credentials)
    let nativeGate: NativeProductionGate
    let runtimeIdentity = ''
    const services = new AIServiceManager(join(app.getPath('userData'), 'ai-services.json'), credentials, {
      assertIdle: () => {
        if (database!.list().some(p => repo.list(p.id, 'ai_tasks', aiTaskSchema).some(t => ['queued', 'running'].includes(t.status)) ||
          imageApi.hasPending(p.id) || videoApi.hasPending(p.id) || new WorkflowRepository(database!).list(p.id).some(r => !terminalWorkflow(r.status))) ||
          imageApi.hasAnyUnconfirmedPreview() || videoApi.hasAnyUnconfirmedPreview())
          throw new DomainError('CONFLICT', '请等待正在执行的任务结束，并取消待确认预览后修改服务；历史任务与凭据保留')
      },
      apply: async (catalog) => {
        const identity=JSON.stringify([catalog.mode,catalog.localEnabled,catalog.localArchived,catalog.services.filter(s=>s.kind!=='text').map(s=>[s.id,s.revision,s.connection,s.enabled,s.deleted])])
        if(identity===runtimeIdentity)return
        runtimeIdentity=identity
        for (const registry of [imageApi.registry, videoApi.registry]) {
          for (const entry of registry.list().filter(e => e.descriptor.id.startsWith('alpha.reference.') || ['comfyui.local','packy.image-25','compshare.minimax-h3'].includes(e.descriptor.id))) registry.unregister(entry.descriptor.id, entry.descriptor.version)
        }
        if(catalog.localEnabled && !catalog.localArchived) {
          const settings=await loadComfySettings(comfySettingsPath,globalComfySettings)
          imageApi.register(new ComfyUIToolAdapter(builtinComfyProfile({...settings,checkpoint:settings.checkpoint || 'unconfigured-checkpoint',templateId:settings.templateId.startsWith('custom-')?'shot-keyframe':settings.templateId})))
        }
        if (alphaTesting && catalog.mode === 'test') {
          alphaRuntime ??= await startAlphaReferenceRuntime(join(app.getPath('userData'), 'alpha-reference'))
          imageApi.register(alphaRuntime.imageAdapter); videoApi.register(alphaRuntime.videoAdapter)
        }
        for(const s of catalog.services.filter(s=>s.kind!=='text' && s.enabled && !s.deleted)) {
          if(s.kind==='packy-image')imageApi.register(new ProductionPackyAdapter(s,credentials,nativeGate))
          else {
            const hosts=await nativeGate.hosts(s)
            videoApi.register(new CompShareMiniMaxH3Adapter({adapter:'compshare-minimax-h3',toolId:'compshare.minimax-h3',modelId:'MiniMax-H3',credentialRef:s.credentialRef},async()=>credentials.get(s.credentialRef!),new ImageHttpTransport(),await nativeGate.available(s) || await nativeGate.pending(s)?{
              allowedDownloadHosts:hosts,canExecute:cap=>nativeGate.available(s,cap),consume:(cap,input,context)=>nativeGate.consume(s,cap,context,input.durationSeconds),
              downloadHostsForTask:(taskId,url,context)=>nativeGate.taskDownloadHosts(s,taskId,url,context),outputVerified:(url,context,bytes,duration)=>nativeGate.noteVerifiedOutput(s,url,context,bytes,duration),
            }:null))
          }
        }
      },
      native: async (s,command) => {
        if(command.op==='ai.verifyVideoDownload') { const message=await nativeGate.verifyVideoDownload(s,command.taskId);runtimeIdentity='';return message }
        if(command.op!=='ai.authorizeTrial')throw new DomainError('INVALID_INPUT','测试授权命令无效')
        await nativeGate.authorize(s,command.capability,command.maxPoints);runtimeIdentity=''
        return '已开放一次小规模真实测试预览，有效期 15 分钟。请前往生成页固定选择此服务，再确认费用和上传授权；不会自动提交。测试成功前禁止批量生产。'
      },
      generationStatus: s=>nativeGate.status(s),
      importKey: async () => {
        const result = await dialog.showOpenDialog({ title: '导入或更换 AI 服务密钥（加密保存）', properties: ['openFile'], filters: [{ name: '密钥文本', extensions: ['txt', 'key'] }] })
        return result.canceled ? null : result.filePaths[0] ?? null
      },
      probe: async (service) => {
        if (service.kind === 'compshare-video') {
          const adapter = createCompShareAdapter({ adapter: 'compshare-minimax-h3', toolId: 'compshare.minimax-h3', modelId: 'MiniMax-H3', credentialRef: service.credentialRef }, credentials)
          const report = await adapter.probe(AbortSignal.timeout(15000))
          return { accepted: report.authenticated, reason: report.authenticated ? (report.points!.available > 0 ? '连接检测通过。积分可用；模型权限、真实生成和安全下载尚需验证。' : '连接检测通过，但账户额度不足，请充值后继续。真实生成未开放。') : '密钥无效或服务不可达，请重新设置并检测；未提交视频任务。' }
        }
        const adapter = new PackyImage25Adapter({ adapter: 'packy-image-25', toolId: 'packy.image-25', displayName: 'PackyAPI · GPT Image 2.5 Sunburst', modelId: 'gpt-image-2.5-sunburst', tokenGroup: 'image', credentialRef: service.credentialRef, currency: 'USD' }, async () => credentials.get(service.credentialRef!))
        const report = await adapter.probeConnectivity(AbortSignal.timeout(15000))
        return { accepted: report.authentication === 'accepted' && report.modelVisible === true, reason: report.authentication === 'accepted' && report.modelVisible ? '连接检测通过。目标模型可见；真实生成响应仍需单独验证。' : '密钥无效或模型不可见，请重新设置并检查模型权限。' }
      },
    }, !app.isPackaged && Boolean(process.env.DIRECTOR_TEST_USER_DATA) && process.env.DIRECTOR_TEXT_PROVIDER === 'mock')
    await services.load()
    const provider = services.textProvider(new MockTextProvider())
    queue = new AITaskQueue(
      repo,
      provider,
      new ProductionMediaExecutor(
        new ImageTaskExecutor(visual),
        new VideoTaskExecutor(visual, videoFactory),
      ),
    )
    const images = new VisualService(visual, queue, {
      images: async () => {
        const result = await dialog.showOpenDialog({
          title: '导入图片',
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
          ],
        })
        return result.canceled ? [] : result.filePaths
      },
      workflow: async () => {
        const result = await dialog.showOpenDialog({
          title: '导入 API 格式工作流',
          properties: ['openFile'],
          filters: [{ name: 'ComfyUI API Workflow', extensions: ['json'] }],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
    })
    const imageProfilePath=join(app.getPath('userData'),'image-api-profiles.json')
    const configuredComfy = database
      .list()
      .map((project) => ({ project, settings: visual.settings(project.id) }))
      .find((item) => item.settings.provider === 'comfyui')
    const comfySettings = (() => {
      if (!configuredComfy) return undefined
      try {
        validateLocalComfyUrl(configuredComfy.settings.baseUrl)
        return configuredComfy.settings
      } catch {
        return undefined
      }
    })()
    const comfySettingsPath = join(app.getPath('userData'), 'comfyui-service-settings.json')
    const globalComfySettings = await loadComfySettings(comfySettingsPath, comfySettings)
    const comfyAdapter = new ComfyUIToolAdapter(builtinComfyProfile({
      checkpoint: globalComfySettings.checkpoint || 'unconfigured-checkpoint',
      baseUrl: globalComfySettings.baseUrl,
      templateId: globalComfySettings.templateId.startsWith('custom-')
        ? 'shot-keyframe'
        : globalComfySettings.templateId,
      steps: globalComfySettings.steps,
      cfg: globalComfySettings.cfg,
    }))
    const imageApi=new ImageGenerationService(visual,[
      ...imageAdapters(await loadImageProfiles(imageProfilePath),credentials),
      comfyAdapter,
    ])
    const compshareProfilePath = join(app.getPath('userData'), compshareProfileFileName)
    const legacyVideoProfilePath = join(app.getPath('userData'), legacyVideoProfileFileName)
    const compshareProfile = await loadCompShareProfile(compshareProfilePath, legacyVideoProfilePath)
    if (compshareProfile) await services.retainExisting({ kind: 'compshare-video', name: 'CompShare · MiniMax H3', model: 'MiniMax-H3', baseUrl: 'https://cp.compshare.cn' }, compshareProfile.credentialRef)
    const existingPacky = (await loadImageProfiles(imageProfilePath)).find(p => 'adapter' in p)
    if (existingPacky) await services.retainExisting({ kind: 'packy-image', name: 'Packy Image', model: existingPacky.modelId, baseUrl: 'https://cf.api.fan/v1' }, existingPacky.credentialRef)
    const videoApi = new VideoApiGenerationService(visual, compshareProfile ? [createCompShareAdapter(compshareProfile, credentials)] : [])
    nativeGate=new NativeProductionGate(join(app.getPath('userData'),'production-validation'),credentials,imageApi.generation,visual)
    imageApi.preferredTool=()=>services.defaultImageTool
    imageApi.broker.autoEligible=async(toolId,cap)=>{
      if(toolId.startsWith('alpha.reference.'))return services.mode==='test'
      if(toolId!=='packy.image-25')return true
      const s=services.defaultService('packy-image')
      return Boolean(s && (cap==='image.generate' || cap==='image.referenceGenerate') && await nativeGate.validated(s,cap))
    }
    await services.applyCurrent()
    // Explicit test composition only. Packaged desktop never enables fixture generation.
    if (!app.isPackaged && process.env.DIRECTOR_TEST_USER_DATA && process.env.DIRECTOR_TEST_VIDEO_ORIGIN) {
      const origin = new URL(process.env.DIRECTOR_TEST_VIDEO_ORIGIN)
      if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.href !== `${origin.origin}/`) throw new Error('Invalid video fixture origin')
      videoApi.register(new VideoApiAdapter({
        toolId: 'reference.video', displayName: 'Local Reference Video Fixture (test only)', baseEndpoint: origin.origin,
        modelId: 'reference-video-v1', credentialRef: null,
        supportedCapabilities: ['video.textToVideo', 'video.imageToVideo'], supportedDurations: [1],
        supportedAspectRatios: ['1:1'], supportedResolutions: [{ width: 32, height: 32 }], resolutionMode: 'exact',
        durationToleranceSeconds: 0.2, supportsLastFrame: true, supportsReferenceImages: false, maxOutputCount: 4,
        polling: { initialIntervalMs: 50, maxIntervalMs: 75, maxWaitMs: 300 }, maxDownloadBytes: 10 * 1024 * 1024,
        allowedDownloadHosts: [], allowedDownloadHostSuffixes: [], currency: 'USD', estimateSupport: 'unknown',
        cancelSupport: true, recoverSupport: true,
      }, async () => 'VIDEO_FIXTURE_SECRET', new ImageHttpTransport({ fixtureOrigin: origin.origin, timeoutMs: 300 })))
    }
    // Test composition only: isolated userData + unpackaged app + exact loopback origin.
    // Never derives a real endpoint/key from a test flag or registers this in packaged builds.
    if(!app.isPackaged && process.env.DIRECTOR_TEST_USER_DATA && process.env.DIRECTOR_TEST_IMAGE_ORIGIN){
      const u=new URL(process.env.DIRECTOR_TEST_IMAGE_ORIGIN)
      if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.href!==u.origin+'/')throw new Error('Invalid HTTP fixture origin')
      imageApi.register(new ImageApiAdapter({toolId:'reference.fixture',displayName:'本地 HTTP Fixture（不收费）',endpoint:u.origin+'/generate',modelId:'reference-v1',credentialRef:null,supportedCapabilities:['image.generate','image.referenceGenerate'],supportedResolutions:[{width:32,height:32}],supportedAspectRatios:['1:1'],maxReferences:8,maxOutputCount:4,currency:'USD',estimateSupport:'unknown',cancelSupport:false,recoverSupport:false},async()=>'DIRECTOR_HTTP_FIXTURE_ONLY',new ImageHttpTransport({fixtureOrigin:u.origin})))
    }
    registerWorkspaceIPC(
      database,
      windows,
      rendererUrl,
      !app.isPackaged,
      new IntelligenceService(repo, queue),
      images,
      new ProductionService(visual, images, queue, credentials, videoFactory, {
        credential: async () => {
          const r = await dialog.showOpenDialog({
            title: '导入 API Key 文本（仅主进程读取并加密）',
            properties: ['openFile'],
            filters: [{ name: 'Key 文本', extensions: ['txt', 'key'] }],
          })
          return r.canceled ? null : (r.filePaths[0] ?? null)
        },
        video: async () => {
          const r = await dialog.showOpenDialog({
            title: '导入 MP4 视频',
            properties: ['openFile'],
            filters: [{ name: 'MP4', extensions: ['mp4'] }],
          })
          return r.canceled ? null : (r.filePaths[0] ?? null)
        },
      }),
      imageApi,
      videoApi,
      async () => {
        const profile=await dialog.showOpenDialog({title:'导入 Packy 图像服务配置',properties:['openFile'],filters:[{name:'Profile JSON',extensions:['json']}]})
        if(profile.canceled||!profile.filePaths[0])return null
        const key=await dialog.showOpenDialog({title:'导入 API Key（主进程加密保存）',properties:['openFile'],filters:[{name:'Key 文本',extensions:['txt','key']}]})
        if(key.canceled||!key.filePaths[0])return null
        return importImageProfile(imageProfilePath,profile.filePaths[0],key.filePaths[0],credentials,imageApi)
      },
      async (toolId) => {
        const storedCompShare = await loadCompShareProfile(compshareProfilePath, legacyVideoProfilePath)
        const profile = (await loadImageProfiles(imageProfilePath)).find(p => p.toolId === toolId) ??
          (storedCompShare?.toolId === toolId ? storedCompShare : null)
        return Boolean(profile?.credentialRef && safeStorage.isEncryptionAvailable() && await credentials.has(profile.credentialRef))
      },
      {
        configuration: async () => {
          const profile = await loadCompShareProfile(compshareProfilePath, legacyVideoProfilePath)
          return { configured: Boolean(profile?.credentialRef && safeStorage.isEncryptionAvailable() && await credentials.has(profile.credentialRef)), importAllowed: !profile, generationEnabled: false as const }
        },
        importCredential: async () => {
          const result = await dialog.showOpenDialog({ title: '导入 CompShare H3 API Key（主进程加密保存，不生成视频）', properties: ['openFile'], filters: [{ name: 'Key 文本', extensions: ['txt', 'key'] }] })
          if (result.canceled || !result.filePaths[0]) return null
          return importCompShareCredential(compshareProfilePath, legacyVideoProfilePath, result.filePaths[0], credentials, videoApi)
        },
        probe: async () => {
          const profile = await loadCompShareProfile(compshareProfilePath, legacyVideoProfilePath)
          if (!profile) throw new DomainError('NOT_FOUND', 'CompShare 尚未配置')
          return createCompShareAdapter(profile, credentials).probe(AbortSignal.timeout(10000))
        },
      },
      async (command) => {
        if (command.op.startsWith('ai.')) return services.execute(command)
        if (command.op === 'comfy.configuration') return { settings: await loadComfySettings(comfySettingsPath, globalComfySettings), templates: builtinTemplates }
        if (command.op !== 'comfy.save') throw new DomainError('INVALID_INPUT', '服务命令无效')
        if (imageApi.hasUnconfirmedPreview('comfyui.local') || database!.list().some(project => imageApi.hasPending(project.id) ||
          new WorkflowRepository(database!).list(project.id).some(run => run.inputSnapshot.generation.toolId === 'comfyui.local' && !terminalWorkflow(run.status)) || imageApi.generation.list('generation_records', project.id).some(record =>
          record.toolId === 'comfyui.local' && (['unknown', 'unknown-submission'].includes(record.outcome) ||
            (record.outcome === 'pending' && (record.approvalId !== null || Date.parse(imageApi.generation.get('generation_estimates', project.id, record.estimateId).validUntil) > Date.now()))))))
          throw new DomainError('CONFLICT', '请等待图像任务结束或生成预览过期后修改服务连接')
        const settings = validateComfySettings(command.settings)
        const adapter = new ComfyUIToolAdapter(builtinComfyProfile({ ...settings, checkpoint: settings.checkpoint || 'unconfigured-checkpoint' }))
        await saveComfySettings(comfySettingsPath, settings)
        const current = imageApi.registry.list().find(entry => entry.descriptor.id === 'comfyui.local')
        if (current) imageApi.registry.unregister(current.descriptor.id, current.descriptor.version)
        if(services.localEnabled)imageApi.register(adapter)
        return { settings, templates: builtinTemplates }
      },
    )
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    )
    session.defaultSession.setPermissionCheckHandler(() => false)
    await createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })
  .catch((error: unknown) => {
    void error
    console.error('Application startup failed; details withheld')
    dialog.showErrorBox(
      '工作台无法启动',
      '数据库迁移或启动失败。请保留 userData 数据，恢复经过验证的备份，或安装支持当前数据库版本的应用；不要删除数据库。',
    )
    app.exit(1)
  })
app.on('will-quit', () => {
  void alphaRuntime?.close()
  queue?.close()
  database?.close()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
