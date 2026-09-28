import { useEffect, useState } from 'react'
import type { AssetVersion } from '../../shared/visual'
import { visualService } from '../../services/visual'

export function ShotVideoPlayer({ version, label, onSource }: { version: AssetVersion; label: string; onSource: () => void }) {
  const [attempt, setAttempt] = useState(0)
  const [media, setMedia] = useState<{ key: string; url: string; error: boolean } | null>(null)
  const key = `${version.projectId}:${version.id}:${attempt}`
  useEffect(() => {
    let active = true
    void visualService.command({ operation: 'media.read', projectId: version.projectId, versionId: version.id, thumbnail: false })
      .then((url) => { if (active) setMedia({ key, url: typeof url === 'string' && url.startsWith('director-media://asset/') ? url : '', error: typeof url !== 'string' || !url.startsWith('director-media://asset/') }) })
      .catch(() => { if (active) setMedia({ key, url: '', error: true }) })
    return () => { active = false }
  }, [key, version.projectId, version.id])
  const current = media?.key === key ? media : null
  return <div className="shot-video-player" style={{ aspectRatio: `${version.width} / ${version.height}` }}>
    {current?.error ? <div className="shot-video-playback-error" role="alert"><strong>视频暂时无法播放</strong><div className="actions"><button onClick={() => setAttempt((value) => value + 1)}>重试加载</button><button onClick={onSource}>查看来源</button></div></div>
      : current?.url ? <video key={key} src={current.url} controls preload="metadata" playsInline aria-label={label} onError={() => setMedia({ key, url: '', error: true })} />
        : <div className="shot-video-playback-error" role="status">正在读取视频…</div>}
  </div>
}
