import { useEffect, useState } from 'react'
import type { AssetVersion } from '../../shared/visual'
import { lineageSchema } from '../../shared/compatibility'
import type { Lineage } from '../../shared/compatibility'

export function CandidateSource({ version }: { version: AssetVersion }) {
  const [lineage, setLineage] = useState<Lineage | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    void window.desktop!.workspace.request({ action: 'compatibility', command: { op: 'lineage', projectId: version.projectId, versionId: version.id } })
      .then((result) => { if (!result.ok) throw new Error(result.message); if (active) setLineage(lineageSchema.parse(result.data)) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [version.id, version.projectId])
  return <div className="generate-source"><dl><dt>来源</dt><dd>{lineage?.source ?? (error ? '暂不可用' : '核验中…')}</dd><dt>工具</dt><dd>{version.provider || '—'}</dd><dt>模型</dt><dd>{version.model || '—'}</dd><dt>时间</dt><dd>{new Date(version.createdAt).toLocaleString('zh-CN')}</dd><dt>费用</dt><dd>{version.cost.actualCost === null ? '未记录' : `${version.cost.currency ?? ''} ${version.cost.actualCost}`}</dd></dl><details><summary>技术信息</summary>{lineage?.fields.map((field) => <p key={field.label}>{field.label}：{field.value}</p>)}<pre>{JSON.stringify({ prompt: version.prompt, promptVersion: version.promptVersion, metadata: version.metadata, lineage: lineage?.links }, null, 2)}</pre></details></div>
}
