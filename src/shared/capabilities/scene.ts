import { z } from 'zod'
import {
  assetVersionIdSchema,
  imageOutputItemSchema,
  resolutionSchema,
} from './common.js'

const camera = z.strictObject({
  position: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  target: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  focalLengthMm: z.number().min(1).max(1000),
})
export const scenePrevizInputSchema = z.strictObject({
  sceneAssetVersionId: assetVersionIdSchema,
  camera,
  resolution: resolutionSchema,
  view: z.enum(['solid', 'depth']),
})
export const scenePrevizOutputSchema = z.strictObject({
  preview: imageOutputItemSchema,
})
export const sceneRenderInputSchema = z.strictObject({
  sceneAssetVersionId: assetVersionIdSchema,
  camera,
  resolution: resolutionSchema,
  samples: z.number().int().min(1).max(4096),
  transparent: z.boolean(),
})
export const sceneRenderOutputSchema = z.strictObject({
  render: imageOutputItemSchema,
})
