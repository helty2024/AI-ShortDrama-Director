import { z } from 'zod'

export const aiServiceKindSchema = z.enum(['text', 'packy-image', 'compshare-video'])
export const textOutputModeSchema = z.enum(['json-schema', 'json-object'])
export const aiServiceInputSchema = z.strictObject({
  id: z.uuid().nullable(),
  kind: aiServiceKindSchema,
  name: z.string().trim().min(1).max(120),
  baseUrl: z.url().max(1000),
  model: z.string().trim().min(1).max(200),
  textOutputMode: textOutputModeSchema.optional(),
})
export const aiServiceStateSchema = z.strictObject({
  id: z.uuid(), kind: aiServiceKindSchema, name: z.string(), baseUrl: z.string(), model: z.string(),
  textOutputMode: textOutputModeSchema.optional(),
  enabled: z.boolean(), isDefault: z.boolean(), credentialSaved: z.boolean(),
  connection: z.enum(['unchecked', 'accepted', 'rejected', 'unavailable']),
  generation: z.enum(['unverified', 'trial', 'validated', 'blocked']),
  reason: z.string(), checkedAt: z.iso.datetime().nullable(),
})
export const aiServicesSnapshotSchema = z.strictObject({
  mode: z.enum(['production', 'test']), services: z.array(aiServiceStateSchema),
  defaultImageTool: z.string().nullable(),
  localEnabled: z.boolean(), localArchived: z.boolean(),
})
export const aiServicesCommands = [
  z.strictObject({ op: z.literal('ai.list') }),
  z.strictObject({ op: z.literal('ai.save'), service: aiServiceInputSchema, apiKey: z.string().max(8192).optional() }),
  z.strictObject({ op: z.literal('ai.importKey'), id: z.uuid() }),
  z.strictObject({ op: z.literal('ai.enable'), id: z.uuid(), enabled: z.boolean() }),
  z.strictObject({ op: z.literal('ai.delete'), id: z.uuid(), confirmed: z.literal(true) }),
  z.strictObject({ op: z.literal('ai.default'), id: z.uuid() }),
  z.strictObject({ op: z.literal('ai.defaultLocal') }),
  z.strictObject({ op: z.literal('ai.localEnable'), enabled: z.boolean() }),
  z.strictObject({ op: z.literal('ai.localDelete'), confirmed: z.literal(true) }),
  z.strictObject({ op: z.literal('ai.probe'), id: z.uuid() }),
  z.strictObject({ op: z.literal('ai.validateText'), id: z.uuid(), confirmed: z.literal(true) }),
  z.strictObject({ op: z.literal('ai.verifyVideoDownload'), id: z.uuid(), taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }),
  z.strictObject({ op: z.literal('ai.authorizeTrial'), id: z.uuid(), confirmed: z.literal(true), capability: z.enum(['image.generate', 'image.referenceGenerate', 'video.textToVideo', 'video.imageToVideo']), maxPoints: z.number().int().min(0).max(1000000) }),
  z.strictObject({ op: z.literal('ai.mode'), mode: z.enum(['production', 'test']), confirmed: z.literal(true) }),
] as const
export type AIServiceInput = z.infer<typeof aiServiceInputSchema>
export type AIServiceState = z.infer<typeof aiServiceStateSchema>
