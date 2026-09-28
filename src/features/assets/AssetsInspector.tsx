import { useEffect, useState } from 'react'
import { lineageSchema } from '../../shared/compatibility'
import type { Lineage } from '../../shared/compatibility'
import type { Asset } from '../../shared/domain'
import type { AssetVersion } from '../../shared/visual'
import { useCreator } from '../../components/creator-shell/creator-context'
import { useToast } from '../../components/creator-shell/toast-context'
import { useWorkspace } from '../workspace/state'
import { BibleEditor } from '../script/BibleEditor'
import { bibleLabels } from '../script/bible-labels'
import { AssetImage } from '../visual/AssetImage'
import { useVisual } from '../visual/use-visual'
import { useIntelligence } from '../script/use-intelligence'
import { adoptedReferences, assetLabels, resolveCreatorAsset, roleLabels } from './creator-assets'
import type { CreatorAsset } from './creator-assets'

const sourceLabels: Record<AssetVersion['sourceType'], string> = { imported: '本地导入', generated: '生成', edited: '编辑', derived: '派生', reference: '参考' }

function SourceDetails({ version }: { version: AssetVersion }) {
  const [lineage, setLineage] = useState<Lineage | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void window.desktop!.workspace.request({ action: 'compatibility', command: { op: 'lineage', projectId: version.projectId, versionId: version.id } })
      .then((result) => {
        if (!result.ok) throw new Error(result.message)
        if (active) setLineage(lineageSchema.parse(result.data))
      })
      .catch(() => { if (active) setError('来源详情暂不可用') })
    return () => { active = false }
  }, [version.id, version.projectId])
  return <details className="creator-source-details"><summary>来源详情</summary><dl><dt>来源方式</dt><dd>{lineage?.source ?? (error ? '来源暂不可用' : '核验中…')}</dd><dt>工具</dt><dd>{version.provider || '—'}</dd><dt>模型</dt><dd>{version.model || '—'}</dd><dt>生成时间</dt><dd>{new Date(version.createdAt).toLocaleString('zh-CN')}</dd><dt>费用</dt><dd>{version.cost.actualCost === null ? '未记录' : `${version.cost.currency ?? ''} ${version.cost.actualCost}`}</dd></dl>
    <details><summary>技术信息</summary>{error && <p role="alert">{error}</p>}{lineage ? <><p>{lineage.source}</p><dl>{lineage.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl><pre>{JSON.stringify({ links: lineage.links, prompt: version.prompt, promptVersion: version.promptVersion, metadata: version.metadata }, null, 2)}</pre></> : <p>正在读取来源…</p>}</details>
  </details>
}

