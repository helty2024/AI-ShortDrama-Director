import { createContext, useContext } from 'react'
import type { CreatorModule } from './modules'
export interface CreatorSelection {
  sceneId?: string
  shotId?: string
  assetId?: string
  candidateId?: string
}
export interface CreatorState extends CreatorSelection {
  currentModule: CreatorModule
  inspectorOpen: boolean
  taskDrawerOpen: boolean
  contextNotice: string | null
  clearContextNotice: () => void
  openInspector: () => void
  closeInspector: () => void
  toggleInspector: () => void
  setTaskDrawerOpen: (open: boolean) => void
  navigateCreator: (module: CreatorModule, selection?: CreatorSelection) => void
  select: (selection: CreatorSelection) => void
}
export const CreatorContext = createContext<CreatorState | null>(null)
export function useCreator() {
  const value = useContext(CreatorContext)
  if (!value) throw new Error('CreatorContextProvider missing')
  return value
}
