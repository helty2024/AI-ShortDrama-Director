import { useEffect, useState } from 'react'
import { lineageSchema, readinessSchema, type Lineage, type Readiness } from '../../shared/compatibility'

export function ProvenancePanel({ projectId, versionId, recordId, revision }: { projectId: string; versionId?: string; recordId?: string; revision?: number | string }) {
  const [open, setOpen] = useState(false), [value, setValue] = useState<Lineage | null>(null), [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    void window.desktop!.workspace.request({ action: 'compatibility', command: versionId
      ? { op: 'lineage', projectId, versionId } : { op: 'generation', projectId, recordId: recordId! } })
      .then(r => { if (!r.ok) throw new Error(r.message); if (active) { setValue(lineageSchema.parse(r.data)); setError('') } })
      .catch(() => { if (active) setError('来源读取失败，请刷新检查。') })
    return () => { active = false }
  }, [projectId, versionId, recordId, open, revision])
  return <details onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>来源 / 费用 / 工作流</summary>
    {error && <p role="alert">{error}</p>}
    {value && <><p>{value.source} · {value.status}</p><p>Created At：{value.createdAt}</p>
      {value.versionId && <p>AssetVersion：{value.versionId}</p>}
      <dl>{value.fields.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl></>}
  </details>
}
export function ToolReadinessPanel() {
  const [rows, setRows] = useState<Readiness>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const refresh = async () => {
    setBusy(true); setError('')
    try {
      const r = await window.desktop!.workspace.request({ action: 'compatibility', command: { op: 'readiness' } })
      if (!r.ok) throw new Error(r.message)
      setRows(readinessSchema.parse(r.data))
    } catch { setError('无法读取工具状态') } finally { setBusy(false) }
  }
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer) }, [])
  return <section aria-label="Tool readiness"><h2>Tool 验证与当前运行状态</h2>
    <p>历史验证不代表当前在线。仅检查本机 ComfyUI 与本地凭据状态，不请求云端 API。</p>
    <button disabled={busy} onClick={() => void refresh()}>刷新工具状态（只读）</button>
    {error && <p role="alert">{error}</p>}
    <table><thead><tr><th>Tool</th><th>Validation Status</th><th>Runtime Status</th><th>Capabilities / 范围</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.toolId}><td>{r.name}<br />{r.toolId}</td><td>{r.validation}</td><td>{r.runtime}</td><td>{r.capabilities.join(', ')}<p>{r.detail}</p><small>{r.checkedAt}</small></td></tr>)}</tbody>
    </table></section>
}
