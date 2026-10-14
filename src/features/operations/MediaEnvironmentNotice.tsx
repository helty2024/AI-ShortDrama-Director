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
      服务不可用：视频处理组件未就绪。请重新安装 Alpha 测试版或在设置中检查视频环境；故事和已确认素材仍可编辑。
      <details><summary>高级诊断</summary>未检测到 {missing.join('、')}。请检查 FFmpeg / FFprobe。</details>
    </p>
  ) : null
}
