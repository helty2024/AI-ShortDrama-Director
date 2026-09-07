import type { DesktopAPI } from './shared/desktop.js'
declare global {
  interface Window { desktop?: DesktopAPI }
}
