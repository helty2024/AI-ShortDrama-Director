import { z } from 'zod'

const url = z.string().min(1).max(100_000_000)
export const h3RequestBodySchema = z.strictObject({
  model: z.literal('MiniMax-H3'), resolution: z.literal('480P'),
  duration: z.number().int().min(4).max(30),
  ratio: z.enum(['1:1', '9:16', '16:9', '4:3', '3:4']),
  mute_audio: z.literal(true), use_context_ir: z.literal(false),
  content: z.array(z.union([
    z.strictObject({ type: z.literal('text'), text: z.string().trim().min(1).max(7000) }),
    z.strictObject({ type: z.literal('image_url'), image_url: z.strictObject({ url }), role: z.enum(['first_frame', 'last_frame', 'reference_image']) }),
    z.strictObject({ type: z.literal('video_url'), video_url: z.strictObject({ url }), role: z.literal('reference_video') }),
    z.strictObject({ type: z.literal('audio_url'), audio_url: z.strictObject({ url }), role: z.literal('reference_audio') }),
  ])).min(1).max(14),
}).superRefine((body, ctx) => {
  const count = (role: string) => body.content.filter(c => 'role' in c && c.role === role).length
  const first = count('first_frame'), last = count('last_frame')
  const images = count('reference_image'), videos = count('reference_video'), audio = count('reference_audio')
  if (first > 1 || last > 1 || images > 9 || videos > 3 || audio > 3 || images + videos + audio > 12 || ((first + last > 0) && images + videos + audio > 0) || (audio > 0 && images + videos === 0))
    ctx.addIssue({ code: 'custom', message: 'H3 首尾帧与多参考模式互斥，素材数量或音频依赖无效' })
})
