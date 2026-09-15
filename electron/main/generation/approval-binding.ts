import { DomainError } from '../database.js'
import type { ProvenanceRecord } from '../../../src/shared/provenance.js'
import { approvalBindingSchema } from '../../../src/shared/approval.js'
import { ApprovalRepository } from './approval-repository.js'
import type { ProjectDatabase } from '../database.js'

/** Secondary guard for direct provenance repository callers; restore validates historical rows separately. */
export function checkApprovalBinding(database: ProjectDatabase, record: ProvenanceRecord, creating: boolean): void {
  if (!record.approvalId) return
  const repo = new ApprovalRepository(database), p = record.projectId
  const a = repo.get('generation_approvals', p, record.approvalId)
  const reservations = repo.history(p, a.id).filter(r => r.generationRecordId === record.id && r.taskId === record.taskId)
  const r = reservations[0]
  if (reservations.length !== 1 || !r) throw new DomainError('CONFLICT', 'reservation-conflict')
  const item = repo.get('approval_items', p, r.approvalItemId)
  if (item.approvalId !== a.id || !a.itemIds.includes(item.id) || r.currency !== a.currency || r.reservedAmountMicro !== item.estimatedMaxCostMicro || JSON.stringify(approvalBindingSchema.parse(item)) !== JSON.stringify(approvalBindingSchema.parse(record))) throw new DomainError('CONFLICT', 'approval-invalid')
  if (creating) {
    const now = new Date().toISOString()
    if (a.status !== 'active' || r.status !== 'reserved' || item.status !== 'authorized') throw new DomainError('CONFLICT', 'approval-invalid')
    if (a.expiresAt <= now) throw new DomainError('CONFLICT', 'approval-expired')
    const estimate = database.connection.prepare('SELECT data FROM generation_estimates WHERE project_id=? AND id=?').get(p, record.estimateId)
    if (!estimate || String(JSON.parse(String(estimate.data)).validUntil) <= now) throw new DomainError('CONFLICT', 'estimate-expired')
    if (repo.used(p, a.id) > BigInt(a.maxAuthorizedCostMicro) || repo.used(p, a.id, item.id) > BigInt(item.estimatedMaxCostMicro)) throw new DomainError('CONFLICT', 'budget-exceeded')
  }
  if (r.actualAmountMicro !== (record.actualCost?.amountMicros ?? null) || (record.actualCost && record.actualCost.currency !== r.currency)) throw new DomainError('CONFLICT', 'reservation-conflict')
}
