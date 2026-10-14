import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '../../shared/domain'
import { projectInputSchema } from '../../shared/domain'
import { workspaceService } from '../../services/workspace'
import { useCreator } from '../../components/creator-shell/creator-context'
import { useWorkspace } from '../workspace/state'
import './story.css'

type StoryValues = Pick<Project, 'name' | 'description' | 'logline' | 'genre' | 'style' | 'worldview' | 'creativeRequirements' | 'aspectRatio' | 'language'>
const fields = ['name', 'description', 'logline', 'genre', 'style', 'worldview', 'creativeRequirements', 'aspectRatio', 'language'] as const
function values(project: Project): StoryValues {
  return Object.fromEntries(fields.map((key) => [key, project[key]])) as StoryValues
}
const fingerprint = (value: StoryValues) => JSON.stringify(fields.map((key) => value[key]))

export function StoryPage() {
  const { state } = useWorkspace()
  const project = state.workspace?.project
  if (!project) return <p className="empty">请先打开项目。</p>
  return <StoryEditor key={project.id} project={project} />
}

function StoryEditor({ project }: { project: Project }) {
  const { setEditorStatus, acceptProject } = useWorkspace()
  const { navigateCreator } = useCreator()
  const [value, setValue] = useState<StoryValues>(() => values(project))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [organizing, setOrganizing] = useState(false)
  const current = useRef(value)
  const saved = useRef(fingerprint(value))
  const revision = useRef(project.revision)
  const changedAt = useRef(0)
  const busy = useRef(false)
  const failed = useRef(false)
  const alive = useRef(true)
  const accept = useRef(acceptProject)
  useEffect(() => { accept.current = acceptProject }, [acceptProject])
  const persist = useCallback(async () => {
    if (busy.current || fingerprint(current.current) === saved.current) return
    const parsed = projectInputSchema.safeParse(current.current)
    if (!parsed.success) {
      failed.current = true
      setError(parsed.error.issues[0]?.message ?? '请检查故事字段')
      setEditorStatus('error')
      return
    }
    busy.current = true
    failed.current = false
    setSaving(true)
    setError('')
    setEditorStatus('saving')
    const snapshot = fingerprint(parsed.data)
    try {
      const updated = await workspaceService.update({ id: project.id, expectedRevision: revision.current, changes: parsed.data })
      revision.current = updated.revision
      saved.current = snapshot
      if (alive.current) {
        accept.current(updated)
        setEditorStatus(fingerprint(current.current) === snapshot ? 'saved' : 'dirty')
      }
    } catch (cause) {
      failed.current = true
      if (alive.current) {
        setError(cause instanceof Error && /更新|冲突|CONFLICT/.test(cause.message) ? '项目已在其他位置更新，请重新载入后继续编辑。' : cause instanceof Error ? cause.message : '保存失败，本地修改已保留')
        setEditorStatus('error')
      }
    } finally {
      busy.current = false
      if (alive.current) setSaving(false)
    }
  }, [project.id, setEditorStatus])
  useEffect(() => {
    alive.current = true
    const timer = setInterval(() => {
      if (!failed.current && Date.now() - changedAt.current >= 650) void persist()
    }, 300)
    return () => { alive.current = false; clearInterval(timer) }
  }, [persist])
  const change = <K extends keyof StoryValues>(key: K, next: StoryValues[K]) => {
    const updated = { ...current.current, [key]: next }
    current.current = updated
    changedAt.current = Date.now()
    failed.current = false
    setValue(updated)
    setEditorStatus(busy.current ? 'saving' : fingerprint(updated) === saved.current ? 'saved' : 'dirty')
  }
  const reload = async () => {
    if (!window.confirm('放弃本地修改，重新载入项目？')) return
    try {
      const updated = await workspaceService.get(project.id)
      const next = values(updated)
      current.current = next
      saved.current = fingerprint(next)
      revision.current = updated.revision
      failed.current = false
      setValue(next)
      setError('')
      accept.current(updated)
      setEditorStatus('saved')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '重新载入失败') }
  }
  const organize = async () => {
    setOrganizing(true)
    try {
      await persist()
      if (busy.current || failed.current || saved.current !== fingerprint(current.current)) throw new Error('请等待故事保存完成后再整理。')
      const rawText = [current.current.logline, current.current.description].filter(Boolean).join('\n\n')
      const result = await window.desktop!.workspace.request({ action: 'intelligence', command: { operation: 'task.start', projectId: project.id, input: { type: 'parse', name: current.current.name, rawText } } })
      if (!result.ok) throw new Error('整理暂时不可用。故事已保存，请稍后重试。')
      navigateCreator('scripts')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '整理失败，请稍后重试。') }
    finally { setOrganizing(false) }
  }
  return <section className="story-page" aria-label="故事编辑器">
    <div className="page-heading"><div><small>从一个想法，开始一部短剧</small><h1>今天，想讲一个什么故事？</h1><p>写下人物、冲突和你想看到的画面。不用一次想清楚，随时可以回来修改。</p></div></div>
    {error && <div className="error" role="alert">{error}<button disabled={saving} onClick={() => void reload()}>重新载入</button></div>}
    <div className="story-paper">
      <label>故事名称<input className="story-title-input" value={value.name} maxLength={120} onChange={(event) => change('name', event.target.value)} /></label>
      <label>故事梗概<textarea className="story-synopsis" value={value.description} maxLength={4000} placeholder="例如：雨夜，阿青在车站拾起一封旧信。信里写着一个只有她知道的秘密……已有剧本？也可以直接粘贴场景和对白。" onChange={(event) => change('description', event.target.value)} /></label>
      <div className="story-footer"><small>下一步：整理为剧本预览，由你确认后再开始制作。<br />Alpha 使用本地规则模拟整理，保留完整原文。</small><button className="primary" disabled={organizing || saving || !value.name.trim() || !(value.description.trim() || value.logline.trim())} onClick={() => void organize()}>{organizing ? '准备中…' : 'AI 整理'}</button></div>
      <details className="story-options"><summary>补充故事方向（可选）</summary><div>
      <label>一句话概念<textarea className="story-logline" value={value.logline} maxLength={1000} placeholder="这个故事最打动你的是什么？" onChange={(event) => change('logline', event.target.value)} /></label>
      <div className="story-pair"><label>类型<input value={value.genre} maxLength={80} onChange={(event) => change('genre', event.target.value)} /></label><label>风格<textarea value={value.style} maxLength={2000} onChange={(event) => change('style', event.target.value)} /></label></div>
      <label>世界观<textarea className="story-long" value={value.worldview} maxLength={10000} onChange={(event) => change('worldview', event.target.value)} /></label>
      <label>创作要求<textarea className="story-long" value={value.creativeRequirements} maxLength={10000} onChange={(event) => change('creativeRequirements', event.target.value)} /></label>
      <div className="story-pair story-secondary"><label>画幅<select value={value.aspectRatio} onChange={(event) => change('aspectRatio', event.target.value as StoryValues['aspectRatio'])}>{['9:16', '16:9', '1:1', '4:3'].map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label><label>语言<input value={value.language} maxLength={40} onChange={(event) => change('language', event.target.value)} /></label></div>
      </div></details>
    </div>
    <button className="story-continue" onClick={() => navigateCreator('scripts')}>进入剧本 →</button>
  </section>
}
