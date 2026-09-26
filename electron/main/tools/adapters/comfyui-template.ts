import { comfyToolProfileSchema } from '../../../../src/shared/comfyui.js'
import { builtinTemplates, substituteWorkflow } from '../../visual/workflows.js'
import { validateLocalComfyUrl } from './comfyui-runtime.js'

/** Trusted built-in template only. Resolve sampler constants before any preflight. */
export function builtinComfyProfile(options: {
  checkpoint: string
  baseUrl?: string
  templateId?: string
  steps?: number
  cfg?: number
}) {
  const template = builtinTemplates.find(
    (candidate) => candidate.id === (options.templateId ?? 'shot-keyframe'),
  )
  if (!template) throw new Error('Untrusted ComfyUI template')
  const steps = options.steps ?? 20, cfg = options.cfg ?? 7
  if (!Number.isInteger(steps) || steps < 1 || steps > 150 || !Number.isFinite(cfg) || cfg < 0 || cfg > 30)
    throw new Error('Invalid ComfyUI sampler settings')
  return comfyToolProfileSchema.parse({
    toolId: 'comfyui.local', displayName: 'ComfyUI（本机外部服务）',
    baseUrl: validateLocalComfyUrl(options.baseUrl ?? 'http://127.0.0.1:8188'),
    modelId: options.checkpoint, currency: 'USD',
    template: {
      templateId: template.id, version: '1.0.1', capability: 'image.generate',
      workflow: substituteWorkflow(template.workflow, {
        checkpoint: options.checkpoint, positive_prompt: '', negative_prompt: '',
        width: 1024, height: 1024, seed: 42, steps, cfg,
      }),
      requiredNodes: ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'],
      requiredModels: [options.checkpoint],
      inputBindings: {
        prompt: { nodeId: '2', input: 'text' },
        negativePrompt: { nodeId: '3', input: 'text' },
        width: { nodeId: '4', input: 'width' },
        height: { nodeId: '4', input: 'height' },
        seed: { nodeId: '5', input: 'seed' },
      },
      outputNode: '7',
      supportedResolutions: [{ width: 512, height: 512 }, { width: 512, height: 768 }, { width: 768, height: 512 }, { width: 1024, height: 1024 }],
      supportedAspectRatios: ['1:1', '3:4', '4:3'], maxReferences: 0,
    },
  })
}
