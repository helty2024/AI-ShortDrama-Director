import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { AIError } from '../intelligence/provider.js'
const execute = promisify(execFile)
export async function runMediaTool(
  kind: 'ffmpeg' | 'ffprobe',
  args: string[],
  signal?: AbortSignal,
) {
  try {
    return await execute(
      process.env[kind === 'ffmpeg' ? 'DIRECTOR_FFMPEG' : 'DIRECTOR_FFPROBE'] ||
        kind,
      args,
      {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        signal,
      },
    )
  } catch {
    throw new AIError(
      signal?.aborted ? 'CANCELLED' : 'PROVIDER',
      signal?.aborted
        ? '视频任务已取消'
        : `${kind} 执行失败，请安装 FFmpeg/FFprobe 或检查视频格式`,
    )
  }
}
export async function probeVideo(path: string) {
  const { stdout } = await runMediaTool('ffprobe', [
    '-v',
    'error',
    '-protocol_whitelist',
    'file,pipe',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    path,
  ])
  const data = z
    .object({
      streams: z.array(
        z.object({
          codec_type: z.string(),
          codec_name: z.string().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          avg_frame_rate: z.string().optional(),
          duration: z.string().optional(),
        }),
      ),
      format: z.object({
        format_name: z.string(),
        duration: z.string().optional(),
      }),
    })
    .parse(JSON.parse(stdout))
  const v = data.streams.find((s) => s.codec_type === 'video'),
    duration = Number(v?.duration ?? data.format.duration)
  if (
    !v?.width ||
    !v.height ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 600 ||
    v.width * v.height > 16_777_216 ||
    !data.format.format_name.includes('mp4')
  )
    throw new AIError(
      'INVALID_OUTPUT',
      '视频必须为有效 MP4，最长 600 秒，分辨率不超过 1600 万像素',
    )
  const [n, d] = v.avg_frame_rate?.split('/').map(Number) ?? []
  const fps = n && d ? n / d : null
  return {
    width: v.width,
    height: v.height,
    duration,
    fps,
    codec: v.codec_name ?? null,
  }
}
export async function videoThumbnail(path: string, output: string) {
  await runMediaTool('ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-protocol_whitelist',
    'file,pipe',
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    'scale=320:320:force_original_aspect_ratio=decrease',
    '-y',
    output,
  ])
}
