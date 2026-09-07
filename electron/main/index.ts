import { app, BrowserWindow, session } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    show: false, backgroundColor: '#11141b', title: 'AI ShortDrama Director',
    webPreferences: {
      preload: join(directory, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await window.loadFile(join(directory, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
}).catch((error: unknown) => {
  console.error('Failed to start application:', error)
  app.exit(1)
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
