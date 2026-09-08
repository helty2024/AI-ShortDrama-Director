import { z } from 'zod'
import { videoProfileSchema, videoPromptSchema, batchSchema } from './video.js'
const id = z.uuid(),
  text = z.string().max(4000),
  ids = z.array(id).max(100)
const meta = {
  id,
  projectId: id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
}
export const characterContinuitySchema = z.strictObject({
  characterId: id,
  costume: text,
  hairstyle: text,
  makeup: text,
  injuries: z.array(text).max(30),
  carriedProps: ids,
  physicalState: text,
  emotionalState: text,
  position: text,
  notes: text,
})
export const propContinuitySchema = z.strictObject({
  propId: id,
  holderCharacterId: id.nullable(),
  state: text,
  location: text,
  visible: z.boolean(),
  notes: text,
})
export const locationContinuitySchema = z.strictObject({
  locationId: id,
  timeOfDay: text,
  lighting: text,
  weather: text,
  environmentState: text,
  damage: text,
  notes: text,
})
export const continuityStateSchema = z.strictObject({
  characters: z.array(characterContinuitySchema).max(100),
  props: z.array(propContinuitySchema).max(100),
  locations: z.array(locationContinuitySchema).max(100),
})
export const continuitySnapshotSchema = z.strictObject({
  ...meta,
  targetId: id,
  source: z.enum(['manual', 'plot']),
  state: continuityStateSchema,
})
export const continuityContextSchema = z.strictObject({
  shotId: id,
  sceneId: id,
  previousShotId: id.nullable(),
  state: continuityStateSchema,
  sources: ids,
  fingerprint: text,
})
const score = z.number().min(0).max(100)
export const qcIssueSchema = z.strictObject({
  category: z.enum([
    'identity',
    'costume',
    'location',
    'prop',
    'action',
    'camera',
    'visualIntegrity',
    'continuity',
  ]),
  severity: z.enum(['info', 'warning', 'severe']),
  description: text,
  affectedSubject: text,
  suggestedFix: text,
})
export const qcOutputSchema = z.strictObject({
  identityScore: score,
  costumeScore: score,
  locationScore: score,
  propScore: score,
  actionScore: score,
  cameraScore: score,
  visualIntegrityScore: score,
  continuityScore: score,
  overallScore: score,
  issues: z.array(qcIssueSchema).max(100),
  suggestions: z.array(text).max(100),
})
export const qcReportSchema = z.strictObject({
  ...meta,
  shotId: id,
  versionId: id,
  provider: text,
  contextFingerprint: text,
  status: z.enum(['pending', 'accepted', 'ignored', 'rejected']),
  output: qcOutputSchema,
})
export const rateSchema = z
  .strictObject({
    profileId: id,
    currency: z.string().min(1).max(8),
    minPerSecond: z.number().nonnegative(),
    maxPerSecond: z.number().nonnegative(),
  })
  .refine((v) => v.maxPerSecond >= v.minPerSecond)
