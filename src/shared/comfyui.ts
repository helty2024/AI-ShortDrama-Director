import { z } from 'zod'
import { aspectRatioSchema, resolutionSchema } from './capabilities/common.js'
import { toolIdSchema } from './tools.js'

const bindingSchema = z.strictObject({
  nodeId: z.string().min(1).max(100),
  input: z.string().min(1).max(100),
})

export const comfyWorkflowTemplateSchema = z.strictObject({
  templateId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  capability: z.enum(['image.generate', 'image.referenceGenerate']),
  workflow: z.record(z.string(), z.unknown()),
  requiredNodes: z.array(z.string().min(1).max(200)).min(1).max(100),
  requiredModels: z.array(z.string().min(1).max(300)).max(20),
  inputBindings: z.strictObject({
    prompt: bindingSchema,
    negativePrompt: bindingSchema,
    width: bindingSchema,
    height: bindingSchema,
    seed: bindingSchema,
    referenceImage: bindingSchema.optional(),
    referenceWeight: bindingSchema.optional(),
  }),
  outputNode: z.string().min(1).max(100),
  supportedResolutions: z.array(resolutionSchema).min(1).max(64),
  supportedAspectRatios: z.array(aspectRatioSchema).min(1).max(6),
  maxReferences: z.number().int().min(0).max(8),
})

export const comfyToolProfileSchema = z.strictObject({
  toolId: toolIdSchema,
  displayName: z.string().min(1).max(120),
  baseUrl: z.string().max(2000),
  modelId: z.string().min(1).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/),
  template: comfyWorkflowTemplateSchema,
})

export type ComfyWorkflowTemplate = z.infer<typeof comfyWorkflowTemplateSchema>
export type ComfyToolProfile = z.infer<typeof comfyToolProfileSchema>
