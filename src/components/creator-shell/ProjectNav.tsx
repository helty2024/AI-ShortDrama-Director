import { useEffect, useState } from 'react'
import { useWorkspace } from '../../features/workspace/state'
import { useCreator } from './creator-context'
import { creatorLabels, primaryModules } from './modules'
import type { CreatorModule } from './modules'
const iconPaths: Record<CreatorModule, string> = {
  story: 'M4 5h7a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H4zm16 0h-7a3 3 0 0 0-3 3v12a3 3 0 0 1 3-3h7z',
  scripts: 'M5 3h10l4 4v14H5z M15 3v5h5 M8 12h8 M8 16h8',
  assetsHub: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  storyboard: 'M3 6h18v12H3z M3 10h18 M8 6v12 M16 6v12',
  generation: 'M12 3l2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z',
  shotVideos: 'M3 5h18v14H3z M10 9l5 3-5 3z',
  settings: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M18.4 5.6l-2.1 2.1 M7.7 16.3l-2.1 2.1 M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z',
  operations: 'M4 4h16v16H4z M8 9h8 M8 13h8 M8 17h5',
}
export function ProjectNav() {
  const { state, navigate } = useWorkspace()
  const { currentModule, navigateCreator } = useCreator()
  const [compactViewport, setCompactViewport] = useState(() => window.matchMedia('(max-width: 2199px)').matches)
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null)
  const collapsed = manualCollapsed ?? compactViewport
  useEffect(() => {
    const query = window.matchMedia('(max-width: 2199px)')
    const update = () => setCompactViewport(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const busy = state.loading || state.saving
  const link = (module: CreatorModule) => <button key={module} type="button" title={creatorLabels[module]}
    aria-label={creatorLabels[module]} aria-current={currentModule === module ? 'page' : undefined}
    disabled={busy} onClick={() => navigateCreator(module)}>
    <span className="creator-nav-glyph" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[module]} /></svg></span>
    {!collapsed && <span>{creatorLabels[module]}</span>}
  </button>
  return <aside className={'creator-nav' + (collapsed ? ' is-collapsed' : '')} aria-label="项目导航">
    <div className="creator-nav-head">
      <button title="返回项目列表" aria-label="返回项目列表" disabled={busy} onClick={() => navigate('projects')}>
        <span aria-hidden="true">←</span>{!collapsed && <span>项目列表</span>}
      </button>
      {!collapsed && <strong title={state.workspace?.project.name}>{state.workspace?.project.name}</strong>}
      <button title={collapsed ? '展开导航' : '收起导航'} aria-label={collapsed ? '展开导航' : '收起导航'}
        onClick={() => setManualCollapsed(!collapsed)}>{collapsed ? '»' : '«'}</button>
    </div>
    <nav aria-label="创作阶段">{primaryModules.map(link)}</nav>
    <nav className="creator-nav-secondary" aria-label="次级导航">{link('settings')}{link('operations')}</nav>
  </aside>
}
