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

const directory = dirname(fileURLToPath(import.meta.url))
const windows = new Set<number>()
let database: ProjectDatabase | undefined
let queue: AITaskQueue | undefined
const rendererUrl =
  !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href
    : pathToFileURL(join(directory, '../renderer/index.html')).href
// A test harness can isolate the entire userData directory; renderer never chooses a path.
if (!app.isPackaged && process.env.DIRECTOR_TEST_USER_DATA)
  app.setPath('userData', process.env.DIRECTOR_TEST_USER_DATA)

async function createWindow() {
  const window = new BrowserWindow({
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
    queue = new AITaskQueue(repo, provider, new ImageTaskExecutor(visual))
    registerWorkspaceIPC(
      database,
      windows,
      rendererUrl,
      !app.isPackaged,
      new IntelligenceService(repo, queue),
      new VisualService(visual, queue, {
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
    console.error('Failed to start application:', error)
    app.exit(1)
  })
app.on('will-quit', () => {
  queue?.close()
  database?.close()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
