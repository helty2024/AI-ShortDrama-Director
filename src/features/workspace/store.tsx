import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import { workspaceService } from '../../services/workspace'
import type { EditorStatus } from './state'
import { Context, initial, workspaceReducer } from './state'
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initial)
  const locked = useRef(false)
  const editor = useRef<EditorStatus>('saved')
  const setEditorStatus = useCallback((status: EditorStatus) => {
    editor.current = status
    dispatch({ type: 'patch', value: { editorStatus: status } })
  }, [])
  const patch = (value: Partial<typeof initial>) =>
    dispatch({ type: 'patch', value })
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (editor.current !== 'saved') {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [])
  const guard = () => {
    if (editor.current === 'saving') {
      patch({ error: '正在保存，请稍候再切换' })
      return false
    }
    if (editor.current !== 'saved') {
      if (!window.confirm('存在未保存的修改。是否放弃修改并继续？'))
        return false
      setEditorStatus('saved')
      patch({ editorEpoch: state.editorEpoch + 1 })
    }
    patch({ editorOwner: null })
    return true
  }
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const projects = await workspaceService.list()
        const recent = projects.find((project) => project.lastOpenedAt)
        const workspace = recent
          ? await workspaceService.readWorkspace(recent.id)
          : null
        if (active) patch({ projects, workspace, loading: false })
      } catch (error) {
        if (active)
          patch({
            loading: false,
            error: String(error instanceof Error ? error.message : error),
          })
      }
    })()
    return () => {
      active = false
    }
  }, [])
  const run = async (
    operation: () => Promise<string | null | undefined>,
    saving: boolean,
  ) => {
    if (locked.current || state.loading || !guard()) return
    locked.current = true
    patch({ saving, loading: !saving, error: null })
    try {
      const selected = await operation()
      const projects = await workspaceService.list()
      const id = selected === undefined ? state.workspace?.project.id : selected
      const workspace =
        id && projects.some((p) => p.id === id)
          ? await workspaceService.readWorkspace(id)
          : null
      patch({ projects, workspace, modal: null })
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : '操作失败' })
    } finally {
      locked.current = false
      patch({ saving: false, loading: false })
    }
  }
  return (
    <Context.Provider
      value={{
        state,
        setEditorStatus,
        setEditorOwner: (id) => patch({ editorOwner: id }),
        acceptEntity: (entity) => {
          if (state.workspace?.project.id === entity.projectId)
            patch({
              workspace: {
                ...state.workspace,
                entities: state.workspace.entities.map((old) =>
                  old.id === entity.id ? entity : old,
                ),
              },
            })
        },
        navigate: (module) => {
          if (module !== state.module && !locked.current && guard())
            patch({ module })
        },
        modal: (modal) => {
          if (!locked.current) patch({ modal, error: null })
        },
        open: (id) =>
          run(async () => (await workspaceService.open(id)).id, false),
        reload: () => run(async () => undefined, false),
        mutate: (operation) => run(operation, true),
      }}
    >
      {children}
    </Context.Provider>
  )
}
