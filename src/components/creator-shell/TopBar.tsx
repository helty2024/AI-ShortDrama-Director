import { useWorkspace } from '../../features/workspace/state'
import { useCreator } from './creator-context'
import { creatorLabels } from './modules'
import { useToast } from './toast-context'
export function TopBar({ simple, onModeToggle }: { simple: boolean; onModeToggle: () => void }) {
  const { state, open } = useWorkspace()
  const { currentModule, taskDrawerOpen, setTaskDrawerOpen, navigateCreator, inspectorOpen, toggleInspector } = useCreator()
  const toast = useToast()
  const save = state.editorStatus !== 'saved'
    ? { dirty: '尚未保存', saving: '自动保存中…', error: '保存失败，修改已保留' }[state.editorStatus]
    : state.saving ? '保存中…' : state.loading ? '加载中…' : state.error ? '操作失败' : '已保存到本地'
  return <header className="topbar creator-topbar">
    <div className="creator-topbar-location"><strong>{state.workspace?.project.name}</strong><span aria-hidden="true">/</span><span>{creatorLabels[currentModule]}</span></div>
    <div className="creator-topbar-actions">
      <span role="status" className="save-state">{save}</span>
      <select aria-label="切换项目" value={state.workspace?.project.id ?? ''} disabled={state.loading || state.saving} onChange={(event) => { if (event.target.value) void open(event.target.value) }}>
        {state.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <button aria-label="制作任务" aria-expanded={taskDrawerOpen} onClick={() => setTaskDrawerOpen(!taskDrawerOpen)}>制作任务</button>
      <button aria-label="切换检查器" aria-expanded={inspectorOpen} onClick={toggleInspector}>详情</button>
      <button onClick={() => navigateCreator('settings')}>设置</button>
      <button aria-pressed={!simple} onClick={() => { onModeToggle(); toast('info', simple ? '已切换到高级模式' : '已切换到简洁模式') }}>{simple ? '高级模式' : '简洁模式'}</button>
    </div>
  </header>
}
