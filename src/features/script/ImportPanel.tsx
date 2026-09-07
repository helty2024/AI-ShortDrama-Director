import { useState } from 'react'
import type {
  ImportPreview,
  IntelligenceCommand,
  IntelligenceSnapshot,
} from '../../shared/intelligence'
import { parsedScriptSchema } from '../../shared/intelligence'

export function ImportPanel({
  projectId,
  snapshot,
  execute,
  refreshWorkspace,
}: {
  projectId: string
  snapshot: IntelligenceSnapshot
  execute: (command: IntelligenceCommand) => Promise<unknown>
  refreshWorkspace: () => Promise<void>
}) {
  const [raw, setRaw] = useState(''),
    [name, setName] = useState('导入剧本'),
    [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const preview =
    snapshot.imports.find((p) => p.id === selected) ?? snapshot.imports.at(-1)
  return (
    <section className="import-panel">
      <h3>剧本解析 / 导入</h3>
      <label>
        剧本名称
        <input
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        TXT / Markdown 文件
        <input
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            if (
              !/\.(txt|md|markdown)$/i.test(file.name) ||
              file.size > 500000
            ) {
              setError('请选择小于 500 KB 的 TXT/Markdown 文件')
              return
            }
            void file
              .text()
              .then((text) => {
                setRaw(text)
                setName(file.name.replace(/\.[^.]+$/, '').slice(0, 120))
                setError('')
              })
              .catch(() => setError('文件读取失败，请使用纯文本粘贴'))
          }}
        />
      </label>
      <label>
        粘贴剧本原文
        <textarea
          aria-label="剧本原文"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          maxLength={100000}
          rows={7}
        />
      </label>
      <button
        disabled={!raw.trim() || !name.trim()}
        onClick={() => {
          setError('')
          void execute({
            operation: 'task.start',
            projectId,
            input: { type: 'parse', name, rawText: raw },
          }).catch(() => undefined)
        }}
      >
        解析为预览
      </button>
      <p className="muted">UTF-8 文本。解析后仍需人工确认；原文会完整保存。</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {snapshot.imports.length > 0 && (
        <label>
          导入预览
          <select
            aria-label="导入预览"
            value={preview?.id ?? ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            {snapshot.imports.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
                {p.confirmedScriptId ? '（已导入）' : '（待确认）'}
              </option>
            ))}
          </select>
        </label>
      )}
      {preview && (
        <Preview
          key={preview.id + ':' + preview.revision}
          preview={preview}
          execute={execute}
          refreshWorkspace={refreshWorkspace}
        />
      )}
    </section>
  )
}
function Preview({
  preview,
  execute,
  refreshWorkspace,
}: {
  preview: ImportPreview
  execute: (command: IntelligenceCommand) => Promise<unknown>
  refreshWorkspace: () => Promise<void>
}) {
  const [json, setJson] = useState(JSON.stringify(preview.parsed, null, 2)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const confirm = async () => {
    setError('')
    setBusy(true)
    try {
      const parsed = parsedScriptSchema.parse(JSON.parse(json) as unknown)
      await execute({
        operation: 'import.confirm',
        projectId: preview.projectId,
        id: preview.id,
        expectedRevision: preview.revision,
        parsed,
      })
      await refreshWorkspace()
    } catch (error) {
      setError(error instanceof Error ? error.message : '预览格式无效')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="preview-result">
      <h4>解析预览</h4>
      <p>
        {preview.parsed.episodes.length} 集 /{' '}
        {preview.parsed.episodes.reduce((n, e) => n + e.scenes.length, 0)} 场
      </p>
      {preview.parsed.warnings.map((warning, i) => (
        <p key={i}>{warning}</p>
      ))}
      <details>
        <summary>保留的完整原文</summary>
        <pre>{preview.rawText}</pre>
      </details>
      {preview.parsed.episodes.map((episode, i) => (
        <div key={i}>
          <strong>{episode.name}</strong>
          <ul>
            {episode.scenes.map((scene, j) => (
              <li key={j}>
                {scene.sceneNumber} · {scene.heading} · {scene.dialogue.length}{' '}
                段对白
              </li>
            ))}
          </ul>
        </div>
      ))}
      <details>
        <summary>高级：修订结构化预览</summary>
        <textarea
          aria-label="结构化解析预览"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={14}
          disabled={!!preview.confirmedScriptId}
        />
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !!preview.confirmedScriptId}
        onClick={() => void confirm()}
      >
        {preview.confirmedScriptId
          ? '已确认导入'
          : busy
            ? '导入中…'
            : '确认导入正式剧本'}
      </button>
    </div>
  )
}
