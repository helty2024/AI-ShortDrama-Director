import { z } from 'zod'
import { persistedRecordSchema } from './provenance.js'

const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const currency = z.string().regex(/^[A-Z]{3}$/)
const date = z.iso.datetime()
const identity = { id: z.uuid(), projectId: z.uuid(), createdAt: date }
export const approvalBindingSchema = z.object(persistedRecordSchema.shape).pick({ targetObjectId: true, targetObjectType: true, requestFingerprint: true, routingDecisionId: true, estimateId: true, promptPackageId: true, toolId: true, toolVersion: true, modelId: true, sourceRevisions: true, inputAssetVersionIds: true }).strip()
export const approvalSchema = z.strictObject({
  ...identity, scope: z.enum(['single', 'batch']), currency, maxAuthorizedCostMicro: money,
  itemIds: z.array(z.uuid()).min(1).max(1000), requestFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(), batchFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  status: z.enum(['active', 'invalid', 'historical']), approvedAt: date, expiresAt: date,
  invalidatedAt: date.nullable(), invalidationReason: z.string().min(1).max(1000).nullable(),
}).refine(v => new Set(v.itemIds).size === v.itemIds.length && (v.scope !== 'single' || v.itemIds.length === 1))
  .refine(v => v.scope === 'single' ? v.requestFingerprint !== null && v.batchFingerprint === null : v.requestFingerprint === null && v.batchFingerprint !== null)
  .refine(v => v.expiresAt > v.approvedAt && (v.status === 'active' ? v.invalidatedAt === null && v.invalidationReason === null : v.invalidatedAt !== null && v.invalidationReason !== null))
export const approvalItemSchema = z.strictObject({
  ...identity, ...approvalBindingSchema.shape, approvalId: z.uuid(), currency,
  estimatedMaxCostMicro: money, allowUnknownCost: z.boolean(), status: z.enum(['authorized', 'historical']),
})
export const reservationStatusSchema = z.enum(['reserved', 'submitted', 'pending-unknown', 'consumed', 'released', 'cancelled-before-submit', 'requires-review', 'historical'])
export const reservationSchema = z.strictObject({
  ...identity, approvalId: z.uuid(), approvalItemId: z.uuid(), generationRecordId: z.uuid(), taskId: z.uuid(),
  reservedAmountMicro: money, currency, status: reservationStatusSchema,
  actualAmountMicro: money.nullable(), submissionIntentAt: date.nullable(), releasedAt: date.nullable(), consumedAt: date.nullable(),
  evidence: z.string().min(1).max(2000).nullable(), historicalStatus: reservationStatusSchema.exclude(['historical']).nullable(),
}).refine(v => (v.status === 'historical') === (v.historicalStatus !== null))
  .refine(v => v.status === 'historical' || (['consumed', 'requires-review'].includes(v.status) ? v.actualAmountMicro !== null && v.consumedAt !== null && v.evidence !== null : v.actualAmountMicro === null && v.consumedAt === null))
  .refine(v => !['submitted', 'pending-unknown'].includes(v.status) || v.submissionIntentAt !== null)
  .refine(v => !['released', 'cancelled-before-submit'].includes(v.status) || v.releasedAt !== null)
export const approvalTables = { generation_approvals: approvalSchema, approval_items: approvalItemSchema, approval_reservations: reservationSchema } as const
export type Approval = z.infer<typeof approvalSchema>
export type ApprovalItem = z.infer<typeof approvalItemSchema>
export type Reservation = z.infer<typeof reservationSchema>
export type ApprovalTable = keyof typeof approvalTables
