import {
  workflowSchema,
  workflowTemplateSchema,
} from '../../../src/shared/visual.js'
import type { WorkflowTemplate } from '../../../src/shared/visual.js'
import { DomainError } from '../database.js'
const standard = {
  '1': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: '{{checkpoint}}' },
  },
  '2': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{{positive_prompt}}', clip: ['1', 1] },
  },
  '3': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{{negative_prompt}}', clip: ['1', 1] },
  },
  '4': {
    class_type: 'EmptyLatentImage',
    inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 },
  },
  '5': {
    class_type: 'KSampler',
    inputs: {
      seed: '{{seed}}',
      steps: '{{steps}}',
      cfg: '{{cfg}}',
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['1', 0],
      positive: ['2', 0],
      negative: ['3', 0],
      latent_image: ['4', 0],
    },
  },
  '6': {
    class_type: 'VAEDecode',
    inputs: { samples: ['5', 0], vae: ['1', 2] },
  },
  '7': {
    class_type: 'SaveImage',
    inputs: { images: ['6', 0], filename_prefix: 'Director' },
  },
}
export const builtinTemplates: WorkflowTemplate[] = [
  'character-base',
  'location-base',
  'prop-base',
  'shot-keyframe',
].map((id) =>
  workflowTemplateSchema.parse({
    id,
    name: id + ' · 标准文生图',
    workflow: standard,
  }),
)
export function templateVariables(value: unknown): string[] {
  return [
    ...new Set(
      [...JSON.stringify(value).matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map(
        (m) => m[1]!,
      ),
    ),
  ]
}
export function substituteWorkflow(
  raw: unknown,
  variables: Record<string, string | number>,
) {
  const schema = workflowSchema.parse(raw)
  if (JSON.stringify(schema).length > 1000000)
    throw new DomainError('INVALID_INPUT', '工作流过大')
  const walk = (value: unknown, depth = 0): unknown => {
    if (depth > 40) throw new DomainError('INVALID_INPUT', '工作流嵌套过深')
    if (typeof value === 'string') {
      const exact = /^\{\{([a-zA-Z0-9_]+)\}\}$/.exec(value)
      const resolve = (key: string) => {
        if (!Object.hasOwn(variables, key))
          throw new DomainError('INVALID_INPUT', `缺少模板变量：${key}`)
        return variables[key]!
      }
      return exact
        ? resolve(exact[1]!)
        : value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) =>
            String(resolve(key)),
          )
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1))
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, walk(v, depth + 1)]),
      )
    return value
  }
  return workflowSchema.parse(walk(schema))
}
