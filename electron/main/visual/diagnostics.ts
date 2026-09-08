import { z } from 'zod'
import type {
  ProviderSettings,
  WorkflowTemplate,
} from '../../../src/shared/visual.js'
import type { ProviderDiagnostics } from '../../../src/shared/video.js'
import { validateComfyUrl } from './providers.js'
import { templateVariables, substituteWorkflow } from './workflows.js'
export async function diagnoseComfy(
  settings: ProviderSettings,
  template: WorkflowTemplate,
  fetcher: typeof fetch = fetch,
): Promise<ProviderDiagnostics> {
  const result: ProviderDiagnostics = {
    ready: false,
    reachable: false,
    missingNodes: [],
    missingInputs: [],
    checkpoints: [],
    variables: templateVariables(template.workflow),
    errors: [],
    warnings: [],
    checkedAt: new Date().toISOString(),
  }
  if (settings.provider === 'mock-image')
    return {
      ...result,
      ready: true,
      reachable: true,
      warnings: ['Mock Image，无需 ComfyUI'],
    }
  try {
    const base = validateComfyUrl(settings.baseUrl)
    const get = async (path: string) => {
      const r = await fetcher(base + path, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) throw Error('HTTP ' + r.status)
      return r.json() as Promise<unknown>
    }
    await get('/system_stats')
    result.reachable = true
    const info = z
      .record(
        z.string(),
        z
          .object({
            output_node: z.boolean().optional(),
            input: z
              .object({
                required: z.record(z.string(), z.unknown()).optional(),
              })
              .optional(),
          })
          .passthrough(),
      )
      .parse(await get('/object_info'))
    for (const [id, node] of Object.entries(template.workflow)) {
      const definition = info[node.class_type]
      if (!definition) result.missingNodes.push(node.class_type)
      else
        for (const key of Object.keys(definition.input?.required ?? {}))
          if (!Object.hasOwn(node.inputs, key))
            result.missingInputs.push(`${id}.${key}`)
    }
    const names = info.CheckpointLoaderSimple?.input?.required?.ckpt_name
    if (Array.isArray(names) && Array.isArray(names[0]))
      result.checkpoints = names[0].filter(
        (n): n is string => typeof n === 'string',
      )
    if (
      result.variables.includes('checkpoint') &&
      !result.checkpoints.includes(settings.checkpoint)
    )
      result.errors.push(
        'Checkpoint 未配置或本机不存在：' + (settings.checkpoint || '空'),
      )
    if (
      !Object.values(template.workflow).some(
        (n) => info[n.class_type]?.output_node || n.class_type === 'SaveImage',
      )
    )
      result.errors.push('工作流缺少可确认的输出节点')
    const vars: Record<string, string | number> = {
      positive_prompt: 'test',
      negative_prompt: 'test',
      checkpoint: settings.checkpoint,
      seed: settings.seed,
      width: settings.width,
      height: settings.height,
      steps: settings.steps,
      cfg: settings.cfg,
    }
    for (const slot of result.variables.filter((v) =>
      /^reference_image(?:_\d+)?$/.test(v),
    ))
      vars[slot] = 'approved-reference.png'
    try {
      substituteWorkflow(template.workflow, vars)
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : '模板无效')
    }
    if (result.missingNodes.length)
      result.errors.push(
        '缺少节点：' + [...new Set(result.missingNodes)].join('、'),
      )
    if (result.missingInputs.length)
      result.errors.push('缺少输入：' + result.missingInputs.join('、'))
    if (result.variables.some((v) => v.startsWith('reference_image')))
      result.warnings.push('生成时必须具有对应数量的已批准参考图')
    result.ready = !result.errors.length
  } catch {
    result.errors.push(
      'ComfyUI 不可达或节点信息格式无效，请确认 Base URL 和服务进程',
    )
  }
  return result
}
