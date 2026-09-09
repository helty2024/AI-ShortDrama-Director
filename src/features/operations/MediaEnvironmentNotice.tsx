import { useEffect, useState } from 'react'
import { aboutSchema } from '../../shared/operations'
import { operate } from './api'
export function MediaEnvironmentNotice() {
  const [missing, setMissing] = useState<string[]>([])
  useEffect(() => {
    let active = true
    void operate({ operation: 'about' })
      .then((value) => {
        const result = aboutSchema.parse(value)
        if (active)
          setMissing(
            (['ffmpeg', 'ffprobe'] as const).filter((tool) =>
              result[tool].startsWith('Not available'),
            ),
          )
      })
      .catch(() => {
        if (active) setMissing(['FFmpeg / FFprobe（检测失败）'])
      })
    return () => {
      active = false
    }
  }, [])
  return missing.length ? (
    <p role="alert" className="error">
      未检测到 {missing.join('、')}
      。项目和文本／图片功能可以继续使用；视频生成前请安装 FFmpeg（含
      FFprobe）并加入系统 PATH，然后重新启动应用。
    </p>
  ) : null
}
