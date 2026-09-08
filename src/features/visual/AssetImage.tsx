import { useEffect, useState } from 'react'
import { visualService } from '../../services/visual'
export function AssetImage({
  projectId,
  versionId,
  thumbnail = true,
  alt,
}: {
  projectId: string
  versionId: string
  thumbnail?: boolean
  alt: string
}) {
  const key = `${projectId}:${versionId}:${thumbnail}`
  const [loaded, setLoaded] = useState<{
    key: string
    src: string
    failed: boolean
  } | null>(null)
  useEffect(() => {
    let active = true
    void visualService
      .command({ operation: 'media.read', projectId, versionId, thumbnail })
      .then((value) => {
        if (
          active &&
          typeof value === 'string' &&
          (value.startsWith('data:image/') ||
            value.startsWith('data:video/mp4;'))
        )
          setLoaded({ key, src: value, failed: false })
      })
      .catch(() => {
        if (active) setLoaded({ key, src: '', failed: true })
      })
    return () => {
      active = false
    }
  }, [projectId, versionId, thumbnail, key])
  const src = loaded?.key === key ? loaded.src : ''
  if (src.startsWith('data:video/'))
    return (
      <video
        className="asset-preview"
        src={src}
        controls
        preload="metadata"
        aria-label={alt}
      />
    )
  return src ? (
    <img
      className={thumbnail ? 'asset-thumbnail' : 'asset-preview'}
      src={src}
      alt={alt}
    />
  ) : (
    <span>
      {loaded?.key === key && loaded.failed ? '媒体不可用' : '读取媒体…'}
    </span>
  )
}
