import { z } from 'zod'
const id = z.uuid()
const text = z.string().max(100000)
const small = z.string().max(2000)
const meta = {
  id,
  projectId: id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
}
export const referenceRoleSchema = z.enum([
  'faceReference',
  'fullBodyReference',
  'costumeReference',
  'expressionReference',
  'masterReference',
  'angleReference',
  'lightingReference',
  'detailReference',
])
export const visualReferenceSchema = z.strictObject({
  assetId: id,
  role: referenceRoleSchema,
  primary: z.boolean(),
})
export const assetSourceSchema = z.enum([
  'imported',
  'generated',
  'edited',
  'derived',
  'reference',
])
export const versionStatusSchema = z.enum([
  'draft',
  'approved',
  'rejected',
  'archived',
])
export const promptPackageSchema = z.strictObject({
  positivePrompt: text,
  negativePrompt: text,
  subjectDescription: text,
  composition: small,
  camera: small,
  lighting: small,
  style: small,
  continuity: text,
  referenceAssetIds: z.array(id).max(100),
  providerHints: z.record(z.string(), z.json()),
  promptVersion: small,
})
export const assetVersionSchema = z.strictObject({
  ...meta,
  assetId: id,
  versionNumber: z.number().int().positive(),
  status: versionStatusSchema,
  sourceType: assetSourceSchema,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fileSize: z.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  storageKey: small,
  thumbnailPath: small,
  provider: small.nullable(),
  model: small.nullable(),
  prompt: text,
  negativePrompt: text,
  generationTaskId: id.nullable(),
  sourceAssetIds: z.array(id),
  metadata: z.record(z.string(), z.json()),
})
export const workflowSchema = z
  .record(
    z.string().min(1).max(100),
    z
      .object({
        class_type: z.string().min(1).max(200),
        inputs: z.record(z.string(), z.json()),
      })
      .catchall(z.json()),
  )
  .refine(
    (v) => Object.keys(v).length > 0 && Object.keys(v).length <= 500,
    '工作流需包含 1–500 个 API 节点',
  )
export const workflowTemplateSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().min(1).max(120),
  workflow: workflowSchema,
})
export const providerSettingsSchema = z.strictObject({
  provider: z.enum(['mock-image', 'comfyui']),
  baseUrl: z.string().max(2000),
  templateId: z.string().max(80),
  checkpoint: z.string().max(300),
  width: z.number().int().min(64).max(2048).multipleOf(8),
  height: z.number().int().min(64).max(2048).multipleOf(8),
  seedMode: z.enum(['fixed', 'random']),
  seed: z.number().int().min(0).max(2147483647),
  steps: z.number().int().min(1).max(150),
  cfg: z.number().min(0).max(30),
  style: small,
})
export const defaultProviderSettings = providerSettingsSchema.parse({
  provider: 'mock-image',
  baseUrl: 'http://127.0.0.1:8188',
  templateId: 'shot-keyframe',
  checkpoint: '',
  width: 512,
  height: 768,
  seedMode: 'fixed',
  seed: 42,
  steps: 20,
  cfg: 7,
  style: 'cinematic, realistic photography',
})
export const imageRequestSchema = z.strictObject({
  prompt: promptPackageSchema,
  width: z.number().int().min(64).max(2048),
  height: z.number().int().min(64).max(2048),
  seed: z.number().int().nonnegative(),
  provider: z.enum(['mock-image', 'comfyui']),
  providerOptions: z.record(z.string(), z.json()),
  referenceVersionIds: z.array(id).max(100),
})
export const imageTaskTypeSchema = z.enum([
  'character-image',
  'location-image',
  'prop-image',
  'shot-keyframe',
])
export const imageTaskInputSchema = z.strictObject({
  type: imageTaskTypeSchema,
  targetId: id,
  assetId: id,
  request: imageRequestSchema,
})
export const imageTaskFields = {
  providerTaskId: z.string().max(200).nullable().default(null),
  progress: z.number().min(0).max(1).default(0),
  outputAssetVersionIds: z.array(id).default([]),
  provider: small.nullable().default(null),
  model: small.nullable().default(null),
  costMetadata: z.record(z.string(), z.json()).default({}),
  startedAt: z.iso.datetime().nullable().default(null),
  completedAt: z.iso.datetime().nullable().default(null),
}
const scope = { projectId: id }
const versioned = {
  ...scope,
  id,
  expectedRevision: z.number().int().positive(),
}
export const visualCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...scope, operation: z.literal('snapshot') }),
  z.strictObject({
    ...scope,
    operation: z.literal('settings.save'),
    settings: providerSettingsSchema,
  }),
  z.strictObject({ ...scope, operation: z.literal('health') }),
  z.strictObject({ ...scope, operation: z.literal('workflow.import') }),
  z.strictObject({
    ...scope,
    operation: z.literal('asset.import'),
    assetId: id.nullable(),
    targetId: id.nullable(),
  }),
  z.strictObject({ ...versioned, operation: z.literal('asset.delete') }),
  z.strictObject({
    ...scope,
    operation: z.literal('media.read'),
    versionId: id,
    thumbnail: z.boolean(),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('compile'),
    targetId: id,
    previousShot: z.boolean(),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('generate'),
    targetId: id,
    assetId: id.nullable(),
    provider: z.enum(['mock-image', 'comfyui']),
    positivePrompt: text.nullable(),
    negativePrompt: text.nullable(),
    previousShot: z.boolean(),
  }),
  z.strictObject({
    ...versioned,
    operation: z.literal('version.review'),
    status: versionStatusSchema,
    targetId: id.nullable(),
    targetRevision: z.number().int().positive().nullable(),
  }),
  z.strictObject({
    ...versioned,
    operation: z.literal('references.save'),
    references: z.array(visualReferenceSchema).max(100),
  }),
  z.strictObject({ ...scope, operation: z.literal('orphans.scan') }),
])
export type ImagePromptPackage = z.infer<typeof promptPackageSchema>
export type AssetVersion = z.infer<typeof assetVersionSchema>
export type ProviderSettings = z.infer<typeof providerSettingsSchema>
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>
export type ImageGenerationRequest = z.infer<typeof imageRequestSchema>
export type ImageTaskInput = z.infer<typeof imageTaskInputSchema>
export type VisualCommand = z.infer<typeof visualCommandSchema>
export type VisualReference = z.infer<typeof visualReferenceSchema>
export const visualSnapshotSchema = z.strictObject({
  versions: z.array(assetVersionSchema),
  settings: providerSettingsSchema,
  templates: z.array(workflowTemplateSchema),
})
export type VisualSnapshot = z.infer<typeof visualSnapshotSchema>
export type VisualResult =
  VisualSnapshot | ImagePromptPackage | AssetVersion | string | string[] | null
