import { useState } from 'react'
import { useCreator } from '../../components/creator-shell/creator-context'
import { useWorkspace } from '../workspace/state'
import { useVisual } from '../visual/use-visual'
import { useIntelligence } from '../script/use-intelligence'
import { AssetImage } from '../visual/AssetImage'
import { assetKinds, assetLabels, isCreatorAsset, resolveCreatorAsset } from './creator-assets'
import type { CreatorAssetKind } from './creator-assets'
import './assets-creator.css'

export function AssetsCreatorPage() {
  const { state, modal } = useWorkspace()
  const { targetKind, targetId, selectCreatorAsset } = useCreator()
  const projectId = state.workspace?.project.id
  if (!projectId) return <p className="empty">请先打开项目。</p>
  return <AssetsWorkspace key={projectId} projectId={projectId} selectedKind={targetKind} selectedId={targetId} selectAsset={selectCreatorAsset} create={modal} />
}

function AssetsWorkspace({ projectId, selectedKind, selectedId, selectAsset, create }: {
  projectId: string
  selectedKind: CreatorAssetKind | undefined
  selectedId: string | undefined
  selectAsset: (kind: CreatorAssetKind | undefined, id: string | undefined) => void
  create: ReturnType<typeof useWorkspace>['modal']
}) {
  const { state } = useWorkspace()
  const visual = useVisual(projectId)
  const intelligence = useIntelligence(projectId)
  const [tab, setTab] = useState<CreatorAssetKind>(selectedKind ?? 'character')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const entities = state.workspace?.entities ?? []
  const rows = entities.filter(isCreatorAsset).filter((entity) => entity.kind === tab)
  const visible = rows.filter((entity) => {
    const text = `${entity.name} ${entity.description}`.toLocaleLowerCase()
    return text.includes(query.trim().toLocaleLowerCase()) && (filter === 'all' || resolveCreatorAsset(entity, entities, visual.snapshot?.versions ?? [], intelligence.snapshot.tasks).status === filter)
  })
  const switchTab = (next: CreatorAssetKind) => {
    if (next !== tab) {
      setTab(next)
      setFilter('all')
      if (selectedKind !== next) selectAsset(undefined, undefined)
    }
  }
  return <section className="assets-creator" aria-label="创作资产工作区">
    <div className="page-heading assets-creator-heading"><div><h1>资产</h1><p>为故事中的人物、地点和道具建立可信的视觉参考。</p></div><button className="primary" onClick={() => create({ type: 'entity', kind: tab })}>新增{assetLabels[tab]}</button></div>
    <div className="assets-creator-toolbar">
      <div role="tablist" aria-label="资产类型" className="assets-creator-tabs">{assetKinds.map((kind) => <button key={kind} role="tab" aria-selected={tab === kind} onClick={() => switchTab(kind)}>{assetLabels[kind]} <span>{entities.filter((e) => e.kind === kind).length}</span></button>)}</div>
      <label className="assets-creator-search">搜索<input aria-label="搜索创作资产" value={query} placeholder="名称或简介" onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="assets-creator-filter">状态<select aria-label="筛选资产状态" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部</option>{['已确认', '准备就绪', '待审核', '待生成', '不可用'].map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    {(visual.error || intelligence.error) && <p role="alert" className="error">{visual.error || intelligence.error}</p>}
    {!rows.length ? <div className="assets-creator-empty"><h2>还没有{assetLabels[tab]}资产</h2><p>先建立第一个{assetLabels[tab]}，再逐步补充设定和参考图。</p><button className="primary" onClick={() => create({ type: 'entity', kind: tab })}>创建第一个{assetLabels[tab]}</button></div> : !visible.length ? <p className="empty">没有匹配的{assetLabels[tab]}，试试其他关键词或状态。</p> : <div className="assets-creator-grid" aria-label={`${assetLabels[tab]}资产网格`}>{visible.map((entity) => {
      const view = resolveCreatorAsset(entity, entities, visual.snapshot?.versions ?? [], intelligence.snapshot.tasks)
      return <button className="creator-asset-card" key={entity.id} aria-pressed={selectedId === entity.id && selectedKind === entity.kind} onClick={() => selectAsset(entity.kind, entity.id)}>
        <div className={`creator-asset-card-image is-${entity.kind}`}>{view.preview ? <AssetImage projectId={projectId} versionId={view.preview.id} alt={`${entity.name}${view.primaryVersion ? '主参考' : '候选预览'}`} /> : <span className="creator-asset-placeholder">{assetLabels[entity.kind]}</span>}{view.preview && !view.primaryVersion && <span className="creator-candidate-mark">候选</span>}</div>
        <div className="creator-asset-card-info"><div><strong>{entity.name}</strong><small>{assetLabels[entity.kind]}</small></div><span className="creator-status" data-status={view.status}>{view.status}</span></div>
        <p>{view.brokenPrimary ? '主参考暂不可用' : view.primaryVersion ? '已设置主参考' : '未设置主参考'}</p>
      </button>
    })}</div>}
  </section>
}
