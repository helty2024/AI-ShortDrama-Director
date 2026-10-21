import { z } from 'zod'

export type AIErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK'
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'INVALID_OUTPUT'
  | 'PROVIDER'
  | 'INTERRUPTED'
  | 'STALE_SOURCE'
export type TextFailureKind = 'http-4xx' | 'http-429' | 'http-5xx' | 'timeout' | 'dns' | 'tls' | 'connection-interrupted' | 'structured-output'
export interface TextFailureDiagnostics {
  kind: TextFailureKind
  httpStatus: number | null
  elapsedMs: number
  requestSent: boolean | null
}
export class AIError extends Error {
  readonly code: AIErrorCode
  readonly diagnostics?: TextFailureDiagnostics
  constructor(code: AIErrorCode, message: string, diagnostics?: TextFailureDiagnostics) {
    super(message)
    this.code = code
    this.diagnostics = diagnostics
  }
}
export function normalizeAIError(error: unknown): AIError {
  if (error instanceof AIError) return error
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return new AIError(
      'INVALID_OUTPUT',
      'AI 输出未通过结构校验，未写入生产结果',
    )
  return new AIError('PROVIDER', 'AI 任务失败，请检查 Provider 配置或重试')
}
export interface StructuredRequest<T> {
  system: string
  input: unknown
  schema: z.ZodType<T>
  schemaName: string
  signal: AbortSignal
  onResponse?: (metadata: { rawOutput: string | null; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null; model: string | null }) => void
  sampling?: { temperature: number; top_p: number }
}
export interface TextGenerationProvider {
  readonly name: string
  readonly model?: string
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>
}
export interface ProviderOptions {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
}
/** The same wire body is used by preview and execution; it contains no credential. */
export function structuredTextBody(config: { model: string; maxTokens?: number; outputMode?: 'json-schema' | 'json-object' | 'json-prompt' }, request: Pick<StructuredRequest<unknown>, 'system' | 'input' | 'schema' | 'schemaName' | 'sampling'>) {
  const mode = config.outputMode ?? 'json-schema', compatible = mode !== 'json-schema', schema = z.toJSONSchema(request.schema)
  return {
    model: config.model,
    ...(request.sampling ? z.strictObject({ temperature: z.number().min(0).max(2), top_p: z.number().min(0).max(1) }).parse(request.sampling) : {}),
    ...(config.maxTokens ? compatible ? { max_tokens: config.maxTokens } : { max_completion_tokens: config.maxTokens } : {}),
    messages: [
      { role: 'system', content: compatible ? `${request.system}\n只返回一个 JSON 对象，不要 Markdown 或额外说明。输出必须符合以下 JSON Schema：\n${JSON.stringify(schema)}` : request.system },
      { role: 'user', content: JSON.stringify(request.input) },
    ],
    ...(mode !== 'json-prompt' ? { response_format: mode === 'json-object' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema } } } : {}),
  }
}
export abstract class ValidatedTextProvider implements TextGenerationProvider {
  abstract readonly name: string
  private readonly options: ProviderOptions
  constructor(options: ProviderOptions = {}) {
    this.options = options
  }
  protected abstract generateRaw<T>(
    request: StructuredRequest<T>,
  ): Promise<unknown>
  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (request.signal.aborted) throw new AIError('CANCELLED', '任务已取消')
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: () => void = () => undefined
      try {
        const interrupted = new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            controller.abort()
            reject(new AIError('CANCELLED', '任务已取消'))
          }
          request.signal.addEventListener('abort', onAbort, { once: true })
          timer = setTimeout(() => {
            controller.abort()
            reject(new AIError('TIMEOUT', '文本模型请求超时'))
          }, this.options.timeoutMs ?? 30000)
        })
        const raw = await Promise.race([
          this.generateRaw({ ...request, signal: controller.signal }),
          interrupted,
        ])
        if (request.signal.aborted) throw new AIError('CANCELLED', '任务已取消')
        return request.schema.parse(raw)
      } catch (error) {
        const normalized = normalizeAIError(error)
        if (
          attempt >= (this.options.retries ?? 1) ||
          !['NETWORK', 'RATE_LIMIT', 'TIMEOUT'].includes(normalized.code) ||
          request.signal.aborted
        )
          throw normalized
      } finally {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', onAbort)
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(wait)
          reject(new AIError('CANCELLED', '任务已取消'))
        }
        const wait = setTimeout(
          () => {
            request.signal.removeEventListener('abort', onAbort)
            resolve()
          },
          (this.options.retryDelayMs ?? 250) * (attempt + 1),
        )
        request.signal.addEventListener('abort', onAbort, { once: true })
        if (request.signal.aborted) onAbort()
      })
    }
  }
}
export class CompatibleTextProvider extends ValidatedTextProvider {
  readonly name = 'compatible-text'
  private readonly config: { baseUrl: string; model: string; apiKey?: string; maxTokens?: number; outputMode?: 'json-schema' | 'json-object' | 'json-prompt' }
  private readonly fetcher: typeof fetch
  constructor(
    config: { baseUrl: string; model: string; apiKey?: string; maxTokens?: number; outputMode?: 'json-schema' | 'json-object' | 'json-prompt' },
    options?: ProviderOptions,
    fetcher: typeof fetch = fetch,
  ) {
    super(options)
    this.config = config
    this.fetcher = fetcher
    const url = new URL(config.baseUrl)
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )
    )
      throw new AIError('PROVIDER', '文本服务必须使用 HTTPS 或本机 HTTP')
    if (
      !config.model.trim() ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new AIError('PROVIDER', '文本服务配置无效')
  }
  protected async generateRaw<T>(
    request: StructuredRequest<T>,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher(
        this.config.baseUrl.replace(/\/$/, '') + '/chat/completions',
        {
          method: 'POST',
          signal: request.signal,
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey
              ? { Authorization: `Bearer ${this.config.apiKey}` }
              : {}),
          },
          body: JSON.stringify(structuredTextBody(this.config, request)),
        },
      )
    } catch (error) {
      if (error instanceof AIError) throw error
      throw new AIError('NETWORK', '无法连接文本服务')
    }
    if (response.status === 401 || response.status === 403)
      throw new AIError('AUTH', '密钥无效，请在 AI 服务中重新设置')
    if (response.status === 429) throw new AIError('RATE_LIMIT', '文本服务限流')
    if (!response.ok)
      throw new AIError(
        response.status >= 500 ? 'NETWORK' : 'PROVIDER',
        '文本服务请求失败',
      )
    const body: unknown = await response.json()
    const envelope = z
      .object({
        model: z.string().optional(),
        usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() }).nullish(),
        choices: z
          .array(
            z.object({
              finish_reason: z.string().nullable().optional(),
              message: z.object({
                content: z.string().nullable(),
                refusal: z.string().nullable().optional(),
              }),
            }),
          )
          .min(1),
      })
      .parse(body)
    const choice = envelope.choices[0]!
    request.onResponse?.({ rawOutput: choice.message.content, model: envelope.model ?? null, usage: envelope.usage ? { inputTokens: envelope.usage.prompt_tokens ?? null, outputTokens: envelope.usage.completion_tokens ?? null, totalTokens: envelope.usage.total_tokens ?? null } : null })
    if (choice.finish_reason && choice.finish_reason !== 'stop')
      throw new AIError('INVALID_OUTPUT', choice.finish_reason === 'length' ? '文本输出达到长度限制，未写入结果。请缩短故事或按场次处理后重新确认请求。' : '文本服务未完整结束，未写入结果；请检查模型与内容后重新确认请求。')
    const message = choice.message
    if (message.refusal || !message.content)
      throw new AIError('INVALID_OUTPUT', '文本服务未返回可用的结构化结果')
    return JSON.parse(message.content) as unknown
  }
}
