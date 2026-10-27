import { z } from 'zod'
import { videoApiPreviewInputSchema } from './video-api.js'
import { toolIdSchema } from './tools.js'
import { executionConfigurationSchema } from './execution-binding.js'

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const videoTimelineClipSchema = z.strictObject({
  shotId: z.uuid(), versionId: z.uuid(),
  inSeconds: z.number().finite().nonnegative(),
  outSeconds: z.number().finite().positive().max(600),
}).refine(c => c.outSeconds > c.inSeconds, '剪辑结束点必须大于开始点')
export type VideoTimelineClip = z.infer<typeof videoTimelineClipSchema>
export const videoBatchItemSchema = z.strictObject({
  shotId: z.uuid(), shotNumber: z.number().int().positive(), name: z.string(),
  // Old batches had no narrative readiness evidence. Treat them as technical
  // history; absence of a field must never retroactively certify production.
  input: z.preprocess(value => value && typeof value === 'object' && !('purpose' in value)
    ? { ...value, purpose: 'technical-test' } : value, videoApiPreviewInputSchema),
  sourceRevisions: z.record(z.uuid(), z.number().int().positive()),
  productionEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  points: z.number().finite().nonnegative(), ceilingMicro: money,
  estimatedReservationMicro: money.nullable().optional(),
  status: z.enum(['queued', 'dispatching', 'running', 'succeeded', 'failed', 'unknown']),
  taskId: z.uuid().nullable(), recordId: z.uuid().nullable(),
  error: z.string().max(1000).nullable(),
})
export const nativeVideoBatchSchema = z.strictObject({
  revision: z.number().int().positive(),
  executionAllowed: z.boolean(),
  state: z.enum(['awaiting-budget', 'active', 'paused', 'completed']),
  toolId: toolIdSchema, model: z.string().min(1).max(200),
  executionConfiguration: executionConfigurationSchema.optional(),
  budgetCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  quoteKnown: z.boolean().optional(),
  quoteBasis: z.string().max(500).optional(),
  scopeFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  configurationIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  concurrency: z.number().int().min(1).max(100), maxCalls: z.number().int().min(1).max(100),
  maxPoints: z.number().finite().nonnegative(), maxCostMicro: money.nullable(), allowUnknownCost: z.boolean(),
  authorizedAt: z.iso.datetime().nullable(), expiresAt: z.iso.datetime().nullable(),
  items: z.array(videoBatchItemSchema).min(1).max(100),
  exportVersionIds: z.array(z.uuid()),
  timeline: z.array(videoTimelineClipSchema).min(1).max(100).optional(),
}).superRefine((batch, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: '批次范围、授权或关联不一致' })
  if (new Set(batch.items.map(i => i.shotId)).size !== batch.items.length || batch.maxCalls !== batch.items.length) invalid()
  if (batch.items.some(i => i.input.targetId !== i.shotId || i.input.toolId !== batch.toolId || !i.sourceRevisions[i.shotId] || (i.taskId === null) !== (i.recordId === null))) invalid()
  if (batch.authorizedAt && (!batch.expiresAt || !batch.allowUnknownCost || batch.items.reduce((sum, i) => sum + i.ceilingMicro, 0) > Math.round(batch.maxPoints * 1e6))) invalid()
  if (batch.state === 'active' && !batch.authorizedAt) invalid()
})
export const videoBatchCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('list'), projectId: z.uuid() }),
  z.strictObject({ op: z.literal('prepare'), projectId: z.uuid(), shotIds: z.array(z.uuid()).min(1).max(100), referenceVersionId: z.uuid().nullable(), purpose: z.enum(['narrative-production', 'technical-test']).default('narrative-production') }),
  z.strictObject({ op: z.literal('authorize'), projectId: z.uuid(), batchId: z.uuid(), expectedRevision: z.number().int().positive(), maxPoints: z.number().finite().nonnegative(), maxCostMicro: money.positive().nullable(), allowUnknownCost: z.literal(true) }),
  z.strictObject({ op: z.literal('pause'), projectId: z.uuid(), batchId: z.uuid() }),
  z.strictObject({ op: z.literal('resume'), projectId: z.uuid(), batchId: z.uuid() }),
  // Rework creates a new unapproved one-shot batch. It never spends the original approval twice.
  z.strictObject({ op: z.literal('rework'), projectId: z.uuid(), batchId: z.uuid(), shotId: z.uuid() }),
  z.strictObject({ op: z.literal('recoverOutput'), projectId: z.uuid(), batchId: z.uuid(), shotId: z.uuid() }),
  z.strictObject({ op: z.literal('export'), projectId: z.uuid(), batchId: z.uuid() }),
  z.strictObject({ op: z.literal('saveTimeline'), projectId: z.uuid(), batchId: z.uuid(), expectedRevision: z.number().int().positive(), clips: z.array(videoTimelineClipSchema).min(1).max(100) }),
])
export type NativeVideoBatch = z.infer<typeof nativeVideoBatchSchema>
export type VideoBatchItem = z.infer<typeof videoBatchItemSchema>
export type VideoBatchCommand = z.infer<typeof videoBatchCommandSchema>
