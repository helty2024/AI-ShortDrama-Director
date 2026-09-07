import { useState } from 'react'
import { useWorkspace } from '../workspace/state'
import { useVisual } from './use-visual'
import type {
  ProviderSettings,
  VisualSnapshot,
  VisualCommand,
} from '../../shared/visual'
export function ProviderSettingsPage() {
  const { state } = useWorkspace()
  return state.workspace ? (
    <Settings projectId={state.workspace.project.id} />
  ) : (
    <>
      <h1>Provider 设置</h1>
      <p>请先打开项目。</p>
    </>
  )
}
function Settings({ projectId }: { projectId: string }) {
  const visual = useVisual(projectId)
  return (
    <>
      <h1>Provider 设置</h1>
      <p>
        配置存于主进程数据库，仅支持图像生成。本地 ComfyUI
        需要已安装模型和相应节点。
      </p>
      {visual.error && (
        <p role="alert" className="error">
          {visual.error}
        </p>
      )}
      {visual.snapshot && (
        <SettingsForm
          key={projectId}
          projectId={projectId}
          snapshot={visual.snapshot}
          execute={visual.execute}
        />
      )}
    </>
  )
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
