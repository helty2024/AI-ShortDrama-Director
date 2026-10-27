import { z } from 'zod'
import { aspectRatioSchema, resolutionSchema } from './capabilities/common.js'
import { toolIdSchema } from './tools.js'

export { videoApiProfileSchema, type VideoApiProfile } from './video-tool-profile.js'

export const videoConfigurationSchema = z.array(z.strictObject({ toolId: z.string(), displayName: z.string(), generationEnabled: z.boolean() }))

export const videoApiPreviewInputSchema = z.strictObject({
  projectId: z.uuid(),
  targetId: z.uuid(),
  toolId: toolIdSchema,
  purpose: z.enum(['narrative-production', 'technical-test']).default('narrative-production'),
  mode: z.enum(['text-to-video', 'image-to-video']),
  prompt: z.string().trim().min(1).max(32000).nullable(),
  durationSeconds: z.number().positive().max(600),
  fps: z.number().int().min(1).max(120),
  resolution: resolutionSchema,
  aspectRatio: aspectRatioSchema,
  seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  firstFrameAssetVersionId: z.uuid().nullable(),
  lastFrameAssetVersionId: z.uuid().nullable(),
  allowAssetUpload: z.boolean(),
  localOnly: z.boolean(),
})

export type VideoApiPreviewInput = z.infer<typeof videoApiPreviewInputSchema>

export const videoApiCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('profiles') }),
  z.strictObject({ op: z.literal('configuration') }),
  z.strictObject({ op: z.literal('preview'), input: videoApiPreviewInputSchema }),
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
    op: z.literal('cancel'),
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
export type VideoApiCommand = z.infer<typeof videoApiCommandSchema>

export const videoApiPreviewSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  target: z.string().min(1),
  tool: z.string().min(1),
  model: z.string().min(1),
  mode: z.enum(['text-to-video', 'image-to-video']),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  compilerVersion: z.string().min(1).optional(),
  inputImageCount: z.number().int().min(0).max(2),
  durationSeconds: z.number().positive(),
  aspectRatio: aspectRatioSchema,
  resolution: resolutionSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  estimate: z.string().min(1),
  expiresAt: z.iso.datetime(),
  disclosure: z.string().min(1),
})
export type VideoApiPreview = z.infer<typeof videoApiPreviewSchema>
