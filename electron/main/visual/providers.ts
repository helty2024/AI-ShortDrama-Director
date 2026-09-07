import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { z } from 'zod'
import type { ImageGenerationRequest } from '../../../src/shared/visual.js'
import { substituteWorkflow, templateVariables } from './workflows.js'
import { AIError, normalizeAIError } from '../intelligence/provider.js'
export interface ImageOutput {
  bytes: Uint8Array
  model: string
  metadata: Record<string, z.infer<ReturnType<typeof z.json>>>
}
export interface ImageRun {
  signal: AbortSignal
  providerTaskId: string | null
  update: (id: string, progress: number) => void
  references: Uint8Array[]
}
export interface ImageGenerationProvider {
  id: string
  displayName: string
  capabilities: { references: boolean; resume: boolean }
  healthCheck(): Promise<string>
  generate(
    request: ImageGenerationRequest,
    run: ImageRun,
  ): Promise<ImageOutput[]>
  cancel(providerTaskId: string): Promise<void>
  normalizeError(error: unknown): AIError
}
export class MockImageProvider implements ImageGenerationProvider {
  id = 'mock-image'
  displayName = 'Mock Image'
  capabilities = { references: true, resume: false }
  async healthCheck() {
    return 'Mock 图像服务可用，无网络调用'
  }
  normalizeError = normalizeAIError
  async cancel() {
    /* local generation observes AbortSignal */
  }
  async generate(request: ImageGenerationRequest, run: ImageRun) {
    const hash = createHash('sha256')
      .update(request.prompt.positivePrompt + request.seed)
      .digest()
    const id = run.providerTaskId ?? randomUUID()
    run.update(id, 0.1)
    await delay(80, undefined, { signal: run.signal })
    run.update(id, 0.6)
    const bytes = await sharp({
      create: {
        width: request.width,
        height: request.height,
        channels: 3,
        background: { r: hash[0]!, g: hash[1]!, b: hash[2]! },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${request.width}" height="${request.height}"><rect x="24" y="24" width="${request.width - 48}" height="${request.height - 48}" rx="20" fill="none" stroke="white" stroke-width="4"/><circle cx="${request.width / 2}" cy="${request.height / 2}" r="${Math.min(request.width, request.height) / 5}" fill="white" opacity="0.4"/></svg>`,
          ),
        },
      ])
      .png()
      .toBuffer()
    if (run.signal.aborted) throw new AIError('CANCELLED', '任务已取消')
    return [
      {
        bytes,
        model: 'deterministic-mock-v1',
        metadata: { mock: true, seed: request.seed },
      },
    ]
  }
}
export function validateComfyUrl(value: string) {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    )
  )
    throw new AIError(
      'PROVIDER',
      'ComfyUI 仅允许 HTTPS 或本机 HTTP，URL 不得含认证信息',
    )
  return url.href.replace(/\/$/, '')
}
const optionsSchema = z.object({
  baseUrl: z.string(),
  workflow: z.unknown(),
  checkpoint: z.string(),
  steps: z.number(),
  cfg: z.number(),
})
const imageDescriptor = z.object({
  filename: z.string().min(1).max(300),
  subfolder: z.string().max(1000).default(''),
  type: z.enum(['output', 'temp', 'input']).default('output'),
})
export class ComfyUIImageProvider implements ImageGenerationProvider {
  id = 'comfyui'
  displayName = 'ComfyUI'
  capabilities = { references: true, resume: true }
  readonly baseUrl: string
  private fetcher: typeof fetch
  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = validateComfyUrl(baseUrl)
    this.fetcher = fetcher
  }
  normalizeError = normalizeAIError
  private async http(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ) {
    let response: Response
    try {
      response = await this.fetcher(this.baseUrl + path, {
        ...init,
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      })
    } catch {
      throw new AIError(
        'NETWORK',
        '无法连接 ComfyUI 或请求超时；提交状态可能未知，请先检查服务队列',
      )
    }
    if (!response.ok)
      throw new AIError(
        response.status >= 500 ? 'NETWORK' : 'PROVIDER',
        `ComfyUI HTTP ${response.status}，请检查模型、工作流和节点`,
      )
    return response
  }
  async healthCheck() {
    await this.http('/system_stats')
    const data: unknown = await (
      await this.http('/object_info/CheckpointLoaderSimple')
    ).json()
    const info = z
      .object({
        CheckpointLoaderSimple: z.object({
          input: z.object({
            required: z.object({ ckpt_name: z.array(z.unknown()) }),
          }),
        }),
      })
      .safeParse(data)
    const models = info.success
      ? info.data.CheckpointLoaderSimple.input.required.ckpt_name[0]
      : []
    return (
      '连接成功；可用 Checkpoint：' +
      (Array.isArray(models)
        ? models.filter((v) => typeof v === 'string').join('、')
        : '请在 ComfyUI 查看')
    )
  }
  async cancel(id: string) {
    // Never globally interrupt another user's active workflow. Delete only our queued prompt.
    await this.http('/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [id] }),
    })
    // Local cancellation is authoritative; upstream running jobs may finish but results are discarded.
  }
  async generate(
    request: ImageGenerationRequest,
    run: ImageRun,
  ): Promise<ImageOutput[]> {
    const options = optionsSchema.parse(request.providerOptions)
    let promptId = run.providerTaskId
    const clientId = randomUUID()
    let socket: WebSocket | undefined
    try {
      const wsUrl = new URL(this.baseUrl + '/ws')
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      wsUrl.searchParams.set('clientId', clientId)
      socket = new WebSocket(wsUrl)
      socket.addEventListener('error', () => undefined)
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string' || event.data.length > 100000) return
        try {
          const v = z
            .object({
              type: z.string(),
              data: z.object({
                prompt_id: z.string().optional(),
                value: z.number().optional(),
                max: z.number().optional(),
              }),
            })
            .parse(JSON.parse(event.data))
          if (
            v.type === 'progress' &&
            v.data.prompt_id === promptId &&
            v.data.max &&
            v.data.value !== undefined
          )
            run.update(promptId!, Math.min(0.95, v.data.value / v.data.max))
        } catch {
          /* unsupported / binary previews are ignored */
        }
      })
    } catch {
      /* history polling remains the completion authority */
    }
    try {
      if (!promptId) {
        const variables: Record<string, string | number> = {
          positive_prompt: request.prompt.positivePrompt,
          negative_prompt: request.prompt.negativePrompt,
          seed: request.seed,
          width: request.width,
          height: request.height,
          checkpoint: options.checkpoint,
          steps: options.steps,
          cfg: options.cfg,
        }
        const slots = templateVariables(options.workflow)
        for (let i = 0; i < run.references.length; i++) {
          const slot = i === 0 ? 'reference_image' : `reference_image_${i + 1}`
          if (!slots.includes(slot)) continue
          const form = new FormData()
          form.set(
            'image',
            new Blob([new Uint8Array(run.references[i]!)], {
              type: 'image/png',
            }),
            `director-${randomUUID()}.png`,
          )
          form.set('overwrite', 'false')
          const uploaded = z
            .object({ name: z.string(), subfolder: z.string().optional() })
            .parse(
              await (
                await this.http(
                  '/upload/image',
                  { method: 'POST', body: form },
                  run.signal,
                )
              ).json(),
            )
          variables[slot] = [uploaded.subfolder, uploaded.name]
            .filter(Boolean)
            .join('/')
        }
        const workflow = substituteWorkflow(options.workflow, variables)
        const response = await this.http(
          '/prompt',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow, client_id: clientId }),
          },
          run.signal,
        )
        const body = z
          .object({ prompt_id: z.string().min(1).max(200) })
          .parse(await response.json())
        promptId = body.prompt_id
        run.update(promptId, 0.02)
      }
      const deadline = Date.now() + 30 * 60 * 1000
      while (Date.now() < deadline) {
        if (run.signal.aborted) throw new AIError('CANCELLED', '任务已取消')
        const history = z
          .record(z.string(), z.unknown())
          .parse(
            await (
              await this.http(
                '/history/' + encodeURIComponent(promptId),
                {},
                run.signal,
              )
            ).json(),
          )
        if (history[promptId]) {
          const entry = z
            .object({
              status: z
                .object({
                  status_str: z.string(),
                  completed: z.boolean().optional(),
                })
                .optional(),
              outputs: z
                .record(
                  z.string(),
                  z
                    .object({ images: z.array(imageDescriptor).optional() })
                    .passthrough(),
                )
                .default({}),
            })
            .parse(history[promptId])
          if (entry.status?.status_str === 'error')
            throw new AIError(
              'PROVIDER',
              'ComfyUI 工作流执行失败，请查看服务端节点错误',
            )
          const images = Object.values(entry.outputs).flatMap(
            (v) => v.images ?? [],
          )
          if (images.length) {
            if (images.length > 8)
              throw new AIError('INVALID_OUTPUT', '单任务最多回收 8 张图片')
            const outputs: ImageOutput[] = []
            for (const image of images) {
              if (
                /[\\/]/.test(image.filename) ||
                image.filename.includes('..') ||
                image.subfolder.split(/[\\/]/).includes('..') ||
                image.subfolder.startsWith('/') ||
                image.subfolder.includes(':')
              )
                throw new AIError('INVALID_OUTPUT', 'ComfyUI 输出路径无效')
              const query = new URLSearchParams(image)
              const response = await this.http(
                '/view?' + query.toString(),
                {},
                run.signal,
              )
              const reader = response.body?.getReader()
              if (!reader) throw new AIError('INVALID_OUTPUT', '图片响应为空')
              const chunks: Uint8Array[] = []
              let size = 0
              try {
                for (;;) {
                  const chunk = await reader.read()
                  if (chunk.done) break
                  size += chunk.value.length
                  if (size > 30 * 1024 * 1024)
                    throw new AIError('INVALID_OUTPUT', '输出图片超过 30 MB')
                  chunks.push(chunk.value)
                }
              } finally {
                await reader.cancel()
              }
              outputs.push({
                bytes: Buffer.concat(chunks),
                model: options.checkpoint || 'custom-workflow',
                metadata: {
                  providerTaskId: promptId,
                  seed: request.seed,
                  workflow: options.workflow as z.infer<
                    ReturnType<typeof z.json>
                  >,
                  referenceSlots: templateVariables(options.workflow).filter(
                    (s) => s.startsWith('reference_image'),
                  ),
                },
              })
            }
            return outputs
          }
          if (entry.status?.completed)
            throw new AIError(
              'INVALID_OUTPUT',
              '工作流完成但无图片输出，请使用 SaveImage 节点',
            )
        }
        await delay(500, undefined, { signal: run.signal })
      }
      throw new AIError(
        'TIMEOUT',
        'ComfyUI 等待超过 30 分钟，可按原 prompt id 恢复查询',
      )
    } finally {
      socket?.close()
    }
  }
}
