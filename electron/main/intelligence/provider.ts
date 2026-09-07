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
export class AIError extends Error {
  readonly code: AIErrorCode
  constructor(code: AIErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
export function normalizeAIError(error: unknown): AIError {
  if (error instanceof AIError) return error
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return new AIError(
      'INVALID_OUTPUT',
      '文本模型输出未通过结构校验，未写入正式数据',
    )
  return new AIError('PROVIDER', '文本任务失败，请检查 Provider 配置或重试')
}
export interface StructuredRequest<T> {
  system: string
  input: unknown
  schema: z.ZodType<T>
  schemaName: string
  signal: AbortSignal
}
export interface TextGenerationProvider {
  readonly name: string
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>
}
export interface ProviderOptions {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
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
  private readonly config: { baseUrl: string; model: string; apiKey?: string }
  private readonly fetcher: typeof fetch
  constructor(
    config: { baseUrl: string; model: string; apiKey?: string },
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
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: JSON.stringify(request.input) },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.schemaName,
                strict: true,
                schema: z.toJSONSchema(request.schema),
              },
            },
          }),
        },
      )
    } catch {
      throw new AIError('NETWORK', '无法连接文本服务')
    }
    if (response.status === 401 || response.status === 403)
      throw new AIError('AUTH', '文本服务认证失败，请在主进程环境配置密钥')
    if (response.status === 429) throw new AIError('RATE_LIMIT', '文本服务限流')
    if (!response.ok)
      throw new AIError(
        response.status >= 500 ? 'NETWORK' : 'PROVIDER',
        '文本服务请求失败',
      )
    const body: unknown = await response.json()
    const envelope = z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({
                content: z.string().nullable(),
                refusal: z.string().nullable().optional(),
              }),
            }),
          )
          .min(1),
      })
      .parse(body)
    const message = envelope.choices[0]!.message
    if (message.refusal || !message.content)
      throw new AIError('INVALID_OUTPUT', '文本服务未返回可用的结构化结果')
    return JSON.parse(message.content) as unknown
  }
}
