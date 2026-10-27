import { useState } from 'react'
import type { Shot } from '../../shared/domain'
import type { AssetVersion } from '../../shared/visual'
import type { VideoTimelineClip } from '../../shared/video-batch'
import { ShotVideoPlayer } from './ShotVideoPlayer'

export function VideoTimeline({ shots, versions, initial, onSave, busy }: {
  shots: Shot[]; versions: AssetVersion[]; initial?: VideoTimelineClip[];
  onSave: (clips: VideoTimelineClip[]) => Promise<unknown>; busy: boolean
}) {
  const ordered = [...shots].sort((a, b) => a.order - b.order)
  const [clips, setClips] = useState<VideoTimelineClip[]>(() => initial ?? ordered.map(s => ({ shotId: s.id, versionId: s.confirmedVideoAssetVersionId!, inSeconds: 0, outSeconds: versions.find(v => v.id === s.confirmedVideoAssetVersionId)?.duration ?? 0 })))
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false)
  const current = clips[index], version = versions.find(v => v.id === current?.versionId)
  const valid = clips.every(c => c.inSeconds >= 0 && c.outSeconds > c.inSeconds && c.outSeconds <= (versions.find(v => v.id === c.versionId)?.duration ?? 0))
  const edit = (i: number, field: 'inSeconds' | 'outSeconds', value: number) => { setPlaying(false); setClips(clips.map((c, n) => n === i ? { ...c, [field]: value } : c)) }
  return <section aria-label="成片时间线"><h3>成片时间线</h3>
    <p>仅使用本批次已采用视频，固定正式镜头顺序。剪辑不会覆盖源素材。当前输出无声。合计 {clips.reduce((sum, c) => sum + c.outSeconds - c.inSeconds, 0).toFixed(3)} 秒。</p>
    <table><thead><tr><th>镜号 / 采用版本</th><th>入点（秒）</th><th>出点（秒）</th><th>剪辑时长</th><th>预览</th></tr></thead><tbody>{clips.map((c, i) => <tr key={c.shotId}>
      <td>镜 {ordered.find(s => s.id === c.shotId)?.plan?.shotNumber ?? i + 1}<small>{c.versionId}</small></td>
      <td><input aria-label={`镜 ${i + 1} 入点`} type="number" min={0} step={0.001} value={c.inSeconds} onChange={e => edit(i, 'inSeconds', Number(e.target.value))} /></td>
      <td><input aria-label={`镜 ${i + 1} 出点`} type="number" min={0.001} max={versions.find(v => v.id === c.versionId)?.duration ?? 0} step={0.001} value={c.outSeconds} onChange={e => edit(i, 'outSeconds', Number(e.target.value))} /></td>
      <td>{(c.outSeconds - c.inSeconds).toFixed(3)}s</td><td><button onClick={() => { setIndex(i); setPlaying(false) }}>预览镜 {i + 1}</button></td>
    </tr>)}</tbody></table>
    <div className="actions"><button disabled={!valid} onClick={() => { setIndex(0); setPlaying(true) }}>连续预览时间线</button><button disabled={!index} onClick={() => { setIndex(index - 1); setPlaying(false) }}>上一镜</button><button disabled={index >= clips.length - 1} onClick={() => { setIndex(index + 1); setPlaying(false) }}>下一镜</button><button disabled={busy || !valid} onClick={() => void onSave(clips)}>保存剪辑区间（不收费）</button></div>
    {version && <ShotVideoPlayer key={`${version.id}:${playing}`} version={version} label={`时间线镜 ${index + 1}`} inSeconds={current.inSeconds} outSeconds={current.outSeconds} autoPlay={playing} onSource={() => {}} onEnded={() => { if (playing && index < clips.length - 1) setIndex(index + 1); else setPlaying(false) }} />}
  </section>
}
