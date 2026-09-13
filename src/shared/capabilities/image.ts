import { z } from 'zod'
import {
  assetVersionIdSchema,
  aspectRatioSchema,
  imageMimeSchema,
  imageOutputItemSchema,
  promptSchema,
  resolutionSchema,
  seedSchema,
} from './common.js'

const imageFields = {
  prompt: promptSchema,
  negativePrompt: z.string().max(16000),
  resolution: resolutionSchema,
  aspectRatio: aspectRatioSchema,
  seed: seedSchema,
  count: z.number().int().min(1).max(8),
  outputMime: imageMimeSchema,
}
export const imageGenerateInputSchema = z.strictObject(imageFields)
export const imageGenerateOutputSchema = z.strictObject({
  images: z.array(imageOutputItemSchema).min(1).max(8),
})
export const imageReferenceGenerateInputSchema = z.strictObject({
  ...imageFields,
  references: z
    .array(
      z.strictObject({
        assetVersionId: assetVersionIdSchema,
        role: z.enum(['identity', 'style', 'composition', 'subject']),
        weight: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(8),
})
export const imageReferenceGenerateOutputSchema = z.strictObject({
  images: z.array(imageOutputItemSchema).min(1).max(8),
})
export type ImageGenerateInput = z.infer<typeof imageGenerateInputSchema>
export type ImageReferenceGenerateInput = z.infer<
  typeof imageReferenceGenerateInputSchema
>
