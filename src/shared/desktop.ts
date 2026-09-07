export interface DesktopAPI {
  readonly platform: string
  readonly versions: {
    readonly electron: string
    readonly chrome: string
    readonly node: string
  }
}
