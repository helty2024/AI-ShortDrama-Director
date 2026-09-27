import type { ReactNode } from 'react'
import { useWorkspace } from '../../features/workspace/state'
import { CreatorContextProvider } from './creator-state'
import { useCreator } from './creator-context'
import { TopBar } from './TopBar'
import { ProjectNav } from './ProjectNav'
import { MainWorkspace } from './MainWorkspace'
import { ContextInspector } from './ContextInspector'
import { TaskDrawer } from './TaskDrawer'
import { ToastProvider } from './ToastHost'
import './creator-shell.css'

function ShellLayout({ children, simple, onModeToggle }: { children: ReactNode; simple: boolean; onModeToggle: () => void }) {
  const { state, reload } = useWorkspace()
  const { currentModule } = useCreator()
  return <div className="creator-shell">
    <TopBar simple={simple} onModeToggle={onModeToggle} />
    <ProjectNav />
    <MainWorkspace resetKey={`${state.workspace?.project.id}:${currentModule}:${state.editorEpoch}`} busy={state.loading || state.saving}>
      {state.error && !state.modal && <div className="error" role="alert">{state.error}<button onClick={() => void reload()}>重新加载</button></div>}
      {children}
    </MainWorkspace>
    <ContextInspector />
    <TaskDrawer />
  </div>
}
export function CreatorShell({ children, simple, onModeToggle }: { children: ReactNode; simple: boolean; onModeToggle: () => void }) {
  return <CreatorContextProvider><ToastProvider><ShellLayout simple={simple} onModeToggle={onModeToggle}>{children}</ShellLayout></ToastProvider></CreatorContextProvider>
}
