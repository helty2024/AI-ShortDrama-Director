import { z } from 'zod'

export const contractVersionSchema = z.literal('1.0.0')
export const capabilityIdSchema = z.enum([
  'text.structured',
  'image.generate',
  'image.referenceGenerate',
  'video.textToVideo',
  'video.imageToVideo',
  'scene.previz',
  'scene.render',
  'media.transcode',
])
export type CapabilityId = z.infer<typeof capabilityIdSchema>
export const assetVersionIdSchema = z.uuid()
export const promptSchema = z.string().trim().min(1).max(32000)
export const seedSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
export const resolutionSchema = z.strictObject({
  width: z.number().int().min(16).max(16384),
  height: z.number().int().min(16).max(16384),
})
export const aspectRatioSchema = z.enum([
  '1:1',
  '9:16',
  '16:9',
  '4:3',
  '3:4',
  'custom',
])
export const durationRangeSchema = z
  .strictObject({
    min: z.number().finite().nonnegative(),
    max: z.number().finite().nonnegative(),
  })
  .refine((v) => v.min <= v.max, 'min must not exceed max')
export const imageMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp'])
export const videoMimeSchema = z.enum(['video/mp4', 'video/webm'])
// Broker-issued identifiers, never a tool-supplied URL or arbitrary filesystem path.
export const outputHandleSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const imageOutputItemSchema = z.strictObject({
  handle: outputHandleSchema,
  mime: imageMimeSchema,
  resolution: resolutionSchema,
})
export const videoOutputItemSchema = z.strictObject({
  handle: outputHandleSchema,
  mime: videoMimeSchema,
  resolution: resolutionSchema,
  durationSeconds: z.number().positive().max(86400),
})
export const supportSchema = z.enum(['supported', 'unsupported', 'unknown'])
export function knowledgeSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('known'), value }),
    z.strictObject({ status: z.literal('unknown') }),
    z.strictObject({ status: z.literal('unsupported') }),
  ])
}
