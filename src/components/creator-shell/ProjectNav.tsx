import { useWorkspace } from '../../features/workspace/state'
import { useCreator } from './creator-context'
import { creatorLabels, primaryModules } from './modules'

export function ProjectNav({ simple }: { simple: boolean }) {
  const { state, navigate } = useWorkspace()
  const { currentModule, navigateCreator } = useCreator()
  const busy = state.loading || state.saving
  return <div className="creator-nav horizontal-nav" aria-label="项目导航">
    <button className="project-back" aria-label="返回项目列表" disabled={busy} onClick={() => navigate('projects')}>← 项目</button>
    <nav aria-label="创作阶段">{primaryModules.map((module, index) => <button key={module} aria-label={creatorLabels[module]} aria-current={currentModule === module ? 'page' : undefined} disabled={busy} onClick={() => navigateCreator(module)}><span className="stage-number" aria-hidden="true">{index + 1}</span>{creatorLabels[module]}</button>)}</nav>
    <nav className="creator-nav-secondary" aria-label="次级导航"><button onClick={() => navigateCreator('settings')}>项目设置</button>{!simple && <button onClick={() => navigateCreator('operations')}>验收与维护</button>}</nav>
  </div>
}
