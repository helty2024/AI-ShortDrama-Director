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
  const [src, setSrc] = useState(''),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void visualService
      .command({ operation: 'media.read', projectId, versionId, thumbnail })
      .then((value) => {
        if (
          active &&
          typeof value === 'string' &&
          value.startsWith('data:image/')
        )
          setSrc(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [projectId, versionId, thumbnail])
  return src ? (
    <img
      className={thumbnail ? 'asset-thumbnail' : 'asset-preview'}
      src={src}
      alt={alt}
    />
  ) : (
    <span>{failed ? '图片不可用' : '读取图片…'}</span>
  )
}
