import './App.css'
import { ScriptPage } from './features/script/ScriptPage'
import './features/script/script.css'
import { WorkspaceProvider } from './features/workspace/store'
import { navigation, useWorkspace } from './features/workspace/state'
import {
  ProjectPage,
  CharactersPage,
  LocationsPage,
  PropsPage,
  StoryboardPage,
  GenerationPage,
  AssetsPage,
} from './features/workspace/pages'
import { WorkspaceDialog } from './features/workspace/dialogs'
const pages = {
  projects: ProjectPage,
  scripts: ScriptPage,
  characters: CharactersPage,
  locations: LocationsPage,
  props: PropsPage,
  storyboard: StoryboardPage,
  generation: GenerationPage,
  assets: AssetsPage,
}
function WorkspaceShell() {
  const { state, navigate, open, reload } = useWorkspace()
  const Page = pages[state.module]
  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          DIRECTOR<span>AI 短剧工作台</span>
        </div>
        <nav aria-label="主导航">
          {Object.entries(navigation).map(([key, label]) => (
            <button
              key={key}
              aria-current={state.module === key ? 'page' : undefined}
              disabled={state.loading || state.saving}
              onClick={() => navigate(key as keyof typeof navigation)}
            >
              {label}
            </button>
          ))}
        </nav>
        <small>Phase 2 · 剧本与制作拆解</small>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <strong>{state.workspace?.project.name ?? '尚未打开项目'}</strong>
            <span role="status" className="save-state">
              {state.editorStatus !== 'saved'
                ? ({ dirty: '尚未保存', saving: '自动保存中…', error: '保存失败，修改已保留' }[state.editorStatus])
                : state.saving
                ? '保存中…'
                : state.loading
                  ? '加载中…'
                  : state.error
                    ? '操作失败'
                    : state.modal && state.modal.type !== 'delete'
                      ? '尚未保存'
                      : '已保存到本地'}
            </span>
          </div>
          <label className="switcher">
            切换项目
            <select
              aria-label="切换项目"
              disabled={state.loading || state.saving}
              value={state.workspace?.project.id ?? ''}
              onChange={(event) => {
                if (event.target.value) void open(event.target.value)
              }}
            >
              <option value="">选择项目</option>
              {state.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </header>
        <main aria-busy={state.loading || state.saving}>
          {state.error && !state.modal && (
            <div role="alert" className="error">
              {state.error}
              <button onClick={() => void reload()}>重新加载</button>
            </div>
          )}
          <Page key={(state.workspace?.project.id ?? "none") + ":" + state.editorEpoch} />
        </main>
      </div>
      {state.modal && <WorkspaceDialog />}
    </div>
  )
}
export default function App() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  )
}
