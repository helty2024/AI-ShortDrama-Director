import { videoTaskInputSchema } from './video.js'
import { imageTaskInputSchema, imageTaskFields } from './visual.js'
import { z } from 'zod'

const id = z.uuid()
const text = z.string().max(100000)
const short = z.string().max(2000)
const title = z.string().trim().min(1).max(120)
const meta = {
  id,
  projectId: id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
}
export const dialogueSchema = z.strictObject({
  characterId: id.nullable(),
  characterName: z.string().max(120),
  parenthetical: short,
  text,
})
export const sceneContentSchema = z.strictObject({
  sceneNumber: z.string().max(40),
  heading: z.string().max(300),
  location: short,
  interiorExterior: z.enum(['INT', 'EXT', 'INT/EXT', 'UNKNOWN']),
  timeOfDay: z.string().max(80),
  characters: z.array(z.string().min(1).max(120)).max(200),
  action: text,
  dialogue: z.array(dialogueSchema).max(2000),
  narration: text,
  notes: text,
})
export const emptyScene = sceneContentSchema.parse({
  sceneNumber: '',
  heading: '',
  location: '',
  interiorExterior: 'UNKNOWN',
  timeOfDay: '',
  characters: [],
  action: '',
  dialogue: [],
  narration: '',
  notes: '',
})
export const characterBibleSchema = z.strictObject({
  aliases: z.array(z.string().max(120)).max(100),
  age: short,
  gender: short,
  height: short,
  build: short,
  facialFeatures: short,
  hairstyle: short,
  skinTone: short,
  personality: short,
  costume: short,
  accessories: short,
  makeup: short,
  behavioralHabits: short,
  expressionHabits: short,
  voiceDescription: short,
  continuityNotes: text,
  visualPrompt: text,
  negativePrompt: text,
})
export const emptyCharacterBible = characterBibleSchema.parse({
  aliases: [],
  age: '',
  gender: '',
  height: '',
  build: '',
  facialFeatures: '',
  hairstyle: '',
  skinTone: '',
  personality: '',
  costume: '',
  accessories: '',
  makeup: '',
  behavioralHabits: '',
  expressionHabits: '',
  voiceDescription: '',
  continuityNotes: '',
  visualPrompt: '',
  negativePrompt: '',
})
export const locationBibleSchema = z.strictObject({
  type: short,
  interiorExterior: short,
  geography: short,
  architecture: short,
  colors: short,
  lighting: short,
  timeState: short,
  weather: short,
  fixedAreas: short,
  continuityNotes: text,
  visualPrompt: text,
})
export const emptyLocationBible = locationBibleSchema.parse({
  type: '',
  interiorExterior: '',
  geography: '',
  architecture: '',
  colors: '',
  lighting: '',
  timeState: '',
  weather: '',
  fixedAreas: '',
  continuityNotes: '',
  visualPrompt: '',
})
export const propBibleSchema = z.strictObject({
  type: short,
  appearance: short,
  material: short,
  size: short,
  condition: short,
  usedByCharacterIds: z.array(id).max(200),
  sceneIds: z.array(id).max(10000),
  continuityNotes: text,
  visualPrompt: text,
})
export const emptyPropBible = propBibleSchema.parse({
  type: '',
  appearance: '',
  material: '',
  size: '',
  condition: '',
  usedByCharacterIds: [],
  sceneIds: [],
  continuityNotes: '',
  visualPrompt: '',
})
export const breakdownCategorySchema = z.enum([
  'character',
  'location',
  'prop',
  'costume',
  'makeup',
  'vehicle',
  'vfx',
  'sfx',
  'environment',
  'timeOfDay',
  'mood',
  'keyAction',
  'continuityNote',
])
// Attributes remain named text pairs: providers cannot supply IDs or arbitrary entity fields.
export const breakdownItemSchema = z.strictObject({
  category: breakdownCategorySchema,
  name: title,
  description: text,
  confidence: z.number().min(0).max(1),
  reason: short,
  attributes: z
    .array(z.strictObject({ field: z.string().max(80), value: short }))
    .max(40),
})
export const breakdownOutputSchema = z.strictObject({
  elements: z.array(breakdownItemSchema).max(200),
})
export const shotPlanSchema = z.strictObject({
  shotNumber: z.number().int().positive(),
  shotType: short,
  framing: short,
  cameraAngle: short,
  cameraMovement: short,
  focalLengthSuggestion: short,
  subject: short,
  action: text,
  emotion: short,
  durationSuggestion: z.number().positive().max(600),
  characterRefs: z.array(id).max(200),
  locationRef: id.nullable(),
  propRefs: z.array(id).max(200),
  continuityNotes: text,
})
export const shotOutputSchema = z.strictObject({
  shots: z.array(shotPlanSchema).min(1).max(100),
})
export const draftPayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('breakdown'), item: breakdownItemSchema }),
  z.strictObject({ type: z.literal('shot'), item: shotPlanSchema }),
])
export const intelligenceDraftSchema = z.strictObject({
  ...meta,
  sceneId: id,
  sourceRevision: z.number().int().positive(),
  taskId: id,
  provider: short,
  promptVersion: short,
  payload: draftPayloadSchema,
  status: z.enum(['pending', 'confirmed', 'ignored']),
  targetId: id.nullable(),
})
export const productionElementSchema = z.strictObject({
  ...meta,
  category: breakdownCategorySchema,
  name: title,
  description: text,
  sceneIds: z.array(id).max(10000),
  draftIds: z.array(id).max(10000),
  notes: text,
})
export const parsedScriptSchema = z.strictObject({
  episodes: z
    .array(
      z.strictObject({
        name: title,
        scenes: z.array(sceneContentSchema).min(1).max(1000),
      }),
    )
    .min(1)
    .max(200),
  warnings: z.array(short).max(1000),
})
export const importPreviewSchema = z.strictObject({
  ...meta,
  name: title,
  rawText: z.string().min(1).max(100000),
  parsed: parsedScriptSchema,
  confirmedScriptId: id.nullable(),
})
export const taskInputSchema = z.discriminatedUnion('type', [
  imageTaskInputSchema,
  videoTaskInputSchema,
  z.strictObject({
    type: z.literal('parse'),
    name: title,
    rawText: z
      .string()
      .min(1)
      .max(100000)
      .refine((value) => value.trim().length > 0),
  }),
  z.strictObject({
    type: z.enum(['breakdown', 'characterBible', 'shotPlanning']),
    targetId: id,
  }),
])
export const aiTaskSchema = z.strictObject({
  ...imageTaskFields,
  ...meta,
  input: taskInputSchema,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  attempt: z.number().int().positive(),
  error: z.strictObject({ code: short, message: short }).nullable(),
  resultIds: z.array(id),
  sourceRevisions: z.record(z.string(), z.number().int().positive()),
})
export const intelligenceSnapshotSchema = z.strictObject({
  tasks: z.array(aiTaskSchema),
  drafts: z.array(intelligenceDraftSchema),
  imports: z.array(importPreviewSchema),
  production: z.array(productionElementSchema),
  provider: short,
})
const scoped = { projectId: id }
const versioned = {
  ...scoped,
  id,
  expectedRevision: z.number().int().positive(),
}
export const intelligenceCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...scoped, operation: z.literal('snapshot') }),
  z.strictObject({
    ...versioned,
    operation: z.literal('scene.save'),
    content: sceneContentSchema,
  }),
  z.strictObject({
    ...versioned,
    operation: z.literal('episode.rename'),
    name: title,
  }),
  z.strictObject({ ...versioned, operation: z.literal('tree.delete') }),
  z.strictObject({
    ...versioned,
    operation: z.literal('scenes.reorder'),
    sceneIds: z.array(id).max(1000),
  }),
  z.strictObject({
    ...versioned,
    operation: z.literal('bible.save'),
    name: title,
    description: text,
    assetIds: z.array(id).max(1000),
    bible: z.union([
      characterBibleSchema,
      locationBibleSchema,
      propBibleSchema,
    ]),
  }),
  z.strictObject({
    ...scoped,
    operation: z.literal('task.start'),
    input: taskInputSchema,
  }),
  z.strictObject({
    ...scoped,
    operation: z.enum(['task.cancel', 'task.retry']),
    id,
  }),
  z.strictObject({
    ...versioned,
    operation: z.literal('import.confirm'),
    parsed: parsedScriptSchema,
  }),
  z.strictObject({
    ...versioned,
    operation: z.literal('draft.edit'),
    payload: draftPayloadSchema,
  }),
  z.strictObject({ ...versioned, operation: z.literal('draft.ignore') }),
  z.strictObject({
    ...versioned,
    operation: z.literal('draft.confirm'),
    targetId: id.nullable(),
    targetRevision: z.number().int().positive().nullable(),
  }),
])
export type SceneContent = z.infer<typeof sceneContentSchema>
export type CharacterBible = z.infer<typeof characterBibleSchema>
export type BreakdownItem = z.infer<typeof breakdownItemSchema>
export type ShotPlan = z.infer<typeof shotPlanSchema>
export type DraftPayload = z.infer<typeof draftPayloadSchema>
export type IntelligenceDraft = z.infer<typeof intelligenceDraftSchema>
export type ProductionElement = z.infer<typeof productionElementSchema>
export type ParsedScript = z.infer<typeof parsedScriptSchema>
export type ImportPreview = z.infer<typeof importPreviewSchema>
export type AITask = z.infer<typeof aiTaskSchema>
export type TaskInput = z.infer<typeof taskInputSchema>
export type IntelligenceSnapshot = z.infer<typeof intelligenceSnapshotSchema>
export type IntelligenceCommand = z.infer<typeof intelligenceCommandSchema>
