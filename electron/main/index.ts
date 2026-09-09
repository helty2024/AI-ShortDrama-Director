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
import { CompatibleTextProvider } from './intelligence/provider.js'
import { IntelligenceService } from './intelligence/service.js'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { ProjectDatabase } from './database.js'
import { registerWorkspaceIPC } from './ipc.js'

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
const rendererUrl =
  !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href
    : pathToFileURL(join(directory, '../renderer/index.html')).href
// Stable across development, installation and future product-name changes.
app.setPath('userData', join(app.getPath('appData'), 'ai-shortdrama-director'))
app.setAppUserModelId('com.aishortdrama.director')
// A test harness can isolate the entire userData directory; renderer never chooses a path.
if (!app.isPackaged && process.env.DIRECTOR_TEST_USER_DATA)
  app.setPath('userData', process.env.DIRECTOR_TEST_USER_DATA)

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
    backgroundColor: '#11141b',
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
    mkdirSync(app.getPath('userData'), { recursive: true })
    app.setAppLogsPath(join(app.getPath('userData'), 'logs'))
    database = new ProjectDatabase(
      join(app.getPath('userData'), 'workspace.sqlite'),
    )
    const repo = new IntelligenceRepository(database)
    const provider =
      process.env.DIRECTOR_TEXT_PROVIDER === 'compatible'
        ? new CompatibleTextProvider({
            baseUrl:
              process.env.DIRECTOR_TEXT_BASE_URL ?? 'https://api.openai.com/v1',
            model: process.env.DIRECTOR_TEXT_MODEL ?? '',
            apiKey: process.env.DIRECTOR_TEXT_API_KEY,
          })
        : new MockTextProvider()
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
  queue?.close()
  database?.close()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
