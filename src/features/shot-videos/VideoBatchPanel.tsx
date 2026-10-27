import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { Entity, Shot } from '../../shared/domain'
import { batchSchema, type BatchGenerationGroup } from '../../shared/video'
import type { VideoBatchCommand } from '../../shared/video-batch'
import { assetVersionSchema, type AssetVersion } from '../../shared/visual'
import { ShotVideoPlayer } from './ShotVideoPlayer'
import { VideoTimeline } from './VideoTimeline'

async function command(command: VideoBatchCommand) {
  const response = await window.desktop!.workspace.request({ action: 'videoBatch', command })
  if (!response.ok) throw new Error(response.message)
  return response.data
}
const states = { queued: '等待调度', dispatching: '准备中', running: '生成/回收中', succeeded: '待审看', failed: '失败，可人工返工', unknown: '提交未知，禁止补发' }
export function VideoBatchPanel({ projectId, shots, entities, versions, onShot, onChange }: {
  projectId: string; shots: Shot[]; entities: Entity[]; versions: AssetVersion[]; onShot: (shot: Shot) => void; onChange: () => Promise<unknown>
}) {
  const [purpose, setPurpose] = useState<'narrative-production' | 'technical-test'>('narrative-production')
  const [selected, setSelected] = useState<string[]>([])
  const [sceneId, setSceneId] = useState(shots.at(-1)?.sceneId ?? '')
  const [reference, setReference] = useState('')
  const [batches, setBatches] = useState<BatchGenerationGroup[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [budgetId, setBudgetId] = useState(''), [points, setPoints] = useState(''), [money, setMoney] = useState(''), [accepted, setAccepted] = useState(false)
  const [exportVersion, setExportVersion] = useState<AssetVersion | null>(null)
  const [timelineId, setTimelineId] = useState('')
  const scenes = entities.filter(e => e.kind === 'scene')
  const scope = shots.filter(s => s.sceneId === sceneId && s.plan)
  const references = versions.filter(v => v.status === 'approved' && v.mimeType.startsWith('image/') && entities.some(e => e.kind === 'character' && (v.metadata.targetId === e.id || e.visualReferences.some(r => r.assetId === v.assetId))))
  const refresh = async () => setBatches(z.array(batchSchema).parse(await command({ op: 'list', projectId })))
  useEffect(() => {
    let live = true
    const load = async () => { try { const result = z.array(batchSchema).parse(await command({ op: 'list', projectId })); if (live) setBatches(result) } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : '批次读取失败') } }
    void load(); const timer = setInterval(() => void load(), 3000)
    return () => { live = false; clearInterval(timer) }
  }, [projectId])
  // Candidate and adoption UI uses the same persisted versions/tasks as the queue.
  const resultKey = batches.flatMap(b => b.nativeVideo!.items.map(i => `${i.taskId}:${i.status}`)).join('|')
  useEffect(() => { void onChange() }, [resultKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await operation(); await refresh(); await onChange() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败；请通过批次与任务 ID 定位') }
    finally { setBusy(false) }
  }
  const quote = batches.find(b => b.id === budgetId)
  return <section className="video-batch-panel" aria-label="真实批量视频生产">
    <h2>批量生产</h2><label>生产用途<select value={purpose} onChange={e => setPurpose(e.target.value as typeof purpose)}><option value="narrative-production">叙事生产（角色/场景主参考＋批准关键帧）</option><option value="technical-test">独立文生视频技术测试（不验收叙事一致性）</option></select></label><p>选择正式分镜 → 整批确认预算 → 按能力额度排队生成 → 下方审看、批准并采用 → 按镜号合成。失败只接受人工返工；未知状态不补发。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><label>场次 <select value={sceneId} onChange={e => { setSceneId(e.target.value); setSelected([]) }}>{scenes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <button disabled={busy || !scope.length} onClick={() => setSelected([...scope].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.order - a.order).slice(0, 7).map(s => s.id))}>选择当前场次最新 7 镜头</button>
      <button onClick={() => setSelected([])}>清空选择</button></div>
    <div className="video-batch-selection">{scope.map(s => <label key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} />镜 {s.plan!.shotNumber} · {s.name} · {s.durationSeconds}s <small>{s.id}</small></label>)}</div>
    <label>角色主参考核对（不能代替关键帧） <select value={reference} onChange={e => setReference(e.target.value)}><option value="">使用各镜头已批准关键帧；缺失时阻断叙事生产</option>{references.map(v => <option key={v.id} value={v.id}>{entities.find(e => e.id === v.metadata.targetId)?.name ?? '人物参考'} · v{v.versionNumber} · {v.id.slice(0, 8)}</option>)}</select></label>
    <p>输入模式由已配置适配器的能力决定。角色主参考不能冒充分镜关键帧；跨镜头一致性仍须人工审看。未批准图片不会上传。</p>
    <button className="primary" disabled={busy || !selected.length} onClick={() => void act(async () => { await command({ op: 'prepare', projectId, shotIds: selected, referenceVersionId: reference || null, purpose }); setSelected([]) })}>准备 {selected.length} 镜头批次（不收费）</button>
    {batches.map(batch => { const n = batch.nativeVideo!, total = n.items.reduce((sum, i) => sum + i.points, 0)
      const adopted = n.items.every(i => shots.find(s => s.id === i.shotId)?.confirmedVideoAssetVersionId)
      return <article className="video-batch-card" key={batch.id} data-batch-id={batch.id}>
        <h3>{batch.name} · {({ 'awaiting-budget': '待整批授权', active: '运行中', paused: '已暂停', completed: '队列结束' })[n.state]}</h3>
        <p>{n.items.every(i => i.input.purpose === 'technical-test') ? '独立技术测试：生成成功不代表人物一致性或叙事生产验收通过。' : '叙事生产：提交前仍须核验角色/场景主参考、批准关键帧和费用授权。'}</p>
        <p>{n.toolId} / {n.model} · {n.items.length} 次生成 · {n.items.reduce((sum, i) => sum + i.input.durationSeconds, 0)} 秒 · 预算参考 {n.quoteKnown === false ? '未知' : total} {n.budgetCurrency ?? '历史计费单位'} · 并发上限 {n.concurrency} · 人民币费用未知</p>
        <small>批次 {batch.id} · r{n.revision} · {n.executionAllowed ? '本机批次' : '恢复的只读历史，授权不迁移'}{n.authorizedAt && ` · 已授权上限 ${n.maxPoints} {n.budgetCurrency ?? '历史计费单位'} / ${n.maxCalls} 次 · 人民币费用待核实${n.maxCostMicro === null ? '' : ` · 可选记账预留 ¥${n.maxCostMicro / 1e6}`}`}</small>
        <table><thead><tr><th>镜号</th><th>镜头及关联</th><th>模式 / 时长</th><th>状态 / 定位</th><th>操作</th></tr></thead><tbody>{n.items.map(i => { const shot = shots.find(s => s.id === i.shotId); return <tr key={i.shotId}>
          <td>{i.shotNumber}</td><td>{i.name}<small>{[shot?.locationId, ...(shot?.characterIds ?? []), ...(shot?.propIds ?? [])].filter(Boolean).map(id => entities.find(e => e.id === id)?.name ?? id).join('、')}</small><small>{i.shotId}</small></td>
          <td>{i.input.mode} · {i.input.durationSeconds}s</td><td>{states[i.status]}{i.error && <p>{i.error}</p>}<small>{i.taskId ?? '尚未提交'}</small><small>{i.recordId}</small></td>
          <td><button onClick={() => shot && onShot(shot)}>审看/选片</button>{i.status === 'failed' && <button disabled={busy} onClick={() => void act(() => command({ op: 'recoverOutput', projectId, batchId: batch.id, shotId: i.shotId }))}>查询回收原结果（不重生成）</button>}{['failed', 'succeeded'].includes(i.status) && <button disabled={busy} onClick={() => void act(() => command({ op: 'rework', projectId, batchId: batch.id, shotId: i.shotId }))}>单镜头返工预览（需新预算）</button>}</td>
        </tr> })}</tbody></table>
        <div className="actions">{n.state === 'awaiting-budget' && n.executionAllowed && <button disabled={busy} onClick={() => { setBudgetId(batch.id); setPoints(n.quoteKnown === false ? '' : String(total)); setMoney(''); setAccepted(false) }}>审核整批范围与预算</button>}
          {n.state === 'active' && <button disabled={busy} onClick={() => void act(() => command({ op: 'pause', projectId, batchId: batch.id }))}>暂停后续提交</button>}
          {n.state === 'paused' && n.authorizedAt && n.executionAllowed && <button disabled={busy} onClick={() => void act(() => command({ op: 'resume', projectId, batchId: batch.id }))}>恢复原批次</button>}
          <button disabled={busy || !adopted || timelineId === batch.id} onClick={() => void act(async () => setExportVersion(assetVersionSchema.parse(await command({ op: 'export', projectId, batchId: batch.id }))))}>按已保存区间合成并导出 MP4</button>
          <button disabled={busy || !adopted} onClick={() => setTimelineId(timelineId === batch.id ? '' : batch.id)}>编辑/预览成片时间线</button>
          {n.exportVersionIds.length > 0 && <button disabled={busy} onClick={() => { const v = versions.find(v => v.id === n.exportVersionIds.at(-1)); if (v) setExportVersion(v) }}>预览已导出成片</button>}
        </div>
        {timelineId === batch.id && adopted && <VideoTimeline key={`${batch.id}:${JSON.stringify(n.timeline)}`} shots={shots.filter(s => n.items.some(i => i.shotId === s.id))} versions={versions} initial={n.timeline} busy={busy} onSave={clips => act(() => command({ op: 'saveTimeline', projectId, batchId: batch.id, expectedRevision: n.revision, clips }))} onExport={clips => act(async () => { await command({ op: 'saveTimeline', projectId, batchId: batch.id, expectedRevision: n.revision, clips }); setExportVersion(assetVersionSchema.parse(await command({ op: 'export', projectId, batchId: batch.id }))) })} />}
      </article>
    })}
    {quote && <section className="video-batch-budget" aria-label="整批收费授权"><h3>一次确认整批预算</h3>
      <p>范围仅限上方批次 {quote.id} 的 {quote.nativeVideo!.items.length} 个 UUID；固定 {quote.nativeVideo!.toolId} / {quote.nativeVideo!.model}，使用下方冻结参数；不生成图片，不切换供应商，不自动重试。首帧若已选择，将上传到此供应商。</p>
      <label>{quote.nativeVideo!.budgetCurrency} 预算上限 <input type="number" min={1} value={points} onChange={e => setPoints(e.target.value)} /></label>
      <label>本地人民币记账预留（可选，元） <input type="number" min="0.01" step="0.01" value={money} onChange={e => setMoney(e.target.value)} /></label>
      <p>{quote.nativeVideo!.quoteBasis ?? '历史报价仅供追溯'}。本地预算不能替代供应商硬限额。实际费用未知，不等于免费；未知提交继续占用预算。</p>
      <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />我已审核镜头范围、提示词与上传许可，接受人民币费用未知，并授权在以上计费单位预算上限内执行这批请求（24 小时有效）</label>
      <details><summary>查看固定生成描述与首帧</summary>{quote.nativeVideo!.items.map(i => <div key={i.shotId}><strong>镜 {i.shotNumber} / {i.shotId} / {i.input.resolution.width}×{i.input.resolution.height} / {i.input.fps}fps / {i.input.durationSeconds}s / 首帧 {i.input.firstFrameAssetVersionId ?? '无'}</strong><pre>{i.input.prompt}</pre></div>)}</details>
      <button className="primary" disabled={busy || !accepted || (Boolean(money) && !(Number(money) > 0)) || !(Number(points) > 0)} onClick={() => void act(async () => { await command({ op: 'authorize', projectId, batchId: quote.id, expectedRevision: quote.nativeVideo!.revision, maxPoints: Number(points), maxCostMicro: money ? Math.round(Number(money) * 1e6) : null, allowUnknownCost: true }); setBudgetId('') })}>授权并启动整批真实生成</button><button onClick={() => setBudgetId('')}>暂不授权</button>
    </section>}
    {exportVersion && <section><h3>成片预览 · {exportVersion.duration}s · {exportVersion.width}×{exportVersion.height}</h3><ShotVideoPlayer version={exportVersion} label="连续成片" onSource={() => {}} /></section>}
  </section>
}
