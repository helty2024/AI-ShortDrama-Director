import { z } from 'zod'

export const skillStageSchema = z.enum(['script', 'director', 'video-prompt'])
export type SkillStage = z.infer<typeof skillStageSchema>
export const skillOutputSchema = z.strictObject({
  summary: z.string().max(16000),
  suggestions: z.array(z.strictObject({
    shotId: z.uuid().nullable(), advice: z.string().max(12000),
    ruleIds: z.array(z.string().max(100)).max(20),
  })).max(100),
  continuity56: z.string().max(12000),
  references: z.array(z.strictObject({ entityId: z.uuid(), usage: z.string().max(3000), verified: z.boolean() })).max(100),
  videoPrompts: z.array(z.strictObject({ shotId: z.uuid(), prompt: z.string().max(12000), provisional: z.boolean() })).max(20),
  notApplicable: z.array(z.string().max(3000)).max(30),
})
const scope = { projectId: z.uuid() }
export const skillExperimentCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('list'), ...scope }),
  z.strictObject({ op: z.literal('toggle'), ...scope, enabled: z.boolean() }),
  z.strictObject({ op: z.literal('prepare'), ...scope, stage: skillStageSchema, sceneId: z.uuid(), shotIds: z.array(z.uuid()).min(1).max(20), target: z.enum(['generic', 'seedance-2.0']) }),
  z.strictObject({ op: z.literal('runComparisons'), ...scope, ids: z.array(z.uuid()).length(3), confirmed: z.literal(true), maxRequests: z.literal(6), currency: z.string().regex(/^[A-Z]{3}$/), maxCostMicro: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), allowUnknownCost: z.literal(true) }),
])
export type SkillExperimentCommand = z.infer<typeof skillExperimentCommandSchema>
export const skillTraceSchema = z.strictObject({
  name: z.literal('seedance-20'), version: z.literal('6.7.0'), commit: z.literal('4668457e560eee06e95d7fcfdf441c8c0bba802e'),
  contentHash: z.string(), files: z.array(z.strictObject({ path: z.string(), sha256: z.string(), section: z.string() })), ruleIds: z.array(z.string()),
})
export const skillExperimentSchema = z.strictObject({
  id: z.uuid(), projectId: z.uuid(), stage: skillStageSchema, createdAt: z.iso.datetime(),
  inputHash: z.string(), sourceHash: z.string(), modelSnapshot: z.record(z.string(), z.json()),
  target: z.enum(['generic', 'seedance-2.0']), sceneId: z.uuid(), shotIds: z.array(z.uuid()),
  requests: z.array(z.strictObject({ enabled: z.boolean(), system: z.string(), input: z.json(), fingerprint: z.string(), bytes: z.number(), trace: skillTraceSchema.nullable() })).length(2),
  historicalBaseline: z.json(), offlineAdvice: z.array(z.string()),
  status: z.enum(['offline', 'running', 'completed', 'failed', 'unknown']),
  attempts: z.array(z.strictObject({ enabled: z.boolean(), status: z.enum(['intent', 'succeeded', 'failed', 'unknown']), output: skillOutputSchema.nullable(), rawOutput: z.string().nullable(), error: z.string().nullable() })).max(2),
  budget: z.strictObject({ currency: z.string(), maxCostMicro: z.number(), maxRequests: z.literal(6), actualCost: z.null() }).nullable(),
})
export type SkillExperiment = z.infer<typeof skillExperimentSchema>
export const skillExperimentSnapshotSchema = z.strictObject({ enabled: z.boolean(), experiments: z.array(skillExperimentSchema) })
