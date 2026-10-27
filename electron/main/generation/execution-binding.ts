import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DomainError } from '../database.js'
import { GenerationRepository } from './repository.js'
import { ApprovalRepository } from './approval-repository.js'
import { immutable, type RegisteredTool } from '../tools/registry.js'
import { executionBindingSchema, executionConfigurationSchema, type ExecutionBinding, type ExecutionConfiguration } from '../../../src/shared/execution-binding.js'
import type { ProvenanceRecord } from '../../../src/shared/provenance.js'
import type { ToolAdapter } from '../tools/protocol.js'
import type { Capability } from '../../../src/shared/capabilities/index.js'

type Adapter = ToolAdapter<never> & { readonly profile: object }
export type ServiceIdentity = { provider: string; serviceId: string; serviceRevision: number; endpoint: string }
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)
export const configurationHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
export function configuration(adapter: Adapter, identity?: ServiceIdentity): ExecutionConfiguration {
  const profile = z.record(z.string(), z.json()).parse(structuredClone(adapter.profile))
  // Only references, never authentication material, are serializable here.
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:api.?key|secret|password|authorization|access.?token|headers)$/i.test(key)) throw new DomainError('FORBIDDEN', '执行配置不得包含密钥或认证头')
      inspect(item)
    }
  }
  inspect(profile)
  return immutable(executionConfigurationSchema.parse({ provider: identity?.provider ?? String(profile.adapter ?? adapter.describe().id), serviceId: identity?.serviceId ?? null, serviceRevision: identity?.serviceRevision ?? null, endpoint: identity?.endpoint ?? profile.baseEndpoint ?? profile.endpoint ?? profile.baseUrl ?? null, profile, descriptor: adapter.describe() }))
}
export function bindingHistoryCopy(value: unknown, sanitize: (value: unknown) => unknown) {
  const binding = executionBindingSchema.parse(value)
  binding.configuration = executionConfigurationSchema.parse(sanitize(binding.configuration))
  for (const field of ['approval', 'item'] as const) {
    const row = z.record(z.string(), z.json()).parse(binding.authorization[field])
    binding.authorization[field] = { ...row, status: 'historical' }
  }
  binding.recoveryAllowed = false
  binding.configurationHash = configurationHash(binding.configuration)
  return binding
}

/** Main-process-only resolver; never registers historical adapters for new routing. */
export class ExecutionBindings<T extends Adapter> {
  readonly generation: GenerationRepository
  private readonly identities = new WeakMap<T, ServiceIdentity>()
  private readonly adapters = new Map<string, T>()
  resolver: ((config: ExecutionConfiguration) => Promise<T | null>) | undefined
  constructor(generation: GenerationRepository) { this.generation = generation }
  register(adapter: T, identity?: ServiceIdentity) {
    if (identity) this.identities.set(adapter, structuredClone(identity))
    this.adapters.set(configurationHash(this.describe(adapter)), adapter)
  }
  describe(adapter: T) { return configuration(adapter, this.identities.get(adapter)) }
  capture(record: ProvenanceRecord, adapter: T, reservationId: string) {
    const approvals = new ApprovalRepository(this.generation.database), p = record.projectId
    const reservation = approvals.get('approval_reservations', p, reservationId)
    if (reservation.generationRecordId !== record.id || reservation.taskId !== record.taskId || reservation.approvalId !== record.approvalId) throw new DomainError('CONFLICT', '费用授权不属于原执行任务')
    const config = this.describe(adapter)
    if (config.descriptor.id !== record.toolId || config.descriptor.version !== record.toolVersion || config.profile.modelId !== record.modelId) throw new DomainError('CONFLICT', '适配器与原执行配置不一致')
    const value = executionBindingSchema.parse({ id: randomUUID(), projectId: p, generationRecordId: record.id, taskId: record.taskId, createdAt: new Date().toISOString(), formatVersion: 1, configuration: config, configurationHash: configurationHash(config), requestFingerprint: record.requestFingerprint, parameters: record.parameters,
      authorization: { approvalId: record.approvalId, reservationId, approvalItemId: reservation.approvalItemId, currency: reservation.currency, reservedAmountMicro: reservation.reservedAmountMicro, approval: approvals.get('generation_approvals', p, reservation.approvalId), item: approvals.get('approval_items', p, reservation.approvalItemId) }, recoveryAllowed: true })
    this.generation.database.connection.prepare('INSERT INTO execution_bindings(id,project_id,data) VALUES (?,?,?)').run(value.id, p, JSON.stringify(value))
    return immutable(value)
  }
  get(record: ProvenanceRecord): ExecutionBinding {
    const row = this.generation.database.connection.prepare('SELECT data FROM execution_bindings WHERE project_id=? AND record_id=?').get(record.projectId, record.id)
    if (!row) throw new DomainError('CONFLICT', '历史任务缺少可验证的原执行绑定；保留记录，禁止猜测当前配置或重新提交')
    const b = executionBindingSchema.parse(JSON.parse(String(row.data)))
    if (b.projectId !== record.projectId || b.generationRecordId !== record.id || b.taskId !== record.taskId || b.requestFingerprint !== record.requestFingerprint || canonical(b.parameters) !== canonical(record.parameters) || b.authorization.approvalId !== record.approvalId || configurationHash(b.configuration) !== b.configurationHash || b.configuration.descriptor.id !== record.toolId || b.configuration.descriptor.version !== record.toolVersion || b.configuration.profile.modelId !== record.modelId)
      throw new DomainError('CONFLICT', '原执行绑定校验失败，已阻断')
    this.generation.checkRecord(record)
    const reservation = new ApprovalRepository(this.generation.database).get('approval_reservations', record.projectId, b.authorization.reservationId)
    if (reservation.taskId !== record.taskId || reservation.generationRecordId !== record.id || reservation.approvalId !== b.authorization.approvalId || reservation.approvalItemId !== b.authorization.approvalItemId || reservation.currency !== b.authorization.currency || reservation.reservedAmountMicro !== b.authorization.reservedAmountMicro) throw new DomainError('CONFLICT', '原执行绑定的费用授权不匹配')
    return immutable(b)
  }
  entry(adapter: T): RegisteredTool {
    return Object.freeze({ descriptor: this.describe(adapter).descriptor, adapter: adapter as ToolAdapter<Capability>, executionIdentity: configurationHash(this.describe(adapter)) })
  }
  async resolve(record: ProvenanceRecord): Promise<T> {
    const b = this.get(record)
    if (!b.recoveryAllowed) throw new DomainError('FORBIDDEN', '恢复的备份不包含原任务执行权限')
    const adapter = this.adapters.get(b.configurationHash) ?? await this.resolver?.(b.configuration)
    const identity = b.configuration.serviceId ? { provider: b.configuration.provider, serviceId: b.configuration.serviceId, serviceRevision: b.configuration.serviceRevision!, endpoint: b.configuration.endpoint! } : undefined
    if (!adapter || configurationHash(configuration(adapter, identity)) !== b.configurationHash) throw new DomainError('CONFLICT', '原执行配置、适配器版本或凭据引用不可用；禁止切换到当前默认模型')
    this.register(adapter, identity)
    return adapter
  }
}
