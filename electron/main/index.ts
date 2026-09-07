import { app, BrowserWindow, session } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { ProjectDatabase } from './database.js'
import { registerWorkspaceIPC } from './ipc.js'

const directory = dirname(fileURLToPath(import.meta.url))
const windows = new Set<number>()
let database: ProjectDatabase | undefined
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
  await window.loadURL(rendererUrl)
}

app
  .whenReady()
  .then(async () => {
    mkdirSync(app.getPath('userData'), { recursive: true })
    database = new ProjectDatabase(
      join(app.getPath('userData'), 'workspace.sqlite'),
    )
    registerWorkspaceIPC(database, windows, rendererUrl, !app.isPackaged)
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
app.on('will-quit', () => database?.close())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
