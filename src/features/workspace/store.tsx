import { useEffect, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import { workspaceService } from '../../services/workspace'
import { Context, initial, workspaceReducer } from './state'
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initial)
  const locked = useRef(false)
  const patch = (value: Partial<typeof initial>) =>
    dispatch({ type: 'patch', value })
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
    if (locked.current || state.loading) return
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
        navigate: (module) => {
          if (!locked.current) patch({ module })
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
