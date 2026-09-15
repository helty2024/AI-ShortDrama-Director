import type { ToolBroker, BrokerRequest, PreflightResult } from '../tools/broker.js'
import { aiTaskSchema } from '../../../src/shared/intelligence.js'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DomainError } from '../database.js'
import { approvalSchema, approvalBindingSchema, type Approval, type ApprovalItem, type Reservation } from '../../../src/shared/approval.js'
import { persistedRecordSchema, type ProvenanceRecord } from '../../../src/shared/provenance.js'
import type { AITask } from '../../../src/shared/intelligence.js'
import { ApprovalRepository } from './approval-repository.js'
import { GenerationRepository } from './repository.js'
import { GenerationService } from './service.js'

function fail(reason: string): never { throw new DomainError('CONFLICT', reason) }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  return JSON.stringify(value)
}
export function approvalFingerprint(items: ApprovalItem[]): string {
  return 'sha256:' + createHash('sha256').update(canonical(items.map(i => ({ ...approvalBindingSchema.parse(i), id: i.id, currency: i.currency, ceiling: i.estimatedMaxCostMicro, allowUnknownCost: i.allowUnknownCost })).sort((a,b) => a.id.localeCompare(b.id)))).digest('hex')
}
const authorizationInput = z.strictObject({
  confirmed: z.literal(true), projectId: z.uuid(), scope: z.enum(['single','batch']), currency: approvalSchema.shape.currency,
  maxAuthorizedCostMicro: approvalSchema.shape.maxAuthorizedCostMicro, expiresAt: z.iso.datetime(),
  items: z.array(z.strictObject({ record: persistedRecordSchema, estimatedMaxCostMicro: approvalSchema.shape.maxAuthorizedCostMicro, allowUnknownCost: z.boolean().default(false) })).min(1).max(1000),
})
/** Main-private authority boundary. Only an explicit user-confirmed command may call createApproval.
 * Preflight never calls this method. Existing provider executors are deliberately not bridged yet. */
