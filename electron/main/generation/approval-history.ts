import { approvalTables, type ApprovalTable } from '../../../src/shared/approval.js'
import { ApprovalRepository } from './approval-repository.js'
import type { ProjectDatabase } from '../database.js'
import { DomainError } from '../database.js'

/** Copies retain provenance IDs, but carry no transferable spending authority. */
export function approvalHistoryCopy(table: string, original: unknown, sanitized: unknown): unknown {
  if (!original || typeof original !== 'object' || !sanitized || typeof sanitized !== 'object') return sanitized
  const data = { ...sanitized } as Record<string, unknown>
  if ((table === 'generation_records' || table in approvalTables) && 'approvalId' in original) data.approvalId = original.approvalId
  if (table === 'generation_approvals') {
    data.status = 'historical'
    data.invalidatedAt ??= new Date().toISOString()
    data.invalidationReason ??= 'Backup history has no executable authority'
  }
  if (table === 'approval_items') data.status = 'historical'
  if (table === 'approval_reservations') {
    data.historicalStatus ??= data.status
    data.status = 'historical'
  }
  return data
}
export function validateApprovalHistory(database: ProjectDatabase, p: string): void {
  const repo = new ApprovalRepository(database)
  for (const table of Object.keys(approvalTables) as ApprovalTable[]) repo.list(table, p)
  for (const a of repo.list('generation_approvals', p)) {
    const items = repo.list('approval_items', p).filter(i => i.approvalId === a.id)
    if (items.length !== a.itemIds.length || items.some(i => !a.itemIds.includes(i.id) || i.currency !== a.currency)) throw new DomainError('INVALID_INPUT', 'approval-invalid')
  }
}
