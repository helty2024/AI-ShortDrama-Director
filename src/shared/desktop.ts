import type { WorkspaceAPI } from './api.js'
export interface DesktopAPI {
  readonly development: boolean
  readonly workspace: WorkspaceAPI
  readonly platform: string
  readonly versions: {
    readonly electron: string
    readonly chrome: string
    readonly node: string
  }
}
