import { z } from 'zod'
import { providerSettingsSchema, workflowTemplateSchema } from './visual.js'
import { aiServicesCommands } from './ai-services.js'

export const serviceSettingsCommandSchema = z.discriminatedUnion('op', [
  ...aiServicesCommands,
  z.strictObject({ op: z.literal('comfy.configuration') }),
  z.strictObject({ op: z.literal('comfy.save'), settings: providerSettingsSchema }),
])
export const comfyConfigurationSchema = z.strictObject({
  settings: providerSettingsSchema,
  templates: z.array(workflowTemplateSchema),
})
export type ServiceSettingsCommand = z.infer<typeof serviceSettingsCommandSchema>
