import { z } from 'zod'
import { normalizeToolError } from '../errors.js'

const outputSchema = z.strictObject({
  filename: z.string().min(1).max(300),
  subfolder: z.string().max(1000).default(''),
  type: z.enum(['output', 'temp', 'input']).default('output'),
})
const historyEntrySchema = z.object({
  status: z.object({ status_str: z.string(), completed: z.boolean().optional() }).optional(),
  outputs: z.record(z.string(), z.object({ images: z.array(outputSchema).optional() }).passthrough()).default({}),
}).passthrough()
export type ComfyHistoryEntry = z.infer<typeof historyEntrySchema>

export function validateLocalComfyUrl(raw: string): string {
  const url = new URL(raw)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash ||
    !['', '/'].includes(url.pathname)
  ) throw normalizeToolError({ code: 'validation' })
  return url.origin
}

export class ComfyUIRuntime {
  readonly baseUrl: string
  private readonly fetcher: typeof fetch
  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = validateLocalComfyUrl(baseUrl)
    this.fetcher = fetcher
  }
  private async request(path: string, init: RequestInit, signal: AbortSignal) {
    signal.throwIfAborted()
    let response: Response
    try {
      response = await this.fetcher(this.baseUrl + path, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      })
    } catch {
      if (signal.aborted) throw normalizeToolError({ code: 'cancelled' })
      throw normalizeToolError({ code: 'network' })
    }
    if (!response.ok)
      throw normalizeToolError({ code: response.status >= 500 ? 'provider' : 'validation' })
    return response
  }
  private async json(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const response = await this.request(path, init, signal)
    try { return await response.json() } catch { throw normalizeToolError({ code: 'malformed-response' }) }
  }
  async systemStats(signal: AbortSignal) { return this.json('/system_stats', {}, signal) }
  async objectInfo(signal: AbortSignal) {
    return z.record(z.string(), z.object({
      output_node: z.boolean().optional(),
      input: z.object({ required: z.record(z.string(), z.unknown()).optional() }).optional(),
    }).passthrough()).parse(await this.json('/object_info', {}, signal))
  }
  async queue(signal: AbortSignal) {
    const entry = z.tuple([z.number(), z.string()]).rest(z.unknown())
    return z.object({ queue_running: z.array(entry), queue_pending: z.array(entry) })
      .parse(await this.json('/queue', {}, signal))
  }
  async history(promptId: string, signal: AbortSignal): Promise<ComfyHistoryEntry | null> {
    const data = z.record(z.string(), z.unknown()).parse(
      await this.json('/history/' + encodeURIComponent(promptId), {}, signal),
    )
    return data[promptId] ? historyEntrySchema.parse(data[promptId]) : null
  }
  async submit(workflow: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const data = z.object({ prompt_id: z.string().min(1).max(256) }).parse(
      await this.json('/prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
      }, signal),
    )
    return data.prompt_id
  }
  async upload(bytes: Buffer, mime: string, signal: AbortSignal): Promise<string> {
    const form = new FormData()
    form.set('image', new Blob([new Uint8Array(bytes)], { type: mime }), `director-${crypto.randomUUID()}.png`)
    form.set('overwrite', 'false')
    const data = z.object({ name: z.string().min(1), subfolder: z.string().optional() }).parse(
      await this.json('/upload/image', { method: 'POST', body: form }, signal),
    )
    return [data.subfolder, data.name].filter(Boolean).join('/')
  }
  async view(output: z.infer<typeof outputSchema>, signal: AbortSignal) {
    if (/[\\/]/.test(output.filename) || output.filename.includes('..') || output.subfolder.split(/[\\/]/).includes('..') || output.subfolder.startsWith('/') || output.subfolder.includes(':'))
      throw normalizeToolError({ code: 'malformed-response' })
    const response = await this.request('/view?' + new URLSearchParams(output).toString(), {}, signal)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > 30 * 1024 * 1024)
      throw normalizeToolError({ code: 'malformed-response' })
    return { bytes, mime: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' }
  }
  async cancel(promptId: string, signal: AbortSignal) {
    await this.json('/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    }, signal)
  }
  outputs(entry: ComfyHistoryEntry) {
    return Object.values(entry.outputs).flatMap((value) => value.images ?? [])
  }
}
