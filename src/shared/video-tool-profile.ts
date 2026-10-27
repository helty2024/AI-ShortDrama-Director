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
  // Optional: absent means batch planning is not certified for this adapter.
  // These are adapter limits, never defaults imposed by the batch workflow.
  batchPolicy: z.strictObject({
    fps: z.number().int().min(1).max(120),
    maxPromptLength: z.number().int().positive().max(32000),
    maxConcurrent: z.number().int().min(1).max(100),
    budgetCurrency: z.string().regex(/^[A-Z]{3}$/),
    reservationQuote: z.strictObject({
      microUnitsPerSecond: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      basis: z.string().min(1).max(500),
    }).nullable(),
  }).optional(),
})
export type VideoApiProfile = z.infer<typeof videoApiProfileSchema>
