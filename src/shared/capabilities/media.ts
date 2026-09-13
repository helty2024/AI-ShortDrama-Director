import { z } from 'zod'
import {
  assetVersionIdSchema,
  resolutionSchema,
  videoMimeSchema,
  videoOutputItemSchema,
} from './common.js'

// v1 is a video-transcode contract; other media profiles require a contract revision.
export const mediaTranscodeInputSchema = z.strictObject({
  sourceAssetVersionId: assetVersionIdSchema,
  outputMime: videoMimeSchema,
  resolution: resolutionSchema,
  fps: z.number().int().min(1).max(120),
  audio: z.enum(['preserve', 'remove']),
})
export const mediaTranscodeOutputSchema = z.strictObject({
  video: videoOutputItemSchema,
})
