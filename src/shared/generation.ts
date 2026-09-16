import { z } from 'zod'
import { capabilitySnapshotSchema } from './capabilities/index.js'
import {
  capabilityIdSchema,
  durationRangeSchema,
} from './capabilities/common.js'
import {
  moneySchema,
  currencySchema,
  routingSemanticInputSchema,
} from './routing.js'
import {
  requestFingerprintSchema,
  toolIdSchema,
  toolVersionSchema,
} from './tools.js'

export const estimatedDurationSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), seconds: durationRangeSchema }),
  z.strictObject({ status: z.literal('unknown') }),
])
export const estimatedCostSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), estimatedCost: moneySchema }),
  z.strictObject({
    status: z.literal('unknown'),
    reason: z.enum([
      'unsupported',
      'unavailable',
      'insufficient-input',
      'not-quoted',
    ]),
  }),
])
export const generationEstimateSchema = z
  .strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    routingDecisionId: z.uuid().nullable(),
    requestFingerprint: requestFingerprintSchema,
    cost: estimatedCostSchema,
    // Older quotes omit this; new unknown-price quotes still declare their billing currency.
    currency: currencySchema.optional(),
    estimatedDurationRange: estimatedDurationSchema,
    billingRisk: z.enum(['free', 'may-charge', 'unknown']),
    basis: z.string().min(1).max(1000),
    createdAt: z.iso.datetime(),
    validUntil: z.iso.datetime(),
  })
  .superRefine((v, ctx) => {
    if (v.currency && v.cost.status === 'known' && v.currency !== v.cost.estimatedCost.currency) ctx.addIssue({ code: 'custom', message: 'Quote currency mismatch' })
    if (Date.parse(v.validUntil) <= Date.parse(v.createdAt))
      ctx.addIssue({
        code: 'custom',
        message: 'Estimate must expire after creation',
      })
    if (
      v.billingRisk === 'free' &&
      (v.cost.status !== 'known' || v.cost.estimatedCost.amountMicros !== 0)
    )
      ctx.addIssue({ code: 'custom', message: 'Free requires known zero cost' })
  })
const approvalItemSchema = z.strictObject({
  requestFingerprint: requestFingerprintSchema,
  routingDecisionId: z.uuid(),
  estimateId: z.uuid(),
})
export const generationApprovalSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  requestFingerprint: requestFingerprintSchema,
  routingDecisionId: z.uuid(),
  estimateId: z.uuid(),
  currency: currencySchema,
  maxAuthorizedCost: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER), // micro-units
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('single'), taskId: z.uuid() }),
    z.strictObject({
      kind: z.literal('batch'),
      batchId: z.uuid(),
      items: z.array(approvalItemSchema).min(1).max(100),
    }),
  ]),
  approvedAt: z.iso.datetime(),
})
const sourceRevisionsSchema = z
  .record(z.uuid(), z.number().int().positive())
  .refine((v) => Object.keys(v).length <= 1000, 'Too many sources')
export const fingerprintMaterialSchema = z
  .strictObject({
    fingerprintVersion: z.literal('1'),
    snapshot: capabilitySnapshotSchema,
    toolId: toolIdSchema,
    toolVersion: toolVersionSchema,
    model: z.string().min(1).max(200).nullable(),
    sourceRevisions: sourceRevisionsSchema,
    routing: routingSemanticInputSchema.nullable(),
  })
  .refine(
    (v) =>
      !v.routing || v.routing.requestedCapability === v.snapshot.capability,
    'Routing capability mismatch',
  )
export const generationRecordSchema = z
  .strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    targetObjectId: z.uuid(),
    generationType: capabilityIdSchema,
    sourceRevisions: sourceRevisionsSchema,
    inputAssetVersionIds: z.array(z.uuid()).max(100),
    skillId: toolIdSchema.nullable(),
    skillVersion: toolVersionSchema.nullable(),
    workflowTemplateId: toolIdSchema.nullable(),
    workflowVersion: toolVersionSchema.nullable(),
    promptPackageId: z.uuid().nullable(),
    routingDecisionId: z.uuid(),
    toolId: toolIdSchema,
    toolVersion: toolVersionSchema,
    modelId: z.string().min(1).max(200).nullable(),
    parameters: capabilitySnapshotSchema,
    requestFingerprint: requestFingerprintSchema,
    seed: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    estimateId: z.uuid(),
    approvalId: z.uuid().nullable(),
    estimatedCost: estimatedCostSchema,
    actualCost: moneySchema.nullable(),
    currency: currencySchema.nullable(),
    costStatus: z.enum(['unknown', 'pending', 'known']),
    taskId: z.uuid(),
    parentGenerationRecordId: z.uuid().nullable(),
    attemptType: z.enum(['initial', 'retry', 'regenerate']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    actualDuration: z.number().nonnegative().nullable(),
    outputAssetVersionIds: z.array(z.uuid()).max(100),
    outcome: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'unknown', 'unknown-submission', 'malformed-output', 'other']),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (v.parameters.capability !== v.generationType)
      issue('Capability mismatch')
    if (
      (v.skillId === null) !== (v.skillVersion === null) ||
      (v.workflowTemplateId === null) !== (v.workflowVersion === null)
    )
      issue('Version identity must be paired')
    if ((v.attemptType === 'initial') !== (v.parentGenerationRecordId === null))
      issue('Attempt parent mismatch')
    if (v.parentGenerationRecordId === v.id) issue('Self-parent not allowed')
    if ((v.costStatus === 'known') !== (v.actualCost !== null))
      issue('Known actual cost requires value')
    if (v.actualCost && v.actualCost.currency !== v.currency)
      issue('Currency mismatch')
    if (
      v.estimatedCost.status === 'known' &&
      v.estimatedCost.estimatedCost.currency !== v.currency
    )
      issue('Estimate currency mismatch')
    if ('seed' in v.parameters.input && v.parameters.input.seed !== v.seed)
      issue('Seed snapshot mismatch')
    if (
      v.startedAt &&
      v.completedAt &&
      Date.parse(v.completedAt) < Date.parse(v.startedAt)
    )
      issue('Invalid execution interval')
  })
export const importProvenanceSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  source: z.enum(['file-import', 'legacy-import']),
  contentHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable(),
  importedAt: z.iso.datetime(),
  outputAssetVersionIds: z.array(z.uuid()).min(1).max(100),
  description: z.string().max(500),
})
// Workflow position only. Execution states remain in the existing AITask contract.
export const stepRunSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  workflowRunId: z.uuid(),
  stepKey: toolIdSchema,
  state: z.enum(['pending', 'blocked', 'waiting-for-review', 'completed']),
  taskIds: z.array(z.uuid()).max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type GenerationEstimate = z.infer<typeof generationEstimateSchema>
export type GenerationApproval = z.infer<typeof generationApprovalSchema>
export type GenerationRecord = z.infer<typeof generationRecordSchema>
export type ImportProvenance = z.infer<typeof importProvenanceSchema>
export type StepRun = z.infer<typeof stepRunSchema>
export type FingerprintMaterial = z.infer<typeof fingerprintMaterialSchema>
