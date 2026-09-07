import { contextBridge } from 'electron'
import type { DesktopAPI } from '../../src/shared/desktop.js'

const desktop: DesktopAPI = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
}
contextBridge.exposeInMainWorld('desktop', desktop)
