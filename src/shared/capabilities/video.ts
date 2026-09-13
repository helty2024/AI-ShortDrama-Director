import { z } from 'zod'
import {
  assetVersionIdSchema,
  aspectRatioSchema,
  promptSchema,
  resolutionSchema,
  seedSchema,
  videoMimeSchema,
  videoOutputItemSchema,
} from './common.js'

const videoFields = {
  prompt: promptSchema,
  negativePrompt: z.string().max(16000),
  durationSeconds: z.number().positive().max(600),
  fps: z.number().int().min(1).max(120),
  resolution: resolutionSchema,
  aspectRatio: aspectRatioSchema,
  seed: seedSchema,
  outputMime: videoMimeSchema,
  audio: z.enum(['none', 'generated']),
}
export const videoTextToVideoInputSchema = z.strictObject(videoFields)
export const videoTextToVideoOutputSchema = z.strictObject({
  videos: z.array(videoOutputItemSchema).min(1).max(4),
})
export const videoImageToVideoInputSchema = z.strictObject({
  ...videoFields,
  firstFrameAssetVersionId: assetVersionIdSchema,
  lastFrameAssetVersionId: assetVersionIdSchema.nullable(),
})
export const videoImageToVideoOutputSchema = z.strictObject({
  videos: z.array(videoOutputItemSchema).min(1).max(4),
})
export type VideoTextToVideoInput = z.infer<typeof videoTextToVideoInputSchema>
export type VideoImageToVideoInput = z.infer<
  typeof videoImageToVideoInputSchema
>
