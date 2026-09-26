import { z } from 'zod'
import { imagePreviewInputSchema } from './image-api.js'
import { videoApiPreviewInputSchema, videoApiPreviewSchema } from './video-api.js'

export const workflowTypeSchema = z.enum(['shot-keyframe', 'shot-video'])
export const workflowInputSchema = z.discriminatedUnion('workflowType', [
  z.strictObject({ workflowType: z.literal('shot-keyframe'), generation: imagePreviewInputSchema.extend({ count: z.literal(1) }) }),
  z.strictObject({ workflowType: z.literal('shot-video'), generation: videoApiPreviewInputSchema }),
])
export const workflowStatusSchema = z.enum(['pending', 'running', 'waiting-user', 'succeeded', 'failed', 'cancelled'])
export const stepTypeSchema = z.enum(['prepare', 'generate-image', 'review-image', 'adopt-image', 'generate-video', 'review-video', 'adopt-video', 'complete'])
export const workflowPreviewSchema = z.union([
  videoApiPreviewSchema,
  z.strictObject({
    id: z.uuid(), projectId: z.uuid(), target: z.string(), tool: z.string(), model: z.string(), prompt: z.string(),
    count: z.number().int().positive(), resolution: z.object({ width: z.number(), height: z.number() }),
    referenceCount: z.number().int().nonnegative(), currency: z.string(), estimate: z.string(), expiresAt: z.iso.datetime(),
    disclosure: z.string(), executionMode: z.enum(['cloud', 'local-service']), knownFree: z.boolean(),
  }),
])
const errorSchema = z.strictObject({ code: z.string().max(100), message: z.string().max(1000), stepKey: stepTypeSchema })
const decisionSchema = z.strictObject({
  id: z.uuid(), action: z.enum(['confirm-generation', 'approve-candidate', 'reject-candidate', 'adopt-candidate']),
  at: z.iso.datetime(), versionId: z.uuid().nullable(), maxCostMicro: z.number().int().nonnegative().nullable(),
  allowUnknownCost: z.boolean().nullable(),
})
const base = { id: z.uuid(), projectId: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), revision: z.number().int().positive() }
const times = { startedAt: z.iso.datetime().nullable(), completedAt: z.iso.datetime().nullable(), failedAt: z.iso.datetime().nullable() }
export const workflowRunSchema = z.strictObject({
  ...base, ...times, workflowType: workflowTypeSchema, targetObjectType: z.literal('shot'), targetObjectId: z.uuid(),
  status: workflowStatusSchema, currentStepKey: stepTypeSchema, requestedBy: z.literal('local-user'),
  inputSnapshot: workflowInputSchema, executionAllowed: z.boolean(),
  resultSummary: z.strictObject({ assetVersionId: z.uuid().nullable(), adopted: z.boolean(), reason: z.string().max(1000).nullable() }),
  errorSummary: errorSchema.nullable(),
})
export const stepRunSchema = z.strictObject({
  ...base, ...times, workflowRunId: z.uuid(), stepKey: stepTypeSchema, stepType: stepTypeSchema,
  sequence: z.number().int().nonnegative(), status: z.enum(['pending', 'running', 'waiting-user', 'succeeded', 'failed', 'skipped', 'cancelled']),
  attemptCount: z.number().int().min(0).max(1), inputSnapshot: workflowInputSchema,
  outputSnapshot: z.strictObject({ preview: workflowPreviewSchema.nullable(), decisions: z.array(decisionSchema).max(3) }),
  errorSummary: errorSchema.nullable(),
  relatedTaskId: z.uuid().nullable(), relatedGenerationRecordId: z.uuid().nullable(), relatedAssetVersionId: z.uuid().nullable(),
  relatedReviewId: z.uuid().nullable(), relatedApprovalId: z.uuid().nullable(),
})
export const workflowSnapshotSchema = z.strictObject({ run: workflowRunSchema, steps: z.array(stepRunSchema) })
const identity = { projectId: z.uuid(), runId: z.uuid() }
export const workflowCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('createWorkflowRun'), input: workflowInputSchema }),
  z.strictObject({ op: z.literal('getWorkflowRun'), ...identity }),
  z.strictObject({ op: z.literal('listWorkflowRuns'), projectId: z.uuid() }),
  z.strictObject({ op: z.literal('resumeWorkflowRun'), ...identity }),
  z.strictObject({ op: z.literal('cancelWorkflowRun'), ...identity }),
  z.strictObject({ op: z.literal('submitWorkflowUserDecision'), ...identity, expectedRevision: z.number().int().positive(), decision: z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('confirm-generation'), previewId: z.uuid(), maxCostMicro: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), allowUnknownCost: z.boolean() }),
    z.strictObject({ action: z.enum(['approve-candidate', 'reject-candidate', 'adopt-candidate']), versionId: z.uuid(), versionRevision: z.number().int().positive(), targetRevision: z.number().int().positive() }),
  ]) }),
])
export type WorkflowInput = z.infer<typeof workflowInputSchema>
export type WorkflowRun = z.infer<typeof workflowRunSchema>
export type StepRun = z.infer<typeof stepRunSchema>
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>
export type WorkflowCommand = z.infer<typeof workflowCommandSchema>
export const workflowTables = { workflow_runs: workflowRunSchema, step_runs: stepRunSchema }
