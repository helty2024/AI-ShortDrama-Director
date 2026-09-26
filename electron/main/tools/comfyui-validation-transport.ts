import assert from 'node:assert/strict'
import { open } from 'node:fs/promises'
import { z } from 'zod'

const keys = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort().slice(0, 40)
    : []
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

/** Opt-in validation instrument. No retry; durable gate survives process restarts.
 * Capture envelope structure only, never workflow bodies, output names or pixels.
 */
export class ComfyValidationTransport {
  private readonly intentPath: string
  private readonly origin: string
  private readonly checkpoint: string
  private readonly readOnly: boolean
  private readonly fetcher: typeof fetch
  readonly observed = {
    submitCount: 0, submitHttpStatus: null as number | null,
    submitResponseFields: [] as string[], promptId: null as string | null,
    promptIdFormat: null as string | null,
    historyHttpStatus: null as number | null,
    historyEnvelopeFields: [] as string[], outputNodeFields: [] as string[],
    outputImageFields: [] as string[],
    viewHttpStatus: null as number | null, viewMime: null as string | null,
  }
  constructor(
    intentPath: string,
    origin: string,
    checkpoint: string,
    readOnly: boolean,
    fetcher: typeof fetch = fetch,
  ) {
    this.intentPath = intentPath
    this.origin = origin
    this.checkpoint = checkpoint
    this.readOnly = readOnly
    this.fetcher = fetcher
  }
  readonly fetch: typeof fetch = async (input, init) => {
    assert.equal(typeof input, 'string')
    const url = new URL(String(input)), method = init?.method ?? 'GET'
    assert.equal(url.origin, this.origin)
    if (method !== 'GET') {
      assert.equal(this.readOnly, false, 'Recovery cannot submit')
      assert.equal(method, 'POST')
      assert.equal(url.pathname, '/prompt')
      assert.equal(this.observed.submitCount, 0, 'Only one submit is authorized')
      assert.equal(typeof init?.body, 'string')
      const payload = z.object({ prompt: z.record(z.string(), z.object({
        class_type: z.string(), inputs: z.record(z.string(), z.unknown()),
      })) }).parse(JSON.parse(String(init?.body)))
      const graph = payload.prompt
      assert.equal(graph['1']?.inputs.ckpt_name, this.checkpoint)
      assert.equal(graph['2']?.inputs.text, 'A red apple on a white table')
      assert.equal(graph['3']?.inputs.text, '')
      assert.equal(graph['4']?.inputs.width, 1024)
      assert.equal(graph['4']?.inputs.height, 1024)
      assert.equal(graph['4']?.inputs.batch_size, 1)
      assert.equal(graph['5']?.inputs.steps, 20)
      assert.equal(graph['5']?.inputs.cfg, 7)
      assert.equal(Object.values(graph).filter((node) => node.class_type === 'SaveImage').length, 1)
      assert.equal(Object.values(graph).some((node) => node.class_type === 'LoadImage'), false)
      assert.equal(JSON.stringify(graph).includes('{{'), false)
      const intent = await open(this.intentPath, 'wx', 0o600)
      try {
        await intent.writeFile(JSON.stringify({
          createdAt: new Date().toISOString(), state: 'submission-intent',
          capability: 'image.generate', count: 1, checkpoint: this.checkpoint,
          resolution: { width: 1024, height: 1024 },
        }))
        await intent.sync()
      } finally { await intent.close() }
      this.observed.submitCount++
    } else {
      assert.ok(['/system_stats', '/object_info', '/queue', '/view'].includes(url.pathname) || /^\/history\/[a-zA-Z0-9-]+$/.test(url.pathname))
    }
    const response = await this.fetcher(input, init)
    if (url.pathname === '/prompt') {
      this.observed.submitHttpStatus = response.status
      const body: unknown = await response.clone().json()
      this.observed.submitResponseFields = keys(body)
      const id = z.string().min(1).max(256).parse(object(body).prompt_id)
      this.observed.promptId = id
      this.observed.promptIdFormat = z.uuid().safeParse(id).success ? 'uuid' : 'opaque-id'
    } else if (url.pathname.startsWith('/history/')) {
      this.observed.historyHttpStatus = response.status
      const body: unknown = await response.clone().json()
      const entry = object(body)[decodeURIComponent(url.pathname.slice('/history/'.length))]
      if (entry) {
        this.observed.historyEnvelopeFields = keys(entry)
        const node = Object.values(object(object(entry).outputs))[0]
        this.observed.outputNodeFields = keys(node)
        const images = object(node).images
        this.observed.outputImageFields = Array.isArray(images) ? keys(images[0]) : []
      }
    } else if (url.pathname === '/view') {
      this.observed.viewHttpStatus = response.status
      this.observed.viewMime = response.headers.get('content-type')?.split(';')[0] ?? null
    }
    return response
  }
}
