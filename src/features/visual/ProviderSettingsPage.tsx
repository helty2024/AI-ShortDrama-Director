import { useState } from 'react'
import { useWorkspace } from '../workspace/state'
import { useVisual } from './use-visual'
import { ToolReadinessPanel } from '../operations/ProvenancePanel'
import { ProductionSettings } from '../video/ProductionSettings'
import { AIServiceCards } from './ServiceCards'
import { OperationsPage } from '../operations/OperationsPage'
import type { ProviderSettings, VisualSnapshot, VisualCommand } from '../../shared/visual'

const tabs = ['基本设置', 'AI 服务', '高级与诊断'] as const
export function ProviderSettingsPage() {
  const [tab, setTab] = useState<typeof tabs[number]>('AI 服务')
  const { state, navigate } = useWorkspace()
  const projectId = state.workspace?.project.id
  const [advanced, setAdvanced] = useState('')
  return <section className="settings-page" aria-label="设置">
    <header className="settings-heading"><div><p className="settings-eyebrow">让创作顺畅开始</p><h1>设置</h1><p>连接创作服务，按需要调整当前项目。</p></div><button onClick={() => navigate(projectId ? 'story' : 'projects')}>返回{projectId ? '创作' : '项目'}</button></header>
    <nav className="settings-tabs" role="tablist" aria-label="设置分类">{tabs.map(name => <button key={name} role="tab" aria-selected={tab === name} onClick={() => { setTab(name); setAdvanced('') }}>{name}</button>)}</nav>
    <div role="tabpanel" aria-label={tab}>
      {tab === 'AI 服务' && <AIServiceCards />}
      {tab === '基本设置' && <section className="settings-panel"><h2>当前项目的创作偏好</h2><p>这些设置只影响当前项目，不会改变其他项目或服务连接。</p>{projectId ? <ProjectPreferences projectId={projectId} /> : <p className="settings-note">请先返回项目列表，选择或创建项目，再调整创作偏好。AI 服务连接可以直接在这里配置。</p>}</section>}
      {tab === '高级与诊断' && <>
        <p>按需要打开专业配置或维护工具。测试工具只用于模拟流程测试。</p>
        <div className="settings-advanced-nav">{['连接诊断', '测试工具', '项目专业配置', '维护与数据', '旧版兼容入口'].map(name => <button key={name} aria-pressed={advanced === name} onClick={() => setAdvanced(advanced === name ? '' : name)}>{name}</button>)}</div>
        {advanced === '连接诊断' && <div className="settings-panel diagnostic-scroll"><ToolReadinessPanel /></div>}
        {advanced === '测试工具' && <section className="settings-panel" aria-label="测试工具"><h2>用于模拟流程测试</h2><p>Alpha 内置测试图像与测试视频，不连接真实供应商，不消费积分。生成页会明确标记“测试视频 / 模拟生成”，批准候选后仍需单独采用。</p><ul><li>Mock Image：旧版图像流程测试。</li><li>Mock Video：旧版视频流程测试。</li><li>Reference Image / Video：当前 Alpha 主流程模拟工具。</li></ul><details><summary>模拟工具原始状态</summary><ToolReadinessPanel testTools /></details><button onClick={() => navigate(projectId ? 'generation' : 'projects')}>{projectId ? '前往生成，运行模拟流程' : '选择项目后开始模拟流程'}</button>{projectId && <details><summary>旧版模拟与项目图像参数</summary><ProjectAdvanced projectId={projectId} /><ProductionSettings projectId={projectId} testTools /></details>}</section>}
        {advanced === '项目专业配置' && <section className="settings-panel"><h2>项目专业配置</h2><p>旧版视频连接与项目生产诊断。保存配置不代表真实生成已开放。</p>{projectId ? <ProductionSettings projectId={projectId} /> : <p>请先选择项目，再配置项目专属参数。</p>}</section>}
        {advanced === '维护与数据' && <div className="settings-panel"><OperationsPage /></div>}
        {advanced === '旧版兼容入口' && <section className="settings-panel creator-compat-links" aria-label="旧版兼容入口"><h2>旧版兼容入口</h2>{projectId ? (['characters', 'locations', 'props', 'assets', 'production', 'legacyGeneration'] as const).map(module => <button key={module} onClick={() => navigate(module)}>{{characters:'角色',locations:'场景',props:'道具',assets:'素材库',production:'生产看板',legacyGeneration:'旧版生成'}[module]}</button>) : <p>请先选择项目。</p>}</section>}
      </>}
    </div>
  </section>
}
function ProjectPreferences({ projectId }: { projectId: string }) {
  const visual = useVisual(projectId)
  const [message, setMessage] = useState('')
  if (!visual.snapshot) return <p>正在读取项目设置…</p>
  return <PreferencesForm key={projectId} settings={visual.snapshot.settings} busy={visual.busy} save={async settings => { try { await visual.execute({operation:'settings.save',projectId,settings}); setMessage('项目偏好已保存') } catch { setMessage('保存失败，请重试。') } }} message={message} />
}
function PreferencesForm({settings: original, busy, save, message}: {settings: ProviderSettings;busy:boolean;save:(s:ProviderSettings)=>Promise<void>;message:string}) {
  const [settings,setSettings] = useState(original)
  return <form className="settings-form" onSubmit={e=>{e.preventDefault();void save(settings)}}><label>画面风格<input value={settings.style} onChange={e=>setSettings({...settings,style:e.target.value})} /></label><p>这些图像偏好保留给兼容制作流程。Alpha 模拟生成使用固定演示素材，不改变画面；故事的题材、风格与画幅可在故事页调整。</p><div className="settings-field-row">{(['width','height'] as const).map(key=><label key={key}>{key==='width'?'图像宽度':'图像高度'}<input type="number" min="64" max="2048" step="8" value={settings[key]} onChange={e=>setSettings({...settings,[key]:Number(e.target.value)})} /></label>)}</div><button className="primary" disabled={busy}>保存项目偏好</button>{message && <p role="status">{message}</p>}</form>
}
function ProjectAdvanced({projectId}:{projectId:string}) {
  const visual = useVisual(projectId)
  return <>{visual.error && <p role="alert">{visual.error}</p>}{visual.snapshot && <SettingsForm projectId={projectId} snapshot={visual.snapshot} execute={visual.execute} />}</>
}
function SettingsForm({
  projectId,
  snapshot,
  execute,
}: {
  projectId: string
  snapshot: VisualSnapshot
  execute: (command: VisualCommand) => Promise<unknown>
}) {
  const [settings, setSettings] = useState(snapshot.settings),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const change = <K extends keyof ProviderSettings>(
    key: K,
    value: ProviderSettings[K],
  ) => setSettings({ ...settings, [key]: value })
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      const result = await action()
      setMessage(typeof result === 'string' ? result : '配置已保存')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  const template = snapshot.templates.find((t) => t.id === settings.templateId)
  const variables = [
    ...new Set(
      [
        ...JSON.stringify(template?.workflow).matchAll(
          /\{\{([a-zA-Z0-9_]+)\}\}/g,
        ),
      ].map((m) => m[1]),
    ),
  ]
  return (
    <form
      className="provider-settings"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() =>
          execute({ operation: 'settings.save', projectId, settings }),
        )
      }}
    >
      <label>
        默认图像 Provider
        <select
          value={settings.provider}
          onChange={(e) =>
            change('provider', e.target.value as ProviderSettings['provider'])
          }
        >
          <option value="mock-image">Mock Image</option>
          <option value="comfyui">ComfyUI</option>
        </select>
      </label>
      <label>
        ComfyUI Base URL
        <input
          required
          value={settings.baseUrl}
          onChange={(e) => change('baseUrl', e.target.value)}
        />
      </label>
      <label>
        默认 workflow template
        <select
          value={settings.templateId}
          onChange={(e) => change('templateId', e.target.value)}
        >
          {snapshot.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <p>模板变量：{variables.join('、') || '没有变量槽位'}</p>
      <details>
        <summary>工作流 JSON</summary>
        <pre>{JSON.stringify(template?.workflow, null, 2)}</pre>
      </details>
      <label>
        Checkpoint 文件名
        <input
          value={settings.checkpoint}
          placeholder="测试连接查看本机模型，不预设 Checkpoint"
          onChange={(e) => change('checkpoint', e.target.value)}
        />
      </label>
      <div className="asset-filters">
        {(['width', 'height', 'steps', 'cfg', 'seed'] as const).map((key) => (
          <label key={key}>
            {
              {
                width: '默认宽度',
                height: '默认高度',
                steps: 'Steps',
                cfg: 'CFG',
                seed: 'Seed',
              }[key]
            }
            <input
              type="number"
              required
              min={
                key === 'width' || key === 'height'
                  ? 64
                  : key === 'steps'
                    ? 1
                    : 0
              }
              max={
                key === 'width' || key === 'height'
                  ? 2048
                  : key === 'steps'
                    ? 150
                    : key === 'cfg'
                      ? 30
                      : 2147483647
              }
              step={
                key === 'width' || key === 'height'
                  ? 8
                  : key === 'cfg'
                    ? 0.5
                    : 1
              }
              value={settings[key]}
              onChange={(e) => change(key, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <label>
        Seed 模式
        <select
          value={settings.seedMode}
          onChange={(e) =>
            change('seedMode', e.target.value as ProviderSettings['seedMode'])
          }
        >
          <option value="fixed">固定</option>
          <option value="random">每次生成随机（重试保持原 seed）</option>
        </select>
      </label>
      <label>
        风格
        <input
          value={settings.style}
          onChange={(e) => change('style', e.target.value)}
        />
      </label>
      <div className="actions">
        <button className="primary" disabled={busy}>
          保存设置
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await execute({ operation: 'settings.save', projectId, settings })
              return execute({ operation: 'health', projectId })
            })
          }
        >
          保存并测试连接
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() => execute({ operation: 'workflow.import', projectId }))
          }
        >
          导入 workflow JSON
        </button>
      </div>
      <p>
        导入 ComfyUI API 格式 JSON；未知节点由 ComfyUI
        校验，本应用不执行其中脚本。reference_image（及
        _2、_3…）会上传已批准参考图；标准模板没有参考图节点。
      </p>
      {message && <p role="status">{message}</p>}
    </form>
  )
}
