import { useState } from 'react'
import { CreatorShell } from './components/creator-shell/CreatorShell'
import { useCreator } from './components/creator-shell/creator-context'
import { MediaEnvironmentNotice } from './features/operations/MediaEnvironmentNotice'
import { SimpleModeContext } from './features/operations/mode'
import { OperationsPage, SetupWizard } from './features/operations/OperationsPage'
import { ProductionBoard } from './features/production/ProductionBoard'
import { AssetsPage } from './features/visual/AssetsPage'
import { ProviderSettingsPage } from './features/visual/ProviderSettingsPage'
import { ScriptPage } from './features/script/ScriptPage'
import { StoryPage } from './features/story/StoryPage'
import { AssetsCreatorPage } from './features/assets/AssetsCreatorPage'
import { StoryboardCreatorPage } from './features/storyboard/StoryboardCreatorPage'
import { GenerateCreatorPage } from './features/generate/GenerateCreatorPage'
import { ShotVideosCreatorPage } from './features/shot-videos/ShotVideosCreatorPage'
import { WorkspaceProvider } from './features/workspace/store'
import { useWorkspace } from './features/workspace/state'
import {
  ProjectPage, CharactersPage, LocationsPage, PropsPage, GenerationPage,
} from './features/workspace/pages'
import { WorkspaceDialog } from './features/workspace/dialogs'
import './features/visual/visual.css'
import './features/script/script.css'
import './App.css'

function LegacyLinks() {
  const { state, navigate } = useWorkspace()
  if (state.module !== 'settings' && state.module !== 'operations') return null
  const labels = { characters: '角色', locations: '场景', props: '道具', assets: '素材库', production: '生产看板', legacyGeneration: '旧版生成' }
  return (
    <section className="creator-compat-links" aria-label="旧版兼容入口">
      <span>旧版兼容入口</span>
      {(['characters', 'locations', 'props', 'assets', 'production', 'legacyGeneration'] as const).map((module) => (
        <button key={module} onClick={() => navigate(module)}>{labels[module]}</button>
      ))}
    </section>
  )
}
function CreatorPages() {
  const { state } = useWorkspace()
  const { currentModule } = useCreator()
  if (window.desktop?.development && localStorage.getItem('director-test-render-error') === '1') {
    throw new Error('Creator workspace test error')
  }
  const pages = {
    story: StoryPage, scripts: ScriptPage, assetsHub: AssetsCreatorPage,
    storyboard: StoryboardCreatorPage, generation: GenerateCreatorPage, shotVideos: ShotVideosCreatorPage,
    settings: ProviderSettingsPage, operations: OperationsPage,
  }
  const legacy = {
    characters: CharactersPage, locations: LocationsPage, props: PropsPage,
    assets: AssetsPage, production: ProductionBoard, legacyGeneration: GenerationPage,
  }
  const Page = state.module in legacy
    ? legacy[state.module as keyof typeof legacy]
    : pages[currentModule]
  return (
    <>
      <MediaEnvironmentNotice />
      <Page key={`${state.workspace?.project.id}:${state.module}:${state.editorEpoch}`} />
      <LegacyLinks />
    </>
  )
}
function WorkspaceRoot() {
  const { state, navigate } = useWorkspace()
  const [simple, setSimple] = useState(() => localStorage.getItem('director-mode') !== 'advanced')
  const inProject = Boolean(state.workspace) && state.module !== 'projects'
  const toggleMode = () => {
    setSimple(!simple)
    localStorage.setItem('director-mode', simple ? 'advanced' : 'simple')
  }
  return (
    <SimpleModeContext value={simple}>
      {inProject ? (
        <CreatorShell key={state.workspace!.project.id} simple={simple} onModeToggle={toggleMode}>
          <div className={simple ? 'simple-mode' : ''}><CreatorPages /></div>
        </CreatorShell>
      ) : (
        <div className="project-list-shell">
          <header className="topbar">
            <strong>{state.workspace?.project.name ?? '尚未打开项目'}</strong>
            <div className="actions">
              <button onClick={() => navigate('projects')}>项目</button>
              <button onClick={() => navigate('settings')}>项目设置</button>
              <button onClick={() => navigate('operations')}>验收与维护</button>
              <button onClick={toggleMode}>{simple ? '高级模式' : '简洁模式'}</button>
            </div>
          </header>
          <main>
            <MediaEnvironmentNotice />
            <SetupWizard />
            {state.module === 'operations'
              ? <OperationsPage />
              : state.module === 'settings'
                ? <ProviderSettingsPage />
                : <ProjectPage />}
          </main>
        </div>
      )}
      {state.modal && <WorkspaceDialog />}
    </SimpleModeContext>
  )
}
export default function App() {
  return <WorkspaceProvider><WorkspaceRoot /></WorkspaceProvider>
}
