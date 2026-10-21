import { useEffect, useState } from 'react'
import { useWorkspace } from '../workspace/state'
import { useCreator } from '../../components/creator-shell/creator-context'
import { skillExperimentSnapshotSchema, type SkillExperimentCommand, type SkillStage } from '../../shared/skill-experiment'
import './skill-experiment.css'

const labels = { script: '剧本建议', director: '导演分镜建议', 'video-prompt': '视频提示词' }
export function SkillExperimentPanel({ stage }: { stage: SkillStage }) {
  const { state: workspace } = useWorkspace(), context = useCreator()
  const projectId = workspace.workspace?.project.id, entities = workspace.workspace?.entities ?? []
  const [state, setState] = useState<ReturnType<typeof skillExperimentSnapshotSchema.parse>>({ enabled: false, experiments: [] })
  const [sceneId, setSceneId] = useState(''), [target, setTarget] = useState<'generic' | 'seedance-2.0'>('generic')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [amount, setAmount] = useState(''), [approved, setApproved] = useState(false)
  const send = async (command: SkillExperimentCommand) => {
    const result = await window.desktop!.workspace.request({ action: 'skillExperiment', command })
    if (!result.ok) throw new Error(result.message)
    const parsed = skillExperimentSnapshotSchema.parse(result.data); setState(parsed); return parsed
  }
  // IPC synchronizes persisted experiment settings, rather than deriving UI state.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (projectId) void send({ op: 'list', projectId }).catch(e => setError(String(e))) }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const scenes = entities.filter(e => e.kind === 'scene')
  const selectedScene = sceneId || context.sceneId || scenes[0]?.id || ''
  const shots = entities.filter(e => e.kind === 'shot' && e.sceneId === selectedScene && e.plan).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 7).sort((a, b) => a.kind === 'shot' && b.kind === 'shot' ? a.order - b.order : 0)
  const latest = state.experiments.find(e => e.stage === stage)
  const bundle = latest ? state.experiments.filter(e => e.inputHash === latest.inputHash && JSON.stringify(e.modelSnapshot) === JSON.stringify(latest.modelSnapshot)).slice(0, 3) : []
  const act = async (operation: () => Promise<unknown>) => { setBusy(true); setError(''); try { await operation() } catch (e) { setError(e instanceof Error ? e.message : '实验操作失败') } finally { setBusy(false) } }
  if (!projectId) return null
  return <details className="skill-experiment"><summary>seedance-20 Skill 实验 · {labels[stage]}</summary>
    <section aria-label="seedance-20 Skill 实验">
      <label><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e => void act(() => send({ op: 'toggle', projectId, enabled: e.target.checked }))} />启用 seedance-20 Skill</label>
      <p>只影响三个实验建议入口，普通制作流程保持原行为。仅注册 seedance-20 v6.7.0；源码固定为 4668457e560eee06e95d7fcfdf441c8c0bba802e（MIT）。所有建议均不写入正式剧本、分镜或素材。</p>
      <label>实验场次<select value={selectedScene} onChange={e => setSceneId(e.target.value)}>{scenes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>提示词目标<select value={target} onChange={e => setTarget(e.target.value as typeof target)}><option value="generic">通用导演建议（H3 等非 Seedance）</option><option value="seedance-2.0">Seedance 2.0 离线编译实验</option></select></label>
      <p>范围：本场次最新 {shots.length} 条正式分镜；每项 UUID 如下，历史镜头不自动并入。</p><ul>{shots.map(s => <li key={s.id}>{s.name} · {s.id}</li>)}</ul>
      <button disabled={busy || !selectedScene || !shots.length || workspace.editorStatus !== 'saved'} onClick={() => void act(() => send({ op: 'prepare', projectId, stage, sceneId: selectedScene, shotIds: shots.map(s => s.id), target }))}>准备三个环节离线对比（不收费）</button>
      {error && <p role="alert">{error}</p>}
      {latest && <>
        <p>本次显示：{state.enabled ? '开启 Skill' : '关闭 Skill'} · 状态 {latest.status} · 模型 {String(latest.modelSnapshot.model ?? '未配置真实文本服务')} · 输入指纹 {latest.inputHash}</p>
        <div className="skill-comparison"><article><h3>原{labels[stage]} / 历史基线</h3><p>历史结果不是相同模型配置的受控 A/B；正式数据仅作为输入，不自动改写。</p><pre>{JSON.stringify(latest.historicalBaseline, null, 2)}</pre></article>
          <article><h3>Skill {labels[stage]}</h3><p>以下为离线加载规则，不是 LLM 优化输出；尚不能证明模型效果改善。</p>{state.enabled ? <ol>{latest.offlineAdvice.map((text, i) => <li key={i}>{text}<code>{latest.requests[1].trace?.ruleIds[i]}</code></li>)}</ol> : <p>Skill 已关闭，使用原有基础提示词，不注入 Skill 规则。</p>}</article></div>
        <details><summary>真实模型输出前后对比（原始结构化结果）</summary><div className="skill-comparison">{[false, true].map(enabled => { const attempt = latest.attempts.find(a => a.enabled === enabled); return <article key={String(enabled)}><h3>{enabled ? 'Skill 开启' : 'Skill 关闭'}</h3><p>{attempt?.status ?? '尚未执行真实 LLM 请求'}</p><pre>{attempt?.rawOutput ?? '无真实模型输出，效果待验证'}</pre>{attempt?.error && <p>{attempt.error}</p>}</article> })}</div></details>
        <details><summary>最终语言模型提示词与 Skill 溯源</summary><p>关闭 {latest.requests[0].bytes} 字节；开启 {latest.requests[1].bytes} 字节；同一输入、同一配置、同一 JSON Schema。</p><p>最终提示词指纹：{latest.requests[state.enabled ? 1 : 0].fingerprint}</p><pre>{JSON.stringify(latest.requests[state.enabled ? 1 : 0].trace, null, 2)}</pre><pre>{latest.requests[state.enabled ? 1 : 0].system}</pre></details>
        <details><summary>真实 LLM 对比预算（本轮未授权）</summary><p>三环节 × 开/关各一次，共 6 次真实文本请求；每次输出上限 4000 tokens；费用未知，不等于 0。不会调用图片或视频接口，不重试、不切模型。任一失败或未知即停止整组。该金额仅为本地授权，未知供应商费用不能保证封顶。</p>
          <label>已另行批准的整组记账上限（CNY）<input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />我已另行确认这 6 次文本调用范围及预算，接受费用未知</label>
          <button disabled={busy || !approved || !(Number(amount) > 0) || bundle.length !== 3 || bundle.some(e => e.status !== 'offline') || latest.modelSnapshot.real !== true} onClick={() => void act(async () => { await send({ op: 'runComparisons', projectId, ids: bundle.map(e => e.id), confirmed: true, maxRequests: 6, currency: 'CNY', maxCostMicro: Math.round(Number(amount) * 1e6), allowUnknownCost: true }); setApproved(false) })}>按另行授权执行整组真实文本对比</button>
        </details>
      </>}
    </section>
  </details>
}
