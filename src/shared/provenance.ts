import { z } from 'zod'
import { entitySchema } from './domain.js'
import { generationRecordSchema, generationEstimateSchema, importProvenanceSchema } from './generation.js'
import { routingDecisionSchema } from './routing.js'
import { capabilityIdSchema } from './capabilities/common.js'
import { toolIdSchema, toolVersionSchema } from './tools.js'
import { promptPackageSchema as imagePromptSchema } from './visual.js'
import { videoPromptSchema } from './video.js'

const targetType = z.enum(['script', 'episode', 'scene', 'character', 'location', 'prop', 'storyboard', 'shot', 'asset'])
export const persistedDecisionSchema = routingDecisionSchema.safeExtend({ workflowRunId: z.null(), stepRunId: z.null() })
export const persistedEstimateSchema = generationEstimateSchema.safeExtend({ routingDecisionId: z.uuid() })
export const provenancePromptSchema = z.strictObject({
  id: z.uuid(), projectId: z.uuid(), targetObjectId: z.uuid(), targetObjectType: targetType,
  semanticInputSnapshot: z.strictObject({ target: entitySchema, context: z.array(entitySchema).max(1000) }),
  compiledPrompt: z.union([imagePromptSchema, videoPromptSchema]),
  compilerVersion: z.string().min(1).max(100),
  skillId: toolIdSchema.nullable(), skillVersion: toolVersionSchema.nullable(),
  targetCapability: capabilityIdSchema, targetToolId: toolIdSchema.nullable(), targetModel: z.string().max(200).nullable(),
  createdAt: z.iso.datetime(),
}).refine(v => (v.skillId === null) === (v.skillVersion === null), 'Skill version must be paired')
export const persistedRecordSchema = generationRecordSchema.safeExtend({
  targetObjectType: targetType,
  approvalId: z.uuid().nullable(),
})
// Output IDs are a read projection only. The association table is the sole stored source.
export const storedRecordSchema = z.preprocess(value => value && typeof value === 'object' ? { ...value, outputAssetVersionIds: [] } : value, persistedRecordSchema).transform(({ outputAssetVersionIds: _outputs, ...record }) => record)
export const generationOutputSchema = z.strictObject({
  id: z.uuid(), projectId: z.uuid(), generationRecordId: z.uuid(), assetVersionId: z.uuid(),
  outputIndex: z.number().int().min(0).max(99), role: z.string().min(1).max(80), createdAt: z.iso.datetime(),
})
export const taskGenerationLinkSchema = z.strictObject({
  id: z.uuid(), projectId: z.uuid(), generationRecordId: z.uuid(), taskId: z.uuid(), createdAt: z.iso.datetime(),
})
export const persistedImportSchema = importProvenanceSchema.extend({
  outputAssetVersionIds: z.array(z.uuid()).length(1),
  originalName: z.string().min(1).max(255).refine(v => !/[\\/]/.test(v) && !/^[a-z]:/i.test(v), 'Only a basename is allowed'),
  originalMime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'video/mp4']),
  sourceApplication: z.string().max(120).nullable(),
})
export const provenanceTables = {
  routing_decisions: persistedDecisionSchema,
  generation_estimates: persistedEstimateSchema,
  prompt_packages: provenancePromptSchema,
  generation_records: storedRecordSchema,
  task_generation_links: taskGenerationLinkSchema,
  generation_outputs: generationOutputSchema,
  import_provenance: persistedImportSchema,
} as const
export type ProvenanceTable = keyof typeof provenanceTables
export type ProvenanceRecord = z.infer<typeof persistedRecordSchema>
export type ProvenancePrompt = z.infer<typeof provenancePromptSchema>
export type GenerationOutput = z.infer<typeof generationOutputSchema>
export type PersistedImport = z.infer<typeof persistedImportSchema>
