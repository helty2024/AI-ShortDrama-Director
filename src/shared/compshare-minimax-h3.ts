import { z } from 'zod'

export const compshareProfileSchema = z.strictObject({
  adapter: z.literal('compshare-minimax-h3'),
  toolId: z.literal('compshare.minimax-h3'),
  modelId: z.literal('MiniMax-H3'),
  credentialRef: z.uuid().nullable(),
})
export type CompShareProfile = z.infer<typeof compshareProfileSchema>

export const compshareProbeSchema = z.strictObject({
  toolId: z.literal('compshare.minimax-h3'),
  checkedAt: z.iso.datetime(),
  authenticated: z.boolean(),
  points: z.strictObject({
    total: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  }).nullable(),
  generationEnabled: z.literal(false),
  realGenerationValidated: z.literal(false),
  errorCode: z.string().nullable(),
})

export const compshareConfigurationSchema = z.strictObject({
  configured: z.boolean(),
  importAllowed: z.boolean().optional(),
  generationEnabled: z.literal(false),
})

export const compshareCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('configuration') }),
  z.strictObject({ op: z.literal('importCredential') }),
  z.strictObject({ op: z.literal('probe') }),
])
export type CompShareCommand = z.infer<typeof compshareCommandSchema>
