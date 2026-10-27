import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { Entity, Shot } from '../../shared/domain'
import { assetVersionSchema, type AssetVersion } from '../../shared/visual'
import { videoTimelineClipSchema, type VideoTimelineClip } from '../../shared/video-batch'
import { VideoTimeline } from './VideoTimeline'
import { ShotVideoPlayer } from './ShotVideoPlayer'
import { sequenceDraftSchema } from '../../shared/video-sequence'
import { sequenceClipLabel } from './shot-video-model'

// Navigation can remount this view before its last IPC reply. Read only after
// the previous instance has drained its writes for the same project.
const pendingSequenceSaves = new Map<string, Promise<void>>()

export function ProjectVideoSequence({ projectId, shots, entities, versions, onChange }: {
  projectId: string; shots: Shot[]; entities: Entity[]; versions: AssetVersion[]; onChange: () => Promise<unknown>
}) {
  const [draft, setDraft] = useState<{ key: number; clips: VideoTimelineClip[] } | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null)
  const [ready, setReady] = useState(false), [saveStatus, setSaveStatus] = useState(''), [saveError, setSaveError] = useState('')
  const revision = useRef(0), queue = useRef(Promise.resolve()), mounted = useRef(false), saveNumber = useRef(0)
  const [previewId, setPreviewId] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const confirmed = shots.filter(s => versions.some(v => v.id === s.confirmedVideoAssetVersionId && v.assetId === s.confirmedVideoAssetId && v.status === 'approved' && v.mimeType === 'video/mp4' && v.duration && entities.some(e => e.kind === 'asset' && e.id === v.assetId && e.approvedVersionId === v.id)))
  const selected = confirmed.filter(s => selectedIds === null || selectedIds.includes(s.id))
  const selectionChanged = draft && (selected.length !== draft.clips.length || selected.some((s, i) => s.id !== draft.clips[i]?.shotId))
  const exports = versions.filter(v => v.metadata.localAssembly === true && v.mimeType === 'video/mp4').toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
  const preview = exports.find(v => v.id === previewId)
  useEffect(() => {
    mounted.current = true
    let active = true
    void (async () => {
      try {
        await pendingSequenceSaves.get(projectId)
        const response = await window.desktop!.workspace.request({ action: 'videoBatch', command: { op: 'getSequenceDraft', projectId } })
        if (!response.ok) throw new Error(response.message)
        const saved = sequenceDraftSchema.nullable().parse(response.data)
        if (!active) return
        revision.current = saved?.revision ?? 0
        if (saved) { setDraft({ key: 1, clips: saved.clips }); setSelectedIds(saved.clips.map(c => c.shotId)); setSaveStatus('已恢复本地时间线草稿') }
        setReady(true)
      } catch (cause) { if (active) setSaveError(cause instanceof Error ? cause.message : '读取草稿失败，请重新进入页面') }
    })()
    return () => { active = false; mounted.current = false }
  }, [projectId])
  const persist = (clips: VideoTimelineClip[]) => {
    const number = ++saveNumber.current
    setSaveStatus('正在保存时间线草稿…'); setSaveError('')
    // Start each save at the edit event, with no debounce or unmount cleanup
    // that could drop the final edit. Serialize IPC and retain conflict checks.
    queue.current = (pendingSequenceSaves.get(projectId) ?? queue.current).then(async () => {
      try {
        const response = await window.desktop!.workspace.request({ action: 'videoBatch', command: { op: 'saveSequenceDraft', projectId, expectedRevision: revision.current, clips } })
        if (!response.ok) throw new Error(response.message)
        const saved = sequenceDraftSchema.parse(response.data)
        revision.current = saved.revision
        if (mounted.current && number === saveNumber.current) { setSaveStatus('时间线草稿已自动保存到本地'); setSaveError('') }
      } catch (cause) {
        if (mounted.current && number === saveNumber.current) { setSaveStatus(''); setSaveError(cause instanceof Error ? cause.message : '草稿保存失败') }
      }
    })
    const pending = queue.current
    pendingSequenceSaves.set(projectId, pending)
    void pending.then(() => { if (pendingSequenceSaves.get(projectId) === pending) pendingSequenceSaves.delete(projectId) })
  }
  const replaceDraft = (clips: VideoTimelineClip[]) => {
    setDraft(previous => ({ key: (previous?.key ?? 0) + 1, clips }))
    setSelectedIds(clips.map(c => c.shotId))
    persist(clips)
  }
  const build = () => {
    setError(''); setNotice('')
    if (!selected.length) { setError('请至少选择一个已确认镜头，再建立时间线。'); return }
    if (selected.length > 100) { setError('最多选择 100 个镜头，请减少勾选。'); return }
    replaceDraft(selected.map(s => draft?.clips.find(c => c.shotId === s.id && c.versionId === s.confirmedVideoAssetVersionId) ?? { shotId: s.id, versionId: s.confirmedVideoAssetVersionId!, inSeconds: 0, outSeconds: versions.find(v => v.id === s.confirmedVideoAssetVersionId)!.duration! }))
  }
  const restore = (version: AssetVersion) => {
    const sequence = version.metadata.sequence
    const parsed = z.array(videoTimelineClipSchema).min(1).max(100).safeParse(Array.isArray(sequence) ? sequence.map(c => c && typeof c === 'object' && !Array.isArray(c) ? { shotId: c.shotId, versionId: c.versionId, inSeconds: c.inSeconds, outSeconds: c.outSeconds } : c) : null)
    if (!parsed.success) { setError('此成片没有可载入的剪辑记录'); return }
    setError(''); setNotice('')
    replaceDraft(parsed.data)
  }
  const exportSequence = async (clips: VideoTimelineClip[]) => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await queue.current
      const response = await window.desktop!.workspace.request({ action: 'videoBatch', command: { op: 'exportSequence', projectId, clips } })
      if (!response.ok) throw new Error(response.message)
      const result = z.object({ version: assetVersionSchema, saved: z.boolean() }).parse(response.data)
      setPreviewId(result.version.id)
      setNotice(result.saved ? '成片已入库，MP4 已保存到所选位置。' : '已取消文件保存；成片仍已入库，可在下方预览或载入后再次导出。')
      await onChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '成片导出失败，请检查本地 FFmpeg 与素材')
      await onChange().catch(() => {})
    } finally { setBusy(false) }
  }
  return <section className="project-video-sequence" aria-label="项目成片">
    <div className="shot-videos-section-head"><h2>项目成片</h2><span>{confirmed.length} / {shots.length} 镜头可用于成片</span></div>
    <p>确认候选 → 建立时间线 → 调整入点、出点 → 导出无声 MP4。本地合成无需生成服务，不上传素材。</p>
    <p>按集、场、镜头顺序加入勾选的已确认视频；未确认或绑定失效的镜头会跳过（{shots.length - confirmed.length} 个）。建立后的镜头选择和入点、出点自动保存到本地项目，离开页面或重启后恢复。</p>
    {confirmed.length > 0 && <fieldset className="project-sequence-selection" disabled={!ready || busy}>
      <legend>选择成片镜头（已选 {selected.length} / {confirmed.length}）</legend>
      <div className="actions"><button onClick={() => setSelectedIds(confirmed.map(s => s.id))}>全选镜头</button><button onClick={() => setSelectedIds([])}>清空选择</button></div>
      <div className="project-sequence-selection-list">{confirmed.map(s => {
        const scene = entities.find(e => e.kind === 'scene' && e.id === s.sceneId)
        const episode = scene?.kind === 'scene' ? entities.find(e => e.kind === 'episode' && e.id === scene.episodeId) : undefined
        return <label key={s.id}><input type="checkbox" checked={selected.some(item => item.id === s.id)} onChange={e => setSelectedIds(e.target.checked ? [...selected.map(item => item.id), s.id] : selected.filter(item => item.id !== s.id).map(item => item.id))} /><span>{episode?.name ?? '未命名集'} / {scene?.name ?? '未命名场'} / 镜 {s.plan?.shotNumber ?? s.order + 1} · {s.name}</span></label>
      })}</div>
      <p>勾选后点击建立或重新建立，才会应用并保存选择。重新建立会替换草稿，保留仍选用同一视频的已有区间；导出使用下方时间线。</p>
    </fieldset>}
    <button disabled={!ready || busy || !selected.length || selected.length > 100} onClick={build}>{draft ? '按当前已确认视频重新建立时间线' : '用已确认视频建立时间线'}</button>
    {selectionChanged && <p>镜头选择尚未应用，请点击“按当前已确认视频重新建立时间线”。</p>}
    {!confirmed.length && <p>请在下方审看候选，先“批准”，再“设为当前镜头视频”。也可为当前镜头导入本地 MP4 候选。</p>}
    {ready && confirmed.length > 0 && !selected.length && <p role="alert" className="error">请至少选择一个已确认镜头，再建立时间线。</p>}
    {selected.length > 100 && <p role="alert" className="error">最多选择 100 个镜头，请减少勾选。</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <p aria-live="polite" data-testid="sequence-draft-status">{saveError ? `时间线草稿未保存：${saveError}` : saveStatus || (ready ? '尚未建立时间线草稿' : '正在读取本地时间线草稿…')}</p>
    {saveError && draft && <button disabled={busy} onClick={() => persist(draft.clips)}>重试保存草稿</button>}
    {draft && <VideoTimeline key={draft.key} shots={shots.filter(s => draft.clips.some(c => c.shotId === s.id))} versions={versions} initial={draft.clips} busy={busy} onEdit={clips => { setDraft(previous => previous && { ...previous, clips }); persist(clips) }} onRemove={replaceDraft} onExport={exportSequence} />}
    {exports.length > 0 && <details className="project-sequence-history"><summary>已导出成片（{exports.length}）</summary>{exports.map(v => <div key={v.id} className="actions"><span>{sequenceClipLabel(v)} · {new Date(v.createdAt).toLocaleString('zh-CN')} · {v.duration?.toFixed(3)} 秒 · {v.width}×{v.height}</span><button disabled={busy} onClick={() => setPreviewId(v.id)}>预览此成片</button><button disabled={!ready || busy} onClick={() => restore(v)}>载入此成片时间线</button></div>)}</details>}
    {preview && <section aria-label="已导出成片预览"><h3>已导出成片 · {preview.duration?.toFixed(3)} 秒</h3><button onClick={() => setPreviewId('')}>收起成片预览</button><ShotVideoPlayer version={preview} label="已导出成片" onSource={() => setNotice('成片剪辑来源保存在已导出成片的时间线记录中。')} /></section>}
  </section>
}
