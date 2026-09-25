import { z } from 'zod'
import { aspectRatioSchema, resolutionSchema } from './capabilities/common.js'
import { toolIdSchema } from './tools.js'

export const videoApiProfileSchema = z.strictObject({
  toolId: toolIdSchema,
  displayName: z.string().trim().min(1).max(120),
  baseEndpoint: z.url().max(2000),
  modelId: z.string().trim().min(1).max(200),
  credentialRef: z.uuid().nullable(),
  supportedCapabilities: z
    .array(z.enum(['video.textToVideo', 'video.imageToVideo']))
    .min(1)
    .max(2),
  supportedDurations: z.array(z.number().positive().max(600)).min(1).max(60),
  supportedAspectRatios: z.array(aspectRatioSchema).min(1).max(6),
  supportedResolutions: z.array(resolutionSchema).min(1).max(64),
  resolutionMode: z.enum(['exact', 'provider-auto']),
  durationToleranceSeconds: z.number().nonnegative().max(10),
  supportsLastFrame: z.boolean(),
  supportsReferenceImages: z.boolean(),
  maxOutputCount: z.number().int().min(1).max(4),
  polling: z.strictObject({
    initialIntervalMs: z.number().int().min(50).max(60000),
    maxIntervalMs: z.number().int().min(50).max(120000),
    maxWaitMs: z.number().int().min(100).max(86400000),
  }),
  maxDownloadBytes: z.number().int().min(1024).max(1024 * 1024 * 1024),
  allowedDownloadHosts: z.array(z.string().min(1).max(253)).max(32),
  allowedDownloadHostSuffixes: z.array(z.string().min(1).max(253)).max(32),
  currency: z.string().regex(/^[A-Z]{3}$/),
  estimateSupport: z.literal('unknown'),
  cancelSupport: z.boolean(),
  recoverSupport: z.boolean(),
})
export type VideoApiProfile = z.infer<typeof videoApiProfileSchema>

export const videoApiPreviewInputSchema = z.strictObject({
  projectId: z.uuid(),
  targetId: z.uuid(),
  toolId: toolIdSchema,
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

export const videoApiCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('profiles') }),
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
