import { visualReferenceSchema } from './visual.js'
import { z } from 'zod'
import {
  sceneContentSchema,
  emptyScene,
  characterBibleSchema,
  emptyCharacterBible,
  locationBibleSchema,
  emptyLocationBible,
  propBibleSchema,
  emptyPropBible,
  shotPlanSchema,
} from './intelligence.js'

export const idSchema = z.uuid()
const timestamp = z.iso.datetime()
const name = z.string().trim().min(1, '请输入名称').max(120)
const text = z.string().max(100000)
const base = {
  id: idSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: z.number().int().positive(),
}
export const projectInputSchema = z.strictObject({
  name,
  description: z.string().max(4000),
  genre: z.string().trim().min(1).max(80),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3']),
  language: z.string().trim().min(1).max(40),
})
export const projectSchema = projectInputSchema.extend({
  ...base,
  lastOpenedAt: timestamp.nullable(),
})
export const projectUpdateSchema = z.strictObject({
  id: idSchema,
  expectedRevision: z.number().int().positive(),
  changes: projectInputSchema
    .partial()
    .refine((v) => Object.keys(v).length > 0),
})
const child = { ...base, projectId: idSchema, name, description: text }
const source = z.strictObject({
  providerId: z.string().min(1).max(120),
  modelId: z.string().min(1).max(120),
  parameters: z.record(z.string(), z.json()),
  prompt: text,
})
export const scriptSchema = z.strictObject({
  ...child,
  kind: z.literal('script'),
  content: text,
  previousVersionId: idSchema.nullable(),
})
export const episodeSchema = z.strictObject({
  ...child,
  kind: z.literal('episode'),
  scriptId: idSchema,
  order: z.number().int().nonnegative(),
})
export const sceneSchema = z.strictObject({
  ...child,
  kind: z.literal('scene'),
  content: sceneContentSchema.default(emptyScene),
  episodeId: idSchema,
  locationId: idSchema.nullable(),
  order: z.number().int().nonnegative(),
})
export const characterSchema = z.strictObject({
  ...child,
  kind: z.literal('character'),
  visualReferences: z.array(visualReferenceSchema).default([]),
  bible: characterBibleSchema.default(emptyCharacterBible),
  appearance: text,
  assetIds: z.array(idSchema).max(1000),
})
export const locationSchema = z.strictObject({
  ...child,
  kind: z.literal('location'),
  visualReferences: z.array(visualReferenceSchema).default([]),
  bible: locationBibleSchema.default(emptyLocationBible),
  assetIds: z.array(idSchema).max(1000),
})
export const propSchema = z.strictObject({
  ...child,
  kind: z.literal('prop'),
  visualReferences: z.array(visualReferenceSchema).default([]),
  bible: propBibleSchema.default(emptyPropBible),
  assetIds: z.array(idSchema).max(1000),
})
export const storyboardSchema = z.strictObject({
  ...child,
  kind: z.literal('storyboard'),
  episodeId: idSchema,
  previousVersionId: idSchema.nullable(),
})
export const shotSchema = z.strictObject({
  ...child,
  kind: z.literal('shot'),
  approvedKeyframeAssetId: idSchema.nullable().default(null),
  approvedKeyframeVersionId: idSchema.nullable().default(null),
  plan: shotPlanSchema.nullable().default(null),
  storyboardId: idSchema,
  sceneId: idSchema,
  order: z.number().int().nonnegative(),
  durationSeconds: z.number().positive().max(600),
  characterIds: z.array(idSchema).max(1000),
  locationId: idSchema.nullable(),
  propIds: z.array(idSchema).max(1000),
  assetIds: z.array(idSchema).max(1000),
  imagePrompt: text,
  videoPrompt: text,
  previousVersionId: idSchema.nullable(),
})
export const assetSchema = z.strictObject({
  ...child,
  kind: z.literal('asset'),
  approvedVersionId: idSchema.nullable().default(null),
  mediaType: z.enum(['image', 'video', 'audio', 'document']),
  uri: z.string().max(2000).nullable(),
  status: z.enum(['placeholder', 'ready', 'failed']),
  source: source.nullable(),
  previousVersionId: idSchema.nullable(),
})
export const generationTaskSchema = z.strictObject({
  ...child,
  kind: z.literal('generationTask'),
  taskType: z.enum(['image', 'video', 'script']),
  status: z.enum([
    'draft',
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  shotId: idSchema.nullable(),
  source: source.nullable(),
  inputAssetIds: z.array(idSchema).max(1000),
  outputAssetIds: z.array(idSchema).max(1000),
  providerTaskId: z.string().max(200).nullable(),
  error: text.nullable(),
})
export const entitySchema = z.discriminatedUnion('kind', [
  scriptSchema,
  episodeSchema,
  sceneSchema,
  characterSchema,
  locationSchema,
  propSchema,
  storyboardSchema,
  shotSchema,
  assetSchema,
  generationTaskSchema,
])
export const entityKindSchema = z.enum([
  'script',
  'episode',
  'scene',
  'character',
  'location',
  'prop',
  'storyboard',
  'shot',
  'asset',
  'generationTask',
])
export const workspaceSchema = z.strictObject({
  project: projectSchema,
  entities: z.array(entitySchema),
})
export const draftInputSchema = z.strictObject({
  projectId: idSchema,
  kind: entityKindSchema,
  name,
  parentId: idSchema.optional(),
  sceneId: idSchema.optional(),
})
export type Project = z.infer<typeof projectSchema>
export type ProjectInput = z.infer<typeof projectInputSchema>
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>
export type Script = z.infer<typeof scriptSchema>
export type Episode = z.infer<typeof episodeSchema>
export type Scene = z.infer<typeof sceneSchema>
export type Character = z.infer<typeof characterSchema>
export type Location = z.infer<typeof locationSchema>
export type Prop = z.infer<typeof propSchema>
export type Storyboard = z.infer<typeof storyboardSchema>
export type Shot = z.infer<typeof shotSchema>
export type Asset = z.infer<typeof assetSchema>
export type GenerationTask = z.infer<typeof generationTaskSchema>
export type Entity = z.infer<typeof entitySchema>
export type EntityKind = Entity['kind']
export type Workspace = z.infer<typeof workspaceSchema>
export type DraftInput = z.infer<typeof draftInputSchema>