export function AssetsInspector({ target }: { target: CreatorAsset }) {
  const { state, reload } = useWorkspace()
  const { navigateCreator } = useCreator()
  const toast = useToast()
  const visual = useVisual(target.projectId)
  const intelligence = useIntelligence(target.projectId)
  const [error, setError] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [compare, setCompare] = useState<string[]>([])
  const entities = state.workspace?.entities ?? []
  const versions = visual.snapshot?.versions ?? []
  const view = resolveCreatorAsset(target, entities, versions, intelligence.snapshot.tasks)
  const assets = new Map(entities.filter((entity): entity is Asset => entity.kind === 'asset').map((entity) => [entity.id, entity]))
  const selected = view.candidates.find((version) => version.id === selectedVersionId) ?? view.candidates[0]
  const blocked = visual.busy || state.editorStatus !== 'saved'
  const act = async (action: () => Promise<void>) => {
    setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重新载入后重试') }
  }
  const review = (version: AssetVersion, status: 'approved' | 'rejected') => void act(async () => {
    if (entities.some((entity) => (entity.kind === 'character' || entity.kind === 'location' || entity.kind === 'prop') && entity.visualReferences.some((ref) => ref.primary && ref.assetId === version.assetId)))
      throw new Error('此素材已是主参考；请在版本历史中使用旧版审核入口')
    await visual.execute({ operation: 'version.review', projectId: target.projectId, id: version.id, expectedRevision: version.revision, status, targetId: null, targetRevision: null })
    await reload()
    toast('success', status === 'approved' ? '候选已批准，可设为主参考' : '候选已拒绝，历史仍保留')
  })
  const adopt = (version: AssetVersion) => void act(async () => {
    const asset = assets.get(version.assetId)
    if (version.status !== 'approved' || asset?.approvedVersionId !== version.id) throw new Error('请先批准该候选版本')
    await visual.execute({ operation: 'references.save', projectId: target.projectId, id: target.id, expectedRevision: target.revision, references: adoptedReferences(target, asset.id) })
    await reload()
    toast('success', '已设为主参考')
  })
  const importReference = () => void act(async () => {
    const ids = await visual.execute({ operation: 'asset.import', projectId: target.projectId, assetId: null, targetId: target.id })
    await reload()
    if (Array.isArray(ids) && ids.length) toast('success', `已导入 ${ids.length} 张候选参考图`)
  })
  const removeReference = (assetId: string, role: string) => void act(async () => {
    await visual.execute({ operation: 'references.save', projectId: target.projectId, id: target.id, expectedRevision: target.revision, references: target.visualReferences.filter((ref) => ref.assetId !== assetId || ref.role !== role) })
    await reload()
  })
  const bibleSummary = Object.entries(target.bible).filter(([, value]) => Array.isArray(value) ? value.length : Boolean(value)).slice(0, 4)
  return <div className="creator-asset-inspector" aria-label={`${assetLabels[target.kind]}详情`}>
    {(error || visual.error || intelligence.error) && <p className="error" role="alert">{error || visual.error || intelligence.error}</p>}
    <section><h3>{assetLabels[target.kind]}设定</h3><p>{target.description || '暂无简介，可在设定中补充。'}</p>{target.kind === 'character' && <p>外观：{target.appearance || '未填写'}</p>}{bibleSummary.map(([key, value]) => <p key={key}>{bibleLabels[key] ?? key}：{Array.isArray(value) ? value.join('、') : String(value)}</p>)}<details><summary>查看 / 编辑设定</summary><BibleEditor key={`${target.id}:${target.revision}`} entity={target} entities={entities} /></details></section>
    <section><h3>当前主参考</h3>{view.primaryVersion ? <><AssetImage projectId={target.projectId} versionId={view.primaryVersion.id} alt={`${target.name}主参考`} /><p>已确认 · {roleLabels[view.primaryReference!.role]}</p><SourceDetails key={view.primaryVersion.id} version={view.primaryVersion} /></> : <p>{view.brokenPrimary ? '主参考暂不可用，请在历史记录中检查引用。' : '尚未设置主参考。批准候选后可明确设为主参考。'}</p>}
      <div className="actions"><button disabled={blocked} onClick={importReference}>导入参考图</button><button onClick={() => navigateCreator('generation', { targetKind: target.kind, targetId: target.id, assetId: target.id, shotId: undefined })}>生成参考图 →</button></div>
    </section>
    {target.visualReferences.some((ref) => !ref.primary) && <section><h3>其它参考图</h3>{target.visualReferences.filter((ref) => !ref.primary).map((ref) => {
      const asset = assets.get(ref.assetId)
      const version = versions.find((v) => v.id === asset?.approvedVersionId && v.assetId === asset?.id && v.status === 'approved')
      return <div key={`${ref.assetId}:${ref.role}`}><p>{roleLabels[ref.role]} · {asset?.name ?? '素材暂不可用'}</p>{version && <AssetImage projectId={target.projectId} versionId={version.id} alt={asset!.name} />}<button disabled={blocked} onClick={() => removeReference(ref.assetId, ref.role)}>移除参考</button></div>
    })}</section>}
    <section><h3>候选版本 <small>{view.candidates.length}</small></h3>{!view.candidates.length ? <p>暂无可审核候选。可导入参考图，或前往生成。</p> : <><div className="creator-candidate-strip">{view.candidates.map((version) => <button className="creator-candidate-thumb" key={version.id} aria-pressed={selected?.id === version.id} onClick={() => setSelectedVersionId(version.id)}><AssetImage projectId={target.projectId} versionId={version.id} alt={`候选 v${version.versionNumber}`} /><small>v{version.versionNumber} · {version.status === 'approved' ? '已批准' : '待审核'}</small></button>)}</div>{selected && <div className="creator-candidate-detail"><AssetImage projectId={target.projectId} versionId={selected.id} thumbnail={false} alt={`${target.name}候选大图`} /><p>版本 {selected.versionNumber} · {sourceLabels[selected.sourceType]} · {selected.width}×{selected.height}</p><div className="actions"><button onClick={() => setCompare((old) => old.includes(selected.id) ? old.filter((id) => id !== selected.id) : [...old.slice(-1), selected.id])}>对比</button>{selected.status === 'draft' ? <><button disabled={blocked} onClick={() => review(selected, 'approved')}>批准</button><button disabled={blocked} onClick={() => review(selected, 'rejected')}>拒绝</button></> : <button className="primary" disabled={blocked || assets.get(selected.assetId)?.approvedVersionId !== selected.id} onClick={() => adopt(selected)}>设为主参考</button>}</div><SourceDetails key={selected.id} version={selected} /></div>}{compare.length > 0 && <div className="creator-candidate-compare" aria-label="候选对比">{compare.map((id) => {
      const version = view.candidates.find((item) => item.id === id)
      return version ? <figure key={id}><AssetImage projectId={target.projectId} versionId={id} thumbnail={false} alt={`对比候选 v${version.versionNumber}`} /><figcaption>候选 v{version.versionNumber}</figcaption></figure> : null
    })}</div>}</>}</section>
    {view.history.length > 0 && <section><details><summary>版本历史（{view.history.length}）</summary><p>当前主参考所在素材的其它版本不进入此处的批准/采用流程。可从高级素材库使用旧版审核。</p>{view.history.map((version) => <p key={version.id}>v{version.versionNumber} · {version.status} · {sourceLabels[version.sourceType]}</p>)}</details></section>}
  </div>
}
