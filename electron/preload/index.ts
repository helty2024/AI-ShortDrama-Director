import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../../src/shared/desktop.js'

const desktop: DesktopAPI = {
  development: process.argv.includes('--director-development'),
  workspace: {
    request: (request) => ipcRenderer.invoke('workspace:request', request),
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
}
contextBridge.exposeInMainWorld('desktop', desktop)
