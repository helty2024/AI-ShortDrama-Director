import { z } from 'zod'
const id = z.uuid(),
  text = z.string().max(20000),
  small = z.string().max(2000)
export const directionSchema = z.strictObject({
  startState: small,
  action: small,
  endState: small,
  subjectMovement: small,
  cameraMovement: small,
  performance: small,
  environmentMotion: small,
  speed: z.enum(['slow', 'normal', 'fast']),
  continuityNotes: small,
})
export const emptyDirection = directionSchema.parse({
  startState: '',
  action: '',
  endState: '',
  subjectMovement: '',
  cameraMovement: '',
  performance: '',
  environmentMotion: '',
  speed: 'normal',
  continuityNotes: '',
})
export const costSchema = z.strictObject({
  provider: small.nullable().default(null),
  model: small.nullable().default(null),
  duration: z.number().nullable().default(null),
  resolution: small.nullable().default(null),
  estimatedCost: z.number().nonnegative().nullable().default(null),
  actualCost: z.number().nonnegative().nullable().default(null),
  currency: small.nullable().default(null),
  billingMetadata: z.record(z.string(), z.json()).default({}),
})
export const emptyCost = costSchema.parse({
  provider: null,
  model: null,
  duration: null,
  resolution: null,
  estimatedCost: null,
  actualCost: null,
  currency: null,
  billingMetadata: {},
})
// Phase 3 accepted arbitrary cost JSON. Preserve it without pretending it is a price.
export const persistedCostSchema = z.preprocess((value) => {
  const current = costSchema.safeParse(value)
  if (current.success) return current.data
  const legacy = z.record(z.string(), z.json()).parse(value)
  return { ...emptyCost, billingMetadata: { legacy } }
}, costSchema)
export const videoCapabilitiesSchema = z.strictObject({
  endFrame: z.boolean(),
  referenceImages: z.boolean(),
  cancel: z.boolean(),
  durations: z.array(z.number().int().min(1).max(60)).min(1).max(60),
  resolutions: z.array(z.enum(['480p', '720p', '1080p'])).min(1),
  aspectRatios: z.array(z.enum(['9:16', '16:9', '1:1', '4:3'])).min(1),
  seed: z.boolean(),
})
export const conservativeCapabilities = videoCapabilitiesSchema.parse({
  endFrame: false,
  referenceImages: false,
  cancel: false,
  durations: [5, 10],
  resolutions: ['720p'],
  aspectRatios: ['9:16', '16:9', '1:1', '4:3'],
  seed: true,
})
export const videoProfileSchema = z.strictObject({
  id,
  name: z.string().min(1).max(120),
  provider: z.enum(['mock-video', 'seedance']),
  baseUrl: z.string().max(2000),
  taskPath: z.string().regex(/^\/[a-zA-Z0-9_/-]{1,200}$/),
  model: z.string().min(1).max(200),
  credentialRef: id.nullable(),
  timeoutSeconds: z.number().int().min(30).max(86400),
  pollingIntervalMs: z.number().int().min(100).max(60000),
  capabilities: videoCapabilitiesSchema,
})
export const defaultVideoProfile = videoProfileSchema.parse({
  id: '00000000-0000-4000-8000-000000000004',
  name: 'Mock Video',
  provider: 'mock-video',
  baseUrl: 'http://127.0.0.1',
  taskPath: '/contents/generations/tasks',
  model: 'deterministic-mp4-v1',
  credentialRef: null,
  timeoutSeconds: 120,
  pollingIntervalMs: 100,
  capabilities: {
    ...conservativeCapabilities,
    endFrame: false,
    cancel: true,
    durations: [1, 2, 3, 4, 5, 6, 8, 10],
    resolutions: ['480p', '720p'],
  },
})
export const videoPromptSchema = z.strictObject({
  sceneDescription: text,
  subject: text,
  characterConsistency: text,
  action: text,
  performance: text,
  cameraMovement: text,
  framing: small,
  lens: small,
  environment: text,
  lighting: small,
  continuity: text,
  startFrameAssetVersionId: id,
  optionalEndFrameAssetVersionId: id.nullable(),
  duration: z.number().int().min(1).max(60),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3']),
  negativePrompt: text,
  providerHints: z.record(z.string(), z.json()),
  promptVersion: small,
})
export const videoRequestSchema = z.strictObject({
  provider: z.enum(['mock-video', 'seedance']),
  prompt: videoPromptSchema,
  profile: videoProfileSchema,
  resolution: z.enum(['480p', '720p', '1080p']),
  seed: z.number().int().min(0).max(2147483647),
  referenceVersionIds: z.array(id).max(20),
  providerOptions: z.record(z.string(), z.json()),
})
export const videoTaskInputSchema = z.strictObject({
  type: z.literal('shot-video'),
  targetId: id,
  assetId: id,
  request: videoRequestSchema,
})
export const diagnosticSchema = z.strictObject({
  ready: z.boolean(),
  reachable: z.boolean(),
  missingNodes: z.array(small),
  missingInputs: z.array(small),
  checkpoints: z.array(small),
  variables: z.array(small),
  errors: z.array(small),
  warnings: z.array(small),
  checkedAt: z.iso.datetime(),
})
export const batchSchema = z.strictObject({
  id,
  projectId: id,
  name: small,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(['active', 'paused']).default('active'),
  kind: z.enum(['keyframe', 'video']),
  entries: z
    .array(
      z.strictObject({
        shotId: id,
        taskId: id.nullable(),
        error: small.nullable(),
      }),
    )
    .max(100),
})
const scope = { projectId: id }
const generation = {
  ...scope,
  shotId: id,
  profileId: id,
  assetId: id.nullable(),
  duration: z.number().int().min(1).max(60),
  resolution: z.enum(['480p', '720p', '1080p']),
  seed: z.number().int().min(0).max(2147483647),
  endFrameVersionId: id.nullable(),
  actionOverride: text.nullable(),
  costAccepted: z.boolean(),
}
export const productionCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...scope, operation: z.literal('snapshot') }),
  z.strictObject({ ...scope, operation: z.literal('diagnostics') }),
  z.strictObject({
    ...scope,
    operation: z.literal('diagnostics.test'),
    shotId: id,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('batch.compile'),
    shotIds: z.array(id).min(1).max(20),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('batch.start'),
    shotIds: z.array(id).min(1).max(20),
    provider: z.enum(['mock-image', 'comfyui']),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('profile.save'),
    profile: videoProfileSchema,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('credential.import'),
    profileId: id,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('profile.health'),
    profileId: id,
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('direction.save'),
    shotId: id,
    expectedRevision: z.number().int().positive(),
    direction: directionSchema,
    duration: z.number().int().min(1).max(60),
  }),
  z.strictObject({ ...generation, operation: z.literal('video.compile') }),
  z.strictObject({ ...generation, operation: z.literal('video.generate') }),
  z.strictObject({ ...scope, operation: z.literal('video.import') }),
])
export type ShotDirection = z.infer<typeof directionSchema>
export type CostMetadata = z.infer<typeof costSchema>
export type VideoProfile = z.infer<typeof videoProfileSchema>
export type VideoPromptPackage = z.infer<typeof videoPromptSchema>
export type VideoGenerationRequest = z.infer<typeof videoRequestSchema>
export type BatchGenerationGroup = z.infer<typeof batchSchema>
export type ProviderDiagnostics = z.infer<typeof diagnosticSchema>
export type ProductionCommand = z.infer<typeof productionCommandSchema>
export const productionSnapshotSchema = z.strictObject({
  profiles: z.array(videoProfileSchema),
  batches: z.array(batchSchema),
  credentials: z.record(z.string(), z.boolean()),
})
export type ProductionSnapshot = z.infer<typeof productionSnapshotSchema>
export const batchPreviewSchema = z.array(
  z.strictObject({ shotId: id, positivePrompt: text, error: small.nullable() }),
)
export type ProductionResult =
  | ProductionSnapshot
  | ProviderDiagnostics
  | VideoPromptPackage
  | BatchGenerationGroup
  | z.infer<typeof batchPreviewSchema>
