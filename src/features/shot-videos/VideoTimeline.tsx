import { useState } from 'react'
import type { Shot } from '../../shared/domain'
import type { AssetVersion } from '../../shared/visual'
import type { VideoTimelineClip } from '../../shared/video-batch'
import { videoTimelineClipSchema } from '../../shared/video-batch'
import { ShotVideoPlayer } from './ShotVideoPlayer'

export function VideoTimeline({ shots, versions, initial, onSave, onExport, onEdit, busy }: {
  shots: Shot[]; versions: AssetVersion[]; initial?: VideoTimelineClip[];
  onSave?: (clips: VideoTimelineClip[]) => Promise<unknown>;
  onEdit?: (clips: VideoTimelineClip[]) => void;
  onExport?: (clips: VideoTimelineClip[]) => Promise<unknown>; busy: boolean
}) {
  const ordered = shots
  const [clips, setClips] = useState<VideoTimelineClip[]>(() => initial ?? ordered.map(s => ({ shotId: s.id, versionId: s.confirmedVideoAssetVersionId!, inSeconds: 0, outSeconds: versions.find(v => v.id === s.confirmedVideoAssetVersionId)?.duration ?? 0 })))
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false)
  const current = clips[index], version = versions.find(v => v.id === current?.versionId)
  const total = clips.reduce((sum, c) => sum + c.outSeconds - c.inSeconds, 0)
  const currentBindings = clips.every((c, i) => ordered[i]?.id === c.shotId && ordered[i]?.confirmedVideoAssetVersionId === c.versionId && versions.some(v => v.id === c.versionId && v.assetId === ordered[i]?.confirmedVideoAssetId && v.status === 'approved'))
  const valid = currentBindings && clips.length > 0 && clips.length <= 100 && total <= 600 && clips.every(c => videoTimelineClipSchema.safeParse(c).success && c.outSeconds <= (versions.find(v => v.id === c.versionId)?.duration ?? 0))
  const edit = (i: number, field: 'inSeconds' | 'outSeconds', value: number) => {
    setPlaying(false)
    const next = clips.map((c, n) => n === i ? { ...c, [field]: value } : c)
    setClips(next); onEdit?.(next)
  }
  return <section aria-label="成片时间线"><h3>成片时间线</h3>
    <p>仅使用已确认视频，固定正式镜头顺序。剪辑不会覆盖源素材。当前输出无声，最多 100 镜头、600 秒。合计 {total.toFixed(3)} 秒。</p>
    {!currentBindings && <p role="alert" className="error">已确认视频已变化或镜头已移除，请重新建立时间线。</p>}
    {currentBindings && !valid && <p role="alert" className="error">请填写有效的入点、出点，并确保总时长不超过 600 秒。</p>}
    <div className="video-timeline-table"><table><thead><tr><th>镜号 / 采用版本</th><th>入点（秒）</th><th>出点（秒）</th><th>剪辑时长</th><th>预览</th></tr></thead><tbody>{clips.map((c, i) => <tr key={c.shotId}>
      <td>镜 {ordered.find(s => s.id === c.shotId)?.plan?.shotNumber ?? i + 1} · {ordered.find(s => s.id === c.shotId)?.name ?? '镜头已移除'}<small>{c.versionId}</small></td>
      <td><input aria-label={`镜 ${i + 1} 入点`} disabled={busy} type="number" min={0} step={0.001} value={c.inSeconds} onChange={e => edit(i, 'inSeconds', Number(e.target.value))} /></td>
      <td><input aria-label={`镜 ${i + 1} 出点`} disabled={busy} type="number" min={0.001} max={versions.find(v => v.id === c.versionId)?.duration ?? 0} step={0.001} value={c.outSeconds} onChange={e => edit(i, 'outSeconds', Number(e.target.value))} /></td>
      <td>{(c.outSeconds - c.inSeconds).toFixed(3)}s</td><td><button disabled={busy || !valid} onClick={() => { setIndex(i); setPlaying(false) }}>预览镜 {i + 1}</button></td>
    </tr>)}</tbody></table></div>
    <div className="actions"><button disabled={busy || !valid} onClick={() => { setIndex(0); setPlaying(true) }}>连续预览时间线</button><button disabled={busy || !index} onClick={() => { setIndex(index - 1); setPlaying(false) }}>上一镜</button><button disabled={busy || index >= clips.length - 1} onClick={() => { setIndex(index + 1); setPlaying(false) }}>下一镜</button>{onSave && <button disabled={busy || !valid} onClick={() => void onSave(clips)}>保存剪辑区间（不收费）</button>}{onExport && <button className="primary" disabled={busy || !valid} onClick={() => { setPlaying(false); void onExport(clips) }}>{busy ? '正在合成…' : '合成并导出 MP4（不生成新素材）'}</button>}</div>
    {version && <ShotVideoPlayer key={`${version.id}:${playing}`} version={version} label={`时间线镜 ${index + 1}`} inSeconds={current.inSeconds} outSeconds={current.outSeconds} autoPlay={playing} onSource={() => {}} onEnded={() => { if (playing && index < clips.length - 1) setIndex(index + 1); else setPlaying(false) }} />}
  </section>
}
