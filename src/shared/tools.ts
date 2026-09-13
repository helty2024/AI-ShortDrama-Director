import { z } from 'zod'
import {
  aspectRatioSchema,
  capabilityIdSchema,
  contractVersionSchema,
  durationRangeSchema,
  knowledgeSchema,
  resolutionSchema,
  supportSchema,
} from './capabilities/common.js'

export const toolIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .max(100)
export const toolVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
  .max(64)
export const toolKindSchema = z.enum(['api', 'application', 'builtin'])
export const toolExecutionModeSchema = z.enum([
  'cloud',
  'local-service',
  'managed-process',
  'internal',
])
export const toolAvailabilitySchema = z.enum([
  'available',
  'unavailable',
  'unknown',
])
export const requestFingerprintSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
export const runtimeRequirementsSchema = z.strictObject({
  memoryMB: knowledgeSchema(z.number().int().nonnegative()),
  gpuMemoryMB: knowledgeSchema(z.number().int().nonnegative()),
  dependencies: z
    .array(
      z.strictObject({
        id: toolIdSchema,
        version: toolVersionSchema.nullable(),
      }),
    )
    .max(128),
})
const referenceRangeSchema = z
  .strictObject({
    min: z.number().int().min(0).max(8),
    max: z.number().int().min(0).max(8),
  })
  .refine((v) => v.min <= v.max, 'Invalid reference range')
export const toolCapabilityDescriptorSchema = z.strictObject({
  capability: capabilityIdSchema,
  contractVersion: contractVersionSchema,
  models: knowledgeSchema(z.array(z.string().min(1).max(200)).min(1).max(100)),
  inputKinds: z
    .array(z.enum(['text', 'image', 'video', 'audio', 'scene']))
    .min(1)
    .max(5),
  referenceImages: knowledgeSchema(referenceRangeSchema),
  aspectRatios: knowledgeSchema(z.array(aspectRatioSchema).min(1).max(6)),
  resolutions: knowledgeSchema(z.array(resolutionSchema).min(1).max(64)),
  durationSeconds: knowledgeSchema(durationRangeSchema),
  outputMimes: z
    .array(
      z.enum([
        'application/json',
        'image/png',
        'image/jpeg',
        'image/webp',
        'video/mp4',
        'video/webm',
      ]),
    )
    .min(1)
    .max(6),
  seed: supportSchema,
  cancel: supportSchema,
  recover: supportSchema,
  estimate: supportSchema,
  locality: z.enum(['local', 'cloud']),
  resources: runtimeRequirementsSchema,
})
export const toolDescriptorSchema = z
  .strictObject({
    metadataVersion: z.literal('1.0.0'),
    id: toolIdSchema,
    name: z.string().trim().min(1).max(120),
    version: toolVersionSchema,
    kind: toolKindSchema,
    executionMode: toolExecutionModeSchema,
    availability: toolAvailabilitySchema,
    capabilities: z.array(toolCapabilityDescriptorSchema).min(1).max(8),
    runtimeRequirements: runtimeRequirementsSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (
      new Set(v.capabilities.map((c) => c.capability)).size !==
      v.capabilities.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate capability' })
    if (
      v.capabilities.some(
        (c) => c.locality !== (v.executionMode === 'cloud' ? 'cloud' : 'local'),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Execution locality mismatch' })
  })
export const toolIssueSchema = z.strictObject({
  code: z.enum([
    'invalid-input',
    'unsupported-capability',
    'missing-dependency',
    'tool-unavailable',
    'permission-required',
    'resource-insufficient',
    'configuration-error',
  ]),
  field: z.string().max(120).nullable(),
  message: z.string().min(1).max(500),
})
export const toolHealthSchema = z.strictObject({
  toolId: toolIdSchema,
  availability: toolAvailabilitySchema,
  checkedAt: z.iso.datetime(),
  issues: z.array(toolIssueSchema).max(100),
})
export const toolValidationSchema = z
  .strictObject({
    valid: z.boolean(),
    issues: z.array(toolIssueSchema).max(100),
    warnings: z.array(toolIssueSchema).max(100),
    requestFingerprint: requestFingerprintSchema,
  })
  .refine(
    (v) => v.valid === (v.issues.length === 0),
    'valid must agree with blocking issues',
  )
export const toolErrorCodeSchema = z.enum([
  'validation',
  'authentication',
  'authorization',
  'rate-limit',
  'network',
  'timeout',
  'provider',
  'dependency',
  'resource',
  'cancelled',
  'unknown-submission',
  'malformed-response',
])
export const toolErrorSchema = z
  .strictObject({
    code: toolErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryability: z.enum(['never', 'manual', 'after-delay', 'query-only']),
    details: z.strictObject({
      operation: z
        .enum([
          'describe',
          'health',
          'validate',
          'estimate',
          'submit',
          'status',
          'result',
          'cancel',
          'recover',
        ])
        .optional(),
      httpStatus: z.number().int().min(100).max(599).optional(),
      retryAfterSeconds: z.number().nonnegative().max(86400).optional(),
    }),
  })
  .refine(
    (v) => v.code !== 'unknown-submission' || v.retryability === 'query-only',
    'Unknown submission must not be resubmitted',
  )
export const toolTaskHandleSchema = z.strictObject({
  toolId: toolIdSchema,
  toolVersion: toolVersionSchema,
  externalTaskId: z.string().min(1).max(256),
})
export const toolPendingStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.enum(['accepted', 'queued', 'running']),
    progress: z.number().min(0).max(1).nullable(),
  }),
  z.strictObject({
    state: z.literal('unknown'),
    reason: z.enum(['submission-unconfirmed', 'status-unavailable']),
    resubmitAllowed: z.literal(false),
  }),
])
export const toolTaskStatusSchema = z.discriminatedUnion('state', [
  ...toolPendingStatusSchema.options,
  z.strictObject({ state: z.literal('succeeded') }),
  z.strictObject({ state: z.literal('failed'), error: toolErrorSchema }),
  z.strictObject({ state: z.literal('cancelled') }),
])
export function toolSubmitResultSchema<T extends z.ZodType>(output: T) {
  return z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('completed'), output }),
    z.strictObject({
      state: z.literal('accepted'),
      handle: toolTaskHandleSchema,
    }),
    z.strictObject({
      state: z.literal('unknown'),
      error: toolErrorSchema.refine((e) => e.code === 'unknown-submission'),
      resubmitAllowed: z.literal(false),
    }),
  ])
}
export function toolResultSchema<T extends z.ZodType>(output: T) {
  return z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('completed'), output }),
    z.strictObject({
      state: z.literal('not-ready'),
      status: toolPendingStatusSchema,
    }),
    z.strictObject({ state: z.literal('failed'), error: toolErrorSchema }),
  ])
}
export const toolCancelResultSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('cancelled') }),
  z.strictObject({
    state: z.literal('waiting-stopped'),
    computationMayContinue: z.literal(true),
  }),
  z.strictObject({ state: z.literal('unsupported') }),
  z.strictObject({ state: z.literal('unknown') }),
  z.strictObject({ state: z.literal('failed'), error: toolErrorSchema }),
])
export const toolRecoverResultSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('recovered'),
    handle: toolTaskHandleSchema,
    status: toolTaskStatusSchema,
  }),
  z.strictObject({ state: z.literal('unsupported') }),
  z.strictObject({
    state: z.literal('unknown'),
    resubmitAllowed: z.literal(false),
  }),
  z.strictObject({ state: z.literal('failed'), error: toolErrorSchema }),
])
export type ToolId = z.infer<typeof toolIdSchema>
export type ToolVersion = z.infer<typeof toolVersionSchema>
export type ToolKind = z.infer<typeof toolKindSchema>
export type ToolExecutionMode = z.infer<typeof toolExecutionModeSchema>
export type ToolAvailability = z.infer<typeof toolAvailabilitySchema>
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>
export type ToolCapabilityDescriptor = z.infer<
  typeof toolCapabilityDescriptorSchema
