import { z } from 'zod'
import {
  capabilityIdSchema,
  contractVersionSchema,
} from './capabilities/common.js'
import { toolIdSchema, toolVersionSchema } from './tools.js'

export const currencySchema = z.string().regex(/^[A-Z]{3}$/)
// Integer micro-units avoid floating point currency comparisons. Unknown is a separate branch.
export const moneySchema = z.strictObject({
  amountMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: currencySchema,
})
export const routingModeSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('AUTO') }),
  z.strictObject({
    mode: z.literal('fixed'),
    toolId: toolIdSchema,
    toolVersion: toolVersionSchema.optional(),
    model: z.string().min(1).max(200).nullable().default(null),
  }),
])
export const hardConstraintsSchema = z.strictObject({
  locality: z.enum(['local-only', 'cloud-only', 'either']),
  allowAssetUpload: z.boolean(),
  budget: moneySchema.nullable(),
  requiredAvailability: z.literal('available'),
  availableMemoryMB: z.number().int().nonnegative().nullable(),
  availableGpuMemoryMB: z.number().int().nonnegative().nullable(),
  privacy: z.enum(['public', 'project-private', 'sensitive-local-only']).optional(),
  cloudAllowed: z.boolean().optional(),
  networkAvailable: z.boolean().nullable().optional(),
})
export const preferenceInputsSchema = z
  .strictObject({
    order: z.array(z.enum(['cost', 'speed', 'quality'])).max(3),
    quality: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('unknown') }),
      z.strictObject({
        status: z.literal('known'),
        evaluationId: z.uuid(),
        evaluationVersion: toolVersionSchema,
      }),
    ]),
  })
  .refine(
    (v) => new Set(v.order).size === v.order.length,
    'Duplicate preference',
  )
export const routingPolicySchema = z.strictObject({
  version: z.literal('1.0.0'),
  selection: routingModeSchema,
  hardConstraints: hardConstraintsSchema,
  preferences: preferenceInputsSchema,
  unknown: z.strictObject({
    cost: z.enum(['allow', 'reject']),
    duration: z.enum(['allow', 'reject']),
    quality: z.enum(['allow', 'reject']),
    resources: z.enum(['allow', 'reject']),
  }).optional(),
})
export const rejectionCodeSchema = z.enum([
  'capability-mismatch', 'privacy-conflict', 'execution-mode-conflict',
  'unavailable', 'resource-insufficient', 'budget-exceeded',
  'unknown-not-allowed', 'fixed-tool-unusable', 'preflight-invalid',
])
// Semantic routing inputs may affect a fingerprint; decision IDs and creation times do not.
export const routingSemanticInputSchema = z.strictObject({
  policy: routingPolicySchema,
  requestedCapability: capabilityIdSchema,
})
export const routingDecisionSchema = z
  .strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    workflowRunId: z.uuid().nullable(),
    stepRunId: z.uuid().nullable(),
    requestedCapability: capabilityIdSchema,
    contractVersion: contractVersionSchema,
    routingMode: routingModeSchema,
    selectedToolId: toolIdSchema,
    selectedToolVersion: toolVersionSchema,
    selectedModel: z.string().min(1).max(200).nullable(),
    decisionReasons: z.array(z.string().min(1).max(500)).min(1).max(32),
    rejectedCandidates: z
      .array(
        z.strictObject({
          toolId: toolIdSchema,
          reason: z.string().min(1).max(500),
          code: rejectionCodeSchema.optional(),
          toolVersion: toolVersionSchema.optional(),
        }),
      )
      .max(100),
    hardConstraints: hardConstraintsSchema,
    preferenceInputs: preferenceInputsSchema,
    policyVersion: z.literal('1.0.0'),
    policySnapshot: routingPolicySchema.optional(),
    candidateEvidence: z.array(z.strictObject({
      toolId: toolIdSchema, toolVersion: toolVersionSchema, model: z.string().nullable(),
      healthCheckedAt: z.iso.datetime().nullable(),
      estimateId: z.uuid().nullable(), cost: moneySchema.nullable(),
      durationMaxSeconds: z.number().nonnegative().nullable(),
      qualityScore: z.number().min(0).max(1).nullable(),
      qualityEvidence: z.string().max(500).nullable(),
    })).optional(),
    createdAt: z.iso.datetime(),
  })
  .superRefine((v, ctx) => {
    if (
      v.routingMode.mode === 'fixed' &&
      (v.routingMode.toolId !== v.selectedToolId ||
        (v.routingMode.toolVersion !== undefined && v.routingMode.toolVersion !== v.selectedToolVersion) ||
        v.routingMode.model !== v.selectedModel)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Fixed selection must match decision',
      })
  })
export type RoutingPolicy = z.infer<typeof routingPolicySchema>
export type RoutingDecision = z.infer<typeof routingDecisionSchema>
