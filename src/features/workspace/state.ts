import { createContext, useContext } from 'react'
import type {
  Entity,
  EntityKind,
  Project,
  Workspace,
} from '../../shared/domain'
export const navigation = {
  projects: '项目',
  scripts: '剧本',
  characters: '角色',
  locations: '场景',
  props: '道具',
  storyboard: '分镜',
  production: '生产看板',
  generation: '生成',
  assets: '素材库',
  settings: '设置',
  operations: '验收与维护',
}
export type Module = keyof typeof navigation
export type Modal =
  | { type: 'project' }
  | { type: 'rename'; project: Project }
  | { type: 'delete'; project: Project }
  | { type: 'entity'; kind: EntityKind }
  | null
export type EditorStatus = 'saved' | 'dirty' | 'saving' | 'error'
interface State {
  editorStatus: EditorStatus
  editorEpoch: number
  editorOwner: string | null
  projects: Project[]
  workspace: Workspace | null
  module: Module
  loading: boolean
  saving: boolean
  error: string | null
  modal: Modal
}
export const initial: State = {
  editorStatus: 'saved',
  editorEpoch: 0,
  editorOwner: null,
  projects: [],
  workspace: null,
  module: 'projects',
  loading: true,
  saving: false,
  error: null,
  modal: null,
}
type Action = { type: 'patch'; value: Partial<State> }
export function workspaceReducer(state: State, action: Action): State {
  return { ...state, ...action.value }
}
interface Store {
  setEditorOwner: (id: string | null) => void
  setEditorStatus: (status: EditorStatus) => void
  acceptEntity: (entity: Entity) => void
  state: State
  navigate: (module: Module) => void
  modal: (modal: Modal) => void
  open: (id: string) => Promise<void>
  reload: () => Promise<void>
  mutate: (operation: () => Promise<string | null | undefined>) => Promise<void>
}
export const Context = createContext<Store | null>(null)
export function useWorkspace() {
  const value = useContext(Context)
  if (!value) throw new Error('WorkspaceProvider missing')
  return value
}
