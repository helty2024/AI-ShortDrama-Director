import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, stat } from 'node:fs/promises'
import { z } from 'zod'
import { aiServiceInputSchema, aiServicesSnapshotSchema, type AIServiceInput } from '../../../src/shared/ai-services.js'
import type { ServiceSettingsCommand } from '../../../src/shared/service-settings.js'
import type { CredentialStore } from '../video/credentials.js'
import { CompatibleTextProvider, AIError, normalizeAIError, type StructuredRequest, type TextFailureKind, type TextGenerationProvider } from '../intelligence/provider.js'
import { ImageHttpTransport, type TransportFailure } from '../tools/adapters/image-http.js'
import { DomainError } from '../database.js'
import { packyImageModels } from '../../../src/shared/packy-models.js'

const storedSchema = aiServiceInputSchema.omit({ id: true }).extend({
  id: z.uuid(), credentialRef: z.uuid().nullable(), enabled: z.boolean(), deleted: z.boolean(),
  revision: z.number().int().positive(), checkedAt: z.iso.datetime().nullable(),
  connection: z.enum(['unchecked', 'accepted', 'rejected', 'unavailable']),
  structuredValidated: z.boolean(), reason: z.string().max(1000),
})
export type StoredAIService = z.infer<typeof storedSchema>
const catalogSchema = z.strictObject({
  mode: z.enum(['production', 'test']), services: z.array(storedSchema).max(30),
  defaults: z.record(z.string(), z.uuid()),
  revisions: z.array(storedSchema).default([]),
  defaultImageTool: z.enum(['packy.image-25','comfyui.local']).nullable().default(null),
  localEnabled: z.boolean().default(true), localArchived: z.boolean().default(false),
})
type Catalog = z.infer<typeof catalogSchema>
export const TEXT_REQUEST_TIMEOUT_MS = 90000
export const TEXT_ANALYSIS_MAX_TOKENS = 8192
export const TEXT_ANALYSIS_MAX_REQUEST_BYTES = 128 * 1024
interface ServicesHost {
  assertIdle: () => void
  apply: (catalog: Catalog) => Promise<void>
  importKey: () => Promise<string | null>
  probe: (service: StoredAIService) => Promise<{ accepted: boolean; reason: string }>
  native?: (service: StoredAIService, command: ServiceSettingsCommand) => Promise<string>
  generationStatus?: (service: StoredAIService) => Promise<'unverified' | 'trial' | 'validated' | 'blocked'>
}
export class AIServiceManager {
  private catalog: Catalog
  private busy = false
  readonly path: string
  readonly credentials: CredentialStore
  private readonly host: ServicesHost
  private readonly transport: ImageHttpTransport
  constructor(path: string, credentials: CredentialStore, host: ServicesHost, testMode = false, transport = new ImageHttpTransport({ timeoutMs: TEXT_REQUEST_TIMEOUT_MS })) {
    this.path = path; this.credentials = credentials; this.host = host; this.transport = transport
    this.catalog = { mode: testMode ? 'test' : 'production', services: [], defaults: {}, revisions: [], defaultImageTool: null, localEnabled: true, localArchived: false }
  }
  async load() {
    try { this.catalog = catalogSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))) }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw new DomainError('INVALID_INPUT', 'AI 服务配置读取失败；原文件保留，请在高级诊断中处理')
    }
  }
  get mode() { return this.catalog.mode }
  get defaultImageTool() { return this.mode==='test'?null:this.catalog.defaultImageTool }
  get localEnabled() { return this.catalog.localEnabled && !this.catalog.localArchived }
  async applyCurrent() { await this.host.apply(this.catalog) }
  get services() { return this.catalog.services.filter(s => !s.deleted) }
  async retainExisting(input: Omit<AIServiceInput, 'id'>, credentialRef: string | null) {
    if (this.catalog.services.some(s => s.kind === input.kind)) return
    const s = storedSchema.parse({ ...input, id: randomUUID(), credentialRef, enabled: true, deleted: false, revision: 1,
      checkedAt: null, connection: 'unchecked', structuredValidated: false, reason: '已保留原配置与历史凭据，请重新检测连接；未开放真实生成。' })
    this.catalog.services.push(s)
    await writeFile(this.path + '.tmp', JSON.stringify(this.catalog, null, 2) + '\n', { mode: 0o600 })
    await rename(this.path + '.tmp', this.path)
  }
  defaultService(kind: AIServiceInput['kind']) {
    return this.services.find(s => s.kind === kind && s.enabled && s.id === this.catalog.defaults[kind])
  }
  async snapshot() {
    return aiServicesSnapshotSchema.parse({ mode: this.mode, defaultImageTool:this.defaultImageTool, localEnabled:this.localEnabled, localArchived:this.catalog.localArchived, services: await Promise.all(this.services.map(async s => ({
      ...aiServiceInputSchema.parse({ id: s.id, kind: s.kind, name: s.name, baseUrl: s.baseUrl, model: s.model, ...(s.kind === 'text' ? { textOutputMode: s.textOutputMode ?? 'json-schema' } : {}) }),
      enabled: s.enabled, isDefault: this.catalog.defaults[s.kind] === s.id,
      credentialSaved: Boolean(s.credentialRef && await this.credentials.has(s.credentialRef)),
      connection: s.connection, generation: !s.enabled || ['rejected','unavailable'].includes(s.connection) ? 'blocked' : s.kind === 'text' ? s.structuredValidated && s.connection==='accepted' ? 'validated' : 'unverified' : await this.host.generationStatus?.(s) ?? 'unverified',
      reason: s.reason, checkedAt: s.checkedAt,
    }))) })
  }
  private async persist(next: Catalog, applyRuntime = true) {
    next = {...next,revisions:[...this.catalog.revisions,...this.catalog.services.filter(old=>next.services.some(s=>s.id===old.id && s.revision!==old.revision))]}
    const value = catalogSchema.parse(next)
    await writeFile(this.path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await rename(this.path + '.tmp', this.path)
    this.catalog = value
    if(applyRuntime)await this.host.apply(value)
    return this.snapshot()
  }
  private find(id: string) {
    const s = this.services.find(s => s.id === id)
    if (!s) throw new DomainError('NOT_FOUND', '服务配置不存在')
    return s
  }
  private text(s: StoredAIService): TextGenerationProvider {
    const transport = this.transport, credentials = this.credentials
    return { name: 'compatible-text', model: s.model, generateStructured: async <T>(request: StructuredRequest<T>): Promise<T> => {
      const started = Date.now()
      let sent: boolean | null = false
      const fetcher: typeof fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        try {
          const key = s.credentialRef ? await credentials.get(s.credentialRef) : undefined
          const body = String(init?.body ?? '')
          if (['production_breakdown', 'shot_plan'].includes(request.schemaName) && Buffer.byteLength(body, 'utf8') > TEXT_ANALYSIS_MAX_REQUEST_BYTES)
            throw new AIError('PROVIDER', '当前场次与已知资产内容过长，请缩短场次或整理资产后再手动确认请求')
          sent = null
          const result = await transport.bytes(url, init?.signal ?? AbortSignal.timeout(TEXT_REQUEST_TIMEOUT_MS), {
            method: 'POST', key, body, limit: 4 * 1024 * 1024,
          })
          sent = true
          return new Response(result.bytes.toString('utf8'), { status: 200, headers: { 'Content-Type': result.mime } })
        } catch (raw) {
          if (raw instanceof AIError) throw raw
          const failure = raw as Partial<TransportFailure> | null
          sent = typeof failure?.sent === 'boolean' ? failure.sent : sent
          const status = failure?.diagnostics?.status
          const httpStatus = typeof status === 'number' && status >= 100 && status <= 599 ? status : null
          const transportCode = failure?.error?.code
          const kind: TextFailureKind = httpStatus === 429 ? 'http-429' : httpStatus !== null ? httpStatus >= 500 ? 'http-5xx' : 'http-4xx'
            : transportCode === 'timeout' ? 'timeout' : failure?.networkKind ?? 'connection-interrupted'
          const code = httpStatus === 401 || httpStatus === 403 ? 'AUTH' : kind === 'http-429' ? 'RATE_LIMIT'
            : kind === 'timeout' ? 'TIMEOUT' : kind === 'http-4xx' || kind === 'http-5xx' ? 'PROVIDER' : 'NETWORK'
          const message = kind === 'http-429' ? '文本服务限流；请稍后手动重试' : kind === 'http-4xx' ? '文本服务拒绝请求；请核对模型、权限与输出格式'
            : kind === 'http-5xx' ? '文本服务端暂时失败；结果未知，请先核对供应商记录' : kind === 'timeout' ? '文本服务请求超时；结果未知，请先核对供应商记录'
              : kind === 'dns' ? '无法解析文本服务地址，请检查网络和地址' : kind === 'tls' ? '文本服务安全连接失败，请检查证书和网络' : '文本服务连接中断；结果未知，请先核对供应商记录'
          throw new AIError(code, message, { kind, httpStatus, elapsedMs: Date.now() - started, requestSent: sent })
        }
      }
      const analysis = ['production_breakdown', 'shot_plan'].includes(request.schemaName)
      const provider = new CompatibleTextProvider({ baseUrl: s.baseUrl, model: s.model, maxTokens: analysis ? TEXT_ANALYSIS_MAX_TOKENS : 4000, outputMode: s.textOutputMode ?? 'json-schema' }, { retries: 0, timeoutMs: TEXT_REQUEST_TIMEOUT_MS }, fetcher)
      try { return await provider.generateStructured(request) }
      catch (raw) {
        const error = normalizeAIError(raw)
        if (error.diagnostics) throw error
        if (error.code === 'INVALID_OUTPUT') throw new AIError(error.code, error.message, { kind: 'structured-output', httpStatus: 200, elapsedMs: Date.now() - started, requestSent: true })
        if (error.code === 'TIMEOUT') throw new AIError(error.code, error.message, { kind: 'timeout', httpStatus: null, elapsedMs: Date.now() - started, requestSent: sent })
        throw error
      }
    } }
  }
  textProvider(mock: TextGenerationProvider, options: { validateOnFirstTask?: boolean } = {}): TextGenerationProvider {
    const selected = () => this.defaultService('text'), mode = () => this.mode
    const generate = async <T>(request: StructuredRequest<T>) => {
      if (this.mode === 'test') return mock.generateStructured(request)
      const s = selected()
      if (!s || !s.credentialRef) throw new AIError('AUTH', '请先连接 AI 服务，并设为默认文本模型')
      if ((!s.structuredValidated || s.connection!=='accepted') && !options.validateOnFirstTask) throw new AIError('INVALID_OUTPUT', '请先在 AI 服务中检测连接并验证该模型的结构化输出协议')
      const output = await this.text(s).generateStructured(request)
      if (!s.structuredValidated || s.connection !== 'accepted') {
        const current = this.services.find(v => v.id === s.id && v.revision === s.revision)
        if (current) await this.persist({ ...this.catalog, services: this.catalog.services.map(v => v.id === s.id ? { ...current, connection: 'accepted', checkedAt: new Date().toISOString(), structuredValidated: true, reason: '首个真实任务结果已通过结构校验。后续任务仍需确认费用，失败不会自动重试。' } : v) }, false)
      }
      return output
    }
    return {
      get name() { const s = selected(); return mode() === 'test' ? mock.name : s ? `text:${s.id}:r${s.revision}` : 'text-unconfigured' },
      get model() { return selected()?.model },
      generateStructured: generate,
    }
  }
  /** Uses the existing text adapter and freezes one configuration for an A/B pair.
   * Preparing this binding never decrypts credentials or performs a request. */
  captureSkillText(sampling?: { temperature: number; top_p: number }) {
    const service = this.defaultService('text')
    if (this.mode !== 'production' || !service?.credentialRef || service.connection !== 'accepted' || !service.structuredValidated) return null
    const frozen = structuredClone(service)
    return { snapshot: { real: true, serviceId: frozen.id, revision: frozen.revision, model: frozen.model, baseUrl: frozen.baseUrl, textOutputMode: frozen.textOutputMode ?? 'json-schema', maxTokens: 4000, sampling: sampling ?? null, credentialRef: frozen.credentialRef }, provider: this.text(frozen) }
  }
  async execute(command: ServiceSettingsCommand) {
    if (command.op === 'ai.list') return this.snapshot()
    if (!command.op.startsWith('ai.')) throw new DomainError('INVALID_INPUT', '非 AI 服务命令')
    if (this.busy) throw new DomainError('CONFLICT', '服务配置操作正在进行，请稍候')
    this.busy = true
    try {
      if(!['ai.probe','ai.verifyVideoDownload'].includes(command.op))this.host.assertIdle()
      if (command.op === 'ai.mode') return await this.persist({ ...this.catalog, mode: command.mode })
      if (command.op === 'ai.defaultLocal') return await this.persist({...this.catalog,defaultImageTool:'comfyui.local'})
      if (command.op === 'ai.localEnable') return await this.persist({...this.catalog,localEnabled:command.enabled,localArchived:false})
      if (command.op === 'ai.localDelete') return await this.persist({...this.catalog,localEnabled:false,localArchived:true})
      if (command.op === 'ai.save') {
        const input = aiServiceInputSchema.parse(command.service), url = new URL(input.baseUrl)
        if (input.kind !== 'text' && input.textOutputMode !== undefined)
          throw new DomainError('INVALID_INPUT', '文本兼容方式仅适用于文本服务')
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port && url.port !== '443')
          throw new DomainError('INVALID_INPUT', '云服务地址必须为 HTTPS，不含密钥、查询参数或自定义端口')
        if (input.kind === 'packy-image' && (input.baseUrl !== 'https://cf.api.fan/v1' || !packyImageModels.some(model => model === input.model)) ||
          input.kind === 'compshare-video' && (input.baseUrl !== 'https://cp.compshare.cn' || input.model !== 'MiniMax-H3'))
          throw new DomainError('INVALID_INPUT', '请使用已实现供应商的固定协议模板')
        const old = input.id ? this.find(input.id) : undefined
        if (old && old.baseUrl !== input.baseUrl && !command.apiKey?.trim())
          throw new DomainError('INVALID_INPUT', '更换服务地址时请重新输入对应服务密钥；不会将原密钥发送给新地址')
        if (old && old.kind !== input.kind) throw new DomainError('CONFLICT', '不能改变历史配置的接口协议')
        if (!old && input.kind !== 'text' && this.services.some(s => s.kind === input.kind))
          throw new DomainError('CONFLICT', '该原生服务已有配置，请修改原配置；历史关联不会删除')
        let credentialRef = old?.credentialRef ?? null
        if (command.apiKey?.trim()) {
          if (input.kind === 'compshare-video' && !/^sk-ml-[a-zA-Z0-9_-]+$/.test(command.apiKey.trim())) throw new DomainError('INVALID_INPUT', '请使用 CompShare 模型密钥')
          credentialRef = randomUUID()
          await this.credentials.set(credentialRef, command.apiKey)
        }
        const s = storedSchema.parse({ ...input, id: old?.id ?? randomUUID(), credentialRef, enabled: old?.enabled ?? true, deleted: false,
          revision: (old?.revision ?? 0) + 1, connection: 'unchecked', checkedAt: null, structuredValidated: false, reason: '配置已保存；请检测连接。保存密钥不会提交生成任务。' })
        return await this.persist({ ...this.catalog, services: [...this.catalog.services.filter(v => v.id !== s.id), s] })
      }
      if (!('id' in command)) throw new DomainError('INVALID_INPUT', '服务命令无效')
      const s = this.find(command.id)
      const replace = (updated: StoredAIService, applyRuntime=true) => this.persist({ ...this.catalog, services: this.catalog.services.map(v => v.id === s.id ? updated : v) },applyRuntime)
      if (command.op === 'ai.verifyVideoDownload' || command.op === 'ai.authorizeTrial') {
        if(!this.host.native) throw new DomainError('CONFLICT','生产验证尚不可用')
        const reason=await this.host.native(s,command)
        return await replace({...s,reason},command.op!=='ai.verifyVideoDownload')
      }
      if (command.op === 'ai.importKey') {
        const path = await this.host.importKey()
        if (!path) return this.snapshot()
        if ((await stat(path)).size > 8192) throw new DomainError('INVALID_INPUT', '密钥文件过大')
        const apiKey = (await readFile(path, 'utf8')).trim()
        if (s.kind === 'compshare-video' && !/^sk-ml-[a-zA-Z0-9_-]+$/.test(apiKey)) throw new DomainError('INVALID_INPUT', '请使用 CompShare 模型密钥')
        const credentialRef = randomUUID(); await this.credentials.set(credentialRef, apiKey)
        return await replace({ ...s, credentialRef, revision: s.revision + 1, connection: 'unchecked', checkedAt: null, structuredValidated: false, reason: '新密钥已加密保存；原凭据及历史关联保留，请重新检测连接。' })
      }
      if (command.op === 'ai.enable') return await replace({ ...s, enabled: command.enabled })
      if (command.op === 'ai.delete') return await replace({ ...s, deleted: true, enabled: false, reason: '配置已归档；历史任务与加密凭据保留' })
      if (command.op === 'ai.default') {
        if (!s.enabled) throw new DomainError('CONFLICT', '请先启用此服务')
        return await this.persist({ ...this.catalog, defaults: { ...this.catalog.defaults, [s.kind]: s.id }, defaultImageTool:s.kind==='packy-image'?'packy.image-25':this.catalog.defaultImageTool })
      }
      if (!s.enabled || !s.credentialRef) throw new DomainError('CONFLICT', '请先启用服务并保存密钥')
      if (command.op === 'ai.probe') {
        try {
          let accepted: boolean, reason: string
          if (s.kind === 'text') {
            const result = await this.transport.bytes(s.baseUrl.replace(/\/$/, '') + '/models', AbortSignal.timeout(15000), { key: await this.credentials.get(s.credentialRef), limit: 2 * 1024 * 1024 })
            const body = z.object({ data: z.array(z.object({ id: z.string() })).max(10000) }).parse(JSON.parse(result.bytes.toString('utf8')))
            accepted = body.data.some(m => m.id === s.model)
            reason = accepted ? '连接检测通过，目标模型可见。仍需单独验证结构化输出（可能收费）。' : '该模型不支持当前任务：模型列表未包含所选模型，请检查名称与权限'
          } else ({ accepted, reason } = await this.host.probe(s))
          return await replace({ ...s, checkedAt: new Date().toISOString(), connection: accepted ? 'accepted' : 'rejected', reason },false)
        } catch (raw) {
          const authentication=raw instanceof AIError && raw.code==='AUTH' || Boolean(raw && typeof raw==='object' && 'error' in raw && raw.error && typeof raw.error==='object' && 'code' in raw.error && ['authentication','authorization'].includes(String(raw.error.code)))
          return await replace({ ...s, checkedAt: new Date().toISOString(), connection: authentication?'rejected':'unavailable', reason: authentication?'密钥无效，请重新设置。未提交生成任务。':'连接检测未通过，请检查网络和模型权限后重试。未提交生成任务。' },false)
        }
      }
      if (command.op === 'ai.validateText') {
        if (s.kind !== 'text' || s.connection !== 'accepted') throw new DomainError('CONFLICT', '请先完成文本服务只读检测')
        try {
          await this.text(s).generateStructured({ system: '只输出符合 Schema 的 JSON。ok 必须为 true。', input: '检查结构化协议。', schema: z.strictObject({ ok: z.literal(true) }), schemaName: 'director_protocol_check', signal: AbortSignal.timeout(90000) })
          return await replace({ ...s, structuredValidated: true, reason: '结构化协议验证通过。故事、解析、提取和分镜任务将由默认文本模型执行，每次启动需确认真实请求。' })
        } catch { return await replace({ ...s, structuredValidated: false, reason: '结构化协议未通过。此服务不能用于正式文本任务；请检查模型是否支持严格 JSON Schema 和账户权限。' }) }
      }
      throw new DomainError('INVALID_INPUT', '不支持的服务操作')
    } finally { this.busy = false }
  }
}