export const productionSettingsSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  qcMode: z.enum(['strict', 'advisory']),
  preferredProfileId: id.nullable(),
  motionComplexity: z.enum(['subtle', 'normal', 'complex']),
  resolution: z.enum(['480p', '720p', '1080p']),
  rates: z.array(rateSchema).max(50),
})
export const defaultProductionSettings = productionSettingsSchema.parse({
  revision: 0,
  qcMode: 'advisory',
  preferredProfileId: null,
  motionComplexity: 'normal',
  resolution: '720p',
  rates: [],
})
export const costLineSchema = z.strictObject({
  id,
  taskId: id.nullable(),
  versionId: id.nullable(),
  shotId: id.nullable(),
  sceneId: id.nullable(),
  episodeId: id.nullable(),
  kind: z.enum(['image', 'video', 'qc']),
  estimatedMin: z.number().nonnegative().nullable(),
  estimatedMax: z.number().nonnegative().nullable(),
  actual: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
})
export const costSummarySchema = z.strictObject({
  currencies: z.array(
    z.strictObject({
      currency: z.string(),
      estimatedMin: z.number(),
      estimatedMax: z.number(),
      actual: z.number(),
    }),
  ),
  unknownEstimated: z.number(),
  unknownActual: z.number(),
  count: z.number(),
})
export const shotStatusSchema = z.strictObject({
  shotId: id,
  sceneId: id,
  episodeId: id,
  scriptReady: z.boolean(),
  shotPlanned: z.boolean(),
  keyframe: z.enum(['missing', 'generating', 'review', 'confirmed']),
  video: z.enum(['missing', 'generating', 'review', 'confirmed']),
  qc: z.enum(['missing', 'pending', 'passed', 'warning', 'ignored', 'stale']),
  failedTasks: ids,
  complete: z.boolean(),
  provider: text.nullable(),
  cost: costSummarySchema,
})
export const summarySchema = z.strictObject({
  id,
  name: text,
  total: z.number(),
  complete: z.number(),
  keyframes: z.number(),
  videos: z.number(),
  qcPassed: z.number(),
  review: z.number(),
  warnings: z.number(),
  failed: z.number(),
  cost: costSummarySchema,
})
export const capabilityRowSchema = z.strictObject({
  profile: videoProfileSchema,
  available: z.boolean(),
  textToVideo: z.boolean(),
  imageToVideo: z.boolean(),
  maxDuration: z.number(),
  reason: text,
  rate: rateSchema.nullable(),
})
export const routeSchema = z.strictObject({
  recommendedId: id.nullable(),
  reason: text,
  alternatives: ids,
})
export const batchItemSchema = z.strictObject({
  shotId: id,
  profileId: id.nullable(),
  prompt: videoPromptSchema.nullable(),
  resolution: z.enum(['480p', '720p', '1080p']),
  reason: text,
  error: text.nullable(),
  estimatedMin: z.number().nullable(),
  estimatedMax: z.number().nullable(),
  currency: z.string().nullable(),
  fingerprint: text,
})
export const batchPreviewSchema = z.strictObject({
  ...meta,
  items: z.array(batchItemSchema).max(20),
  cost: costSummarySchema,
  submittedGroupId: id.nullable(),
})
export const regenerationPlanSchema = z.strictObject({
  ...meta,
  reportId: id,
  shotId: id,
  versionId: id,
  instructions: z.array(text),
  newSeed: z.boolean(),
  alternateProfileId: id.nullable(),
  submittedTaskId: id.nullable(),
  executionState: z.enum(['ready', 'submitting', 'submitted']).default('ready'),
  requestFingerprint: text,
})
const scope = { projectId: id }
export const pilotCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...scope, operation: z.literal('snapshot') }),
  z.strictObject({
    ...scope,
    operation: z.literal('continuity.resolve'),
    shotId: id,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('continuity.save'),
    targetId: id,
    expectedRevision: z.number().int().nonnegative(),
    source: z.enum(['manual', 'plot']),
    state: continuityStateSchema,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('settings.save'),
    settings: productionSettingsSchema,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('qc.run'),
    shotId: id,
    versionId: id,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('qc.review'),
    id,
    expectedRevision: z.number().int().positive(),
    decision: z.enum(['accepted', 'ignored', 'rejected']),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('batch.preview'),
    shotIds: ids.min(1).max(20),
    profileId: id.nullable(),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('batch.confirm'),
    id,
    expectedRevision: z.number().int().positive(),
    costAccepted: z.boolean(),
  }),
  z.strictObject({ ...scope, operation: z.literal('batch.cancel'), id }),
  z.strictObject({
    ...scope,
    operation: z.literal('tasks.retry'),
    taskIds: ids.min(1).max(20),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('regeneration.plan'),
    reportId: id,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('regeneration.confirm'),
    id,
    expectedRevision: z.number().int().positive(),
    costAccepted: z.boolean(),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('manifest.export'),
    episodeId: id,
  }),
])
export const pilotSnapshotSchema = z.strictObject({
  continuity: z.array(continuitySnapshotSchema),
  reports: z.array(qcReportSchema),
  settings: productionSettingsSchema,
  statuses: z.array(shotStatusSchema),
  episodes: z.array(summarySchema),
  scenes: z.array(summarySchema),
  projectCost: costSummarySchema,
  categoryCosts: z.strictObject({
    image: costSummarySchema,
    video: costSummarySchema,
    qc: costSummarySchema,
  }),
  costLines: z.array(costLineSchema),
  capabilities: z.array(capabilityRowSchema),
  batches: z.array(batchSchema),
  previews: z.array(batchPreviewSchema),
  plans: z.array(regenerationPlanSchema),
})
export type ContinuityState = z.infer<typeof continuityStateSchema>
export type ContinuitySnapshot = z.infer<typeof continuitySnapshotSchema>
export type ContinuityContext = z.infer<typeof continuityContextSchema>
export type QCOutput = z.infer<typeof qcOutputSchema>
export type QCReport = z.infer<typeof qcReportSchema>
export type ProductionSettings = z.infer<typeof productionSettingsSchema>
export type CostLine = z.infer<typeof costLineSchema>
export type CostSummary = z.infer<typeof costSummarySchema>
export type ShotProductionStatus = z.infer<typeof shotStatusSchema>
export type CapabilityRow = z.infer<typeof capabilityRowSchema>
export type BatchPreview = z.infer<typeof batchPreviewSchema>
export type RegenerationPlan = z.infer<typeof regenerationPlanSchema>
export type PilotCommand = z.infer<typeof pilotCommandSchema>
export type PilotSnapshot = z.infer<typeof pilotSnapshotSchema>
export type PilotResult =
  | PilotSnapshot
  | ContinuityContext
  | ContinuitySnapshot
  | QCReport
  | BatchPreview
  | RegenerationPlan
  | string
  | null