>
export type ToolHealth = z.infer<typeof toolHealthSchema>
export type ToolValidation = z.infer<typeof toolValidationSchema>
export type ToolError = z.infer<typeof toolErrorSchema>
export type ToolTaskHandle = z.infer<typeof toolTaskHandleSchema>
export type ToolTaskStatus = z.infer<typeof toolTaskStatusSchema>
export type ToolCancelResult = z.infer<typeof toolCancelResultSchema>
export type ToolRecoverResult = z.infer<typeof toolRecoverResultSchema>
export type ToolSubmitResult<O> = z.infer<
  ReturnType<typeof toolSubmitResultSchema<z.ZodType<O>>>
>
export type ToolResult<O> = z.infer<
  ReturnType<typeof toolResultSchema<z.ZodType<O>>>
>
export const toolCallContextSchema = z.strictObject({
  projectId: z.uuid(),
  model: z.string().min(1).max(200).nullable(),
  requestFingerprint: requestFingerprintSchema,
  routingDecisionId: z.uuid().nullable(),
})
export const toolExecutionContextSchema = toolCallContextSchema.extend({
  taskId: z.uuid(),
  estimateId: z.uuid(),
  approvalId: z.uuid().nullable(),
})
export type ToolCallContext = z.infer<typeof toolCallContextSchema>
export type ToolExecutionContext = z.infer<typeof toolExecutionContextSchema>
