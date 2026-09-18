import { z } from 'zod'
import { toolIdSchema } from './tools.js'
import { resolutionSchema, aspectRatioSchema } from './capabilities/common.js'
import { imageReferenceGenerateInputSchema } from './capabilities/image.js'
export const imageApiProfileSchema = z.strictObject({
  toolId: toolIdSchema,
  displayName: z.string().min(1).max(120),
  endpoint: z.url().max(2000),
  modelId: z.string().min(1).max(200),
  credentialRef: z.uuid().nullable(),
  supportedCapabilities: z
    .array(z.enum(['image.generate', 'image.referenceGenerate']))
    .min(1)
    .max(2),
  supportedResolutions: z.array(resolutionSchema).min(1).max(64),
  supportedAspectRatios: z.array(aspectRatioSchema).min(1).max(6),
  maxReferences: z.number().int().min(0).max(8),
  maxOutputCount: z.number().int().min(1).max(8),
  currency: z.string().regex(/^[A-Z]{3}$/),
  estimateSupport: z.literal('unknown'),
  cancelSupport: z.literal(false),
  recoverSupport: z.literal(false),
})
export type ImageApiProfile = z.infer<typeof imageApiProfileSchema>
export const imagePreviewInputSchema = z.strictObject({
  projectId: z.uuid(),
  targetId: z.uuid(),
  toolId: toolIdSchema,
  resolution: resolutionSchema,
  aspectRatio: aspectRatioSchema,
  count: z.number().int().min(1).max(8),
  references: z
    .array(imageReferenceGenerateInputSchema.shape.references.element)
    .max(8),
  allowAssetUpload: z.boolean(),
  localOnly: z.boolean(),
})
export const imageApiCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('probe'), toolId: toolIdSchema }),
  z.strictObject({ op: z.literal('profiles') }),
  z.strictObject({ op: z.literal('importProfile') }),
  z.strictObject({ op: z.literal('preview'), input: imagePreviewInputSchema }),
  z.strictObject({
    op: z.literal('confirm'),
    projectId: z.uuid(),
    previewId: z.uuid(),
    maxCostMicro: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    allowUnknownCost: z.boolean(),
  }),
  z.strictObject({
    op: z.literal('query'),
    projectId: z.uuid(),
    taskId: z.uuid(),
  }),
  z.strictObject({
    op: z.literal('review'),
    projectId: z.uuid(),
    versionId: z.uuid(),
    revision: z.number().int().positive(),
    adopt: z.boolean(),
    targetRevision: z.number().int().positive(),
  }),
])
export type ImageApiCommand = z.infer<typeof imageApiCommandSchema>
export const imageConnectivitySchema = z.strictObject({
  checkedAt: z.iso.datetime(),
  authentication: z.enum(['accepted', 'rejected', 'unknown']),
  modelVisible: z.boolean().nullable(),
  generationValidated: z.literal(false),
  tokenGroupVerified: z.literal(false),
  message: z.string().max(1000),
})
export type ImageConnectivityReport = z.infer<typeof imageConnectivitySchema>
export interface ImageApiPreview {
  id: string
  projectId: string
  target: string
  tool: string
  model: string
  prompt: string
  count: number
  resolution: { width: number; height: number }
  referenceCount: number
  currency: string
  estimate: string
  expiresAt: string
  disclosure: string
}
