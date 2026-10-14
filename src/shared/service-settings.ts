import { z } from 'zod'
import { providerSettingsSchema, workflowTemplateSchema } from './visual.js'

export const serviceSettingsCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('comfy.configuration') }),
  z.strictObject({ op: z.literal('comfy.save'), settings: providerSettingsSchema }),
])
export const comfyConfigurationSchema = z.strictObject({
  settings: providerSettingsSchema,
  templates: z.array(workflowTemplateSchema),
})
export type ServiceSettingsCommand = z.infer<typeof serviceSettingsCommandSchema>