export class GenerationApprovalService {
  readonly generation: GenerationRepository
  readonly repository: ApprovalRepository
  readonly now: () => string
  constructor(repository: ApprovalRepository, now = () => new Date().toISOString()) {
    this.repository = repository; this.now = now
    this.generation = new GenerationRepository(repository.database)
  }
  getApproval(p: string, id: string) { return this.repository.get('generation_approvals', p, id) }
  listApprovals(p: string) { return this.repository.list('generation_approvals', p) }
  history(p: string, id: string) { return this.repository.history(p, id) }
  createApproval(raw: unknown): Approval {
    return this.repository.atomic(() => {
      const parsed = authorizationInput.safeParse(raw)
      if (!parsed.success) fail('approval-invalid')
      const input = parsed.data, now = this.now(), id = randomUUID()
      if (input.expiresAt <= now || (input.scope === 'single' && input.items.length !== 1)) fail('approval-expired')
      this.repository.database.get(input.projectId)
      const items: ApprovalItem[] = input.items.map(({ record, estimatedMaxCostMicro, allowUnknownCost }) => {
        if (record.projectId !== input.projectId) fail('item-not-authorized')
        this.checkPreflight(record, input.currency, estimatedMaxCostMicro, allowUnknownCost)
        return { ...approvalBindingSchema.parse(record), id: randomUUID(), projectId: input.projectId, approvalId: id, createdAt: now, currency: input.currency, estimatedMaxCostMicro, allowUnknownCost, status: 'authorized' }
      })
      if (new Set(items.map(i => i.targetObjectId + ':' + i.requestFingerprint)).size !== items.length) fail('item-not-authorized')
      const approval = this.repository.insert('generation_approvals', { id, projectId: input.projectId, createdAt: now, scope: input.scope, currency: input.currency, maxAuthorizedCostMicro: input.maxAuthorizedCostMicro, itemIds: items.map(i => i.id), requestFingerprint: input.scope === 'single' ? items[0].requestFingerprint : null, batchFingerprint: input.scope === 'batch' ? approvalFingerprint(items) : null, approvedAt: now, expiresAt: input.expiresAt, status: 'active', invalidatedAt: null, invalidationReason: null })
      for (const item of items) this.repository.insert('approval_items', item)
      return approval
    })
  }
  private checkPreflight(record: ProvenanceRecord, currency: string, ceiling: number, allowUnknown: boolean): void {
    const estimate = this.generation.get('generation_estimates', record.projectId, record.estimateId)
    const decision = this.generation.get('routing_decisions', record.projectId, record.routingDecisionId)
    if (estimate.validUntil <= this.now()) fail('estimate-expired')
    if (estimate.requestFingerprint !== record.requestFingerprint) fail('fingerprint-mismatch')
    if (estimate.routingDecisionId !== decision.id || decision.selectedToolId !== record.toolId || decision.selectedToolVersion !== record.toolVersion || decision.selectedModel !== record.modelId || decision.requestedCapability !== record.generationType) fail('routing-mismatch')
    if (record.currency !== currency || (estimate.cost.status === 'known' && estimate.cost.estimatedCost.currency !== currency)) fail('currency-mismatch')
    if (canonical(record.estimatedCost) !== canonical(estimate.cost)) fail('approval-invalid')
    if (estimate.cost.status === 'unknown' && !allowUnknown) fail('unknown-cost-not-authorized')
    if (estimate.cost.status === 'known' && estimate.cost.estimatedCost.amountMicros > ceiling) fail('budget-exceeded')
    const target = this.generation.entity(record.projectId, record.targetObjectId)
    if (target.kind !== record.targetObjectType) fail('item-not-authorized')
    for (const [id, revision] of Object.entries(record.sourceRevisions)) if (this.generation.entity(record.projectId, id).revision !== revision) fail('fingerprint-mismatch')
    for (const id of record.inputAssetVersionIds) this.generation.version(record.projectId, id)
    if (record.promptPackageId) {
      const prompt = this.generation.get('prompt_packages', record.projectId, record.promptPackageId)
      if (prompt.targetObjectId !== target.id || prompt.targetCapability !== record.generationType) fail('fingerprint-mismatch')
    }
  }
  assertApprovalCurrent(record: ProvenanceRecord, itemId: string, checkBudget = true): { approval: Approval; item: ApprovalItem } {
    if (!record.approvalId) fail('approval-required')
    const approval = this.getApproval(record.projectId, record.approvalId)
    if (approval.status !== 'active') fail('approval-invalid')
    if (approval.expiresAt <= this.now()) fail('approval-expired')
    if (!approval.itemIds.includes(itemId)) fail('item-not-authorized')
    const items = approval.itemIds.map(id => this.repository.get('approval_items', record.projectId, id))
    if (approval.scope === 'single' ? items[0].requestFingerprint !== approval.requestFingerprint : approvalFingerprint(items) !== approval.batchFingerprint) fail('fingerprint-mismatch')
    const item = items.find(i => i.id === itemId)!
    if (item.status !== 'authorized' || item.approvalId !== approval.id || item.targetObjectId !== record.targetObjectId || item.targetObjectType !== record.targetObjectType) fail('item-not-authorized')
    if (item.requestFingerprint !== record.requestFingerprint || item.promptPackageId !== record.promptPackageId || canonical(item.sourceRevisions) !== canonical(record.sourceRevisions) || canonical(item.inputAssetVersionIds) !== canonical(record.inputAssetVersionIds)) fail('fingerprint-mismatch')
    if (item.routingDecisionId !== record.routingDecisionId || item.toolId !== record.toolId || item.toolVersion !== record.toolVersion || item.modelId !== record.modelId) fail('routing-mismatch')
    if (item.estimateId !== record.estimateId) fail('approval-invalid')
    if (item.currency !== approval.currency) fail('currency-mismatch')
    this.checkPreflight(record, approval.currency, item.estimatedMaxCostMicro, item.allowUnknownCost)
    if (checkBudget) {
      const amount = BigInt(item.estimatedMaxCostMicro)
      if (this.repository.used(record.projectId, approval.id) + amount > BigInt(approval.maxAuthorizedCostMicro) || this.repository.used(record.projectId, approval.id, item.id) + amount > BigInt(item.estimatedMaxCostMicro)) fail('budget-exceeded')
    }
    return { approval, item }
  }
  /** Runtime entry: rechecks the actual Broker token/registry before the atomic local preparation. */
  prepareAfterPreflight(broker: ToolBroker, request: BrokerRequest, preflight: PreflightResult, task: AITask, record: ProvenanceRecord, itemId: string) {
    broker.assertCurrent(request, preflight)
    if (request.projectId !== record.projectId || request.requestId !== task.id || preflight.routingDecision?.id !== record.routingDecisionId || preflight.estimate?.id !== record.estimateId || preflight.requestFingerprint !== record.requestFingerprint || canonical(request.snapshot) !== canonical(record.parameters)) fail('fingerprint-mismatch')
    return this.prepare(task, record, itemId)
  }
  /** The synchronous transaction contains no network work. Final adapter health/validate is supplied by the caller before this boundary. */
  prepare(task: AITask, raw: ProvenanceRecord, itemId: string): { record: ProvenanceRecord; reservation: Reservation; status: 'ready-for-submit' } {
    return this.repository.atomic(() => {
      const record = persistedRecordSchema.parse(raw)
      if (record.actualCost !== null || record.costStatus === 'known' || !['queued','running'].includes(task.status)) fail('approval-invalid')
      const { approval, item } = this.assertApprovalCurrent(record, itemId)
      const reservation = this.repository.insert('approval_reservations', { id: randomUUID(), projectId: record.projectId, approvalId: approval.id, approvalItemId: item.id, generationRecordId: record.id, taskId: record.taskId, reservedAmountMicro: item.estimatedMaxCostMicro, currency: approval.currency, status: 'reserved', createdAt: this.now(), actualAmountMicro: null, submissionIntentAt: null, releasedAt: null, consumedAt: null, evidence: null, historicalStatus: null })
      const created = new GenerationService(this.generation).createAttempt(task, record)
      return { record: created, reservation, status: 'ready-for-submit' }
    })
  }
  markSubmissionIntent(p: string, id: string): Reservation {
    return this.repository.atomic(() => {
      const r = this.repository.get('approval_reservations', p, id)
      if (r.status !== 'reserved') fail('reservation-conflict')
      this.assertApprovalCurrent(this.generation.getRecord(p, r.generationRecordId), r.approvalItemId, false)
      return this.repository.update('approval_reservations', { ...r, status: 'submitted', submissionIntentAt: this.now() })
    })
  }
  markUnknownSubmission(p: string, id: string): Reservation {
    return this.repository.atomic(() => {
      const r = this.repository.get('approval_reservations', p, id)
      if (!['submitted','pending-unknown'].includes(r.status)) fail('reservation-conflict')
      const next = this.repository.update('approval_reservations', { ...r, status: 'pending-unknown' })
      new GenerationService(this.generation).failAttempt(p, r.generationRecordId, 'unknown-submission')
      return next
    })
  }
  /** Reuses the legacy video receipt shape and AITask.providerTaskId. No second remote-job store. */
  reconcileSubmissionReceipt(p: string, id: string, raw: unknown): Reservation {
    return this.repository.atomic(() => {
      const receipt = z.strictObject({ state: z.enum(['submitting','submitted']), id: z.string().min(1).max(1000).nullable() }).safeParse(raw)
      if (!receipt.success) fail('reservation-conflict')
      const r = this.repository.get('approval_reservations', p, id)
      if (!['submitted','pending-unknown'].includes(r.status)) fail('reservation-conflict')
      if (receipt.data.id === null) return this.markUnknownSubmission(p, id)
      if (receipt.data.state !== 'submitted') fail('reservation-conflict')
      const task = this.generation.task(p, r.taskId)
      if (task.providerTaskId !== null && task.providerTaskId !== receipt.data.id) fail('reservation-conflict')
      const next = aiTaskSchema.parse({ ...task, providerTaskId: receipt.data.id, updatedAt: this.now() })
      this.repository.database.connection.prepare('UPDATE ai_tasks SET data=? WHERE project_id=? AND id=?').run(JSON.stringify(next), p, task.id)
      // Remote acceptance is not billing evidence: retain the existing hold.
      return r
    })
  }
  release(p: string, id: string, reason: 'cancelled-before-submit' | 'local-validation-failed' | 'remote-no-charge', evidence?: string): Reservation {
    return this.repository.atomic(() => {
      const r = this.repository.get('approval_reservations', p, id)
      if (reason === 'remote-no-charge' ? !['submitted','pending-unknown'].includes(r.status) || !evidence?.trim() : r.status !== 'reserved') fail('reservation-conflict')
      if (!['cancelled-before-submit','local-validation-failed','remote-no-charge'].includes(reason)) fail('reservation-conflict')
      return this.repository.update('approval_reservations', { ...r, status: reason === 'cancelled-before-submit' ? reason : 'released', releasedAt: this.now(), evidence: evidence || reason })
    })
  }
  consume(p: string, id: string, amountMicro: number, currency: string, evidence: string): { reservation: Reservation; issue: 'cost-overrun' | null } {
    return this.repository.atomic(() => {
      const r = this.repository.get('approval_reservations', p, id)
      if (!['submitted','pending-unknown'].includes(r.status) || !evidence?.trim()) fail('reservation-conflict')
      if (currency !== r.currency) fail('currency-mismatch')
      if (!Number.isSafeInteger(amountMicro) || amountMicro < 0) fail('approval-invalid')
      const overrun = amountMicro > r.reservedAmountMicro
      const reservation = this.repository.update('approval_reservations', { ...r, status: overrun ? 'requires-review' : 'consumed', actualAmountMicro: amountMicro, consumedAt: this.now(), evidence })
      this.generation.supplement(p, r.generationRecordId, { actualCost: { amountMicros: amountMicro, currency } })
      return { reservation, issue: overrun ? 'cost-overrun' : null }
    })
  }
  invalidateApproval(p: string, id: string, reason: string): Approval {
    return this.repository.atomic(() => {
      const a = this.getApproval(p, id)
      if (a.status !== 'active') fail('approval-invalid')
      return this.repository.update('generation_approvals', { ...a, status: 'invalid', invalidatedAt: this.now(), invalidationReason: reason })
    })
  }
}
