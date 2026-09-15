import { z } from 'zod'
import { DomainError, type ProjectDatabase } from '../database.js'
import { approvalTables, type ApprovalTable, type Reservation } from '../../../src/shared/approval.js'
import { immutable } from '../tools/registry.js'

let savepointSequence = 0
type Row<T extends ApprovalTable> = z.infer<(typeof approvalTables)[T]>
export class ApprovalRepository {
  readonly database: ProjectDatabase
  constructor(database: ProjectDatabase) { this.database = database }
  atomic<T>(action: () => T): T {
    try {
      if (!this.database.connection.isTransaction) return this.database.transaction(action)
      const savepoint = `approval_${++savepointSequence}`
      this.database.connection.exec(`SAVEPOINT ${savepoint}`)
      try {
        const result = action()
        this.database.connection.exec(`RELEASE ${savepoint}`)
        return result
      } catch (error) {
        this.database.connection.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
        throw error
      }
    }
    catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('CONFLICT', 'reservation-conflict') }
  }
  parse<T extends ApprovalTable>(table: T, raw: unknown): Row<T> {
    const parsed = (approvalTables[table] as unknown as z.ZodType<Row<T>>).safeParse(raw)
    if (!parsed.success) throw new DomainError('INVALID_INPUT', 'approval-invalid')
    return parsed.data
  }
  get<T extends ApprovalTable>(table: T, projectId: string, id: string): Row<T> {
    const row = this.database.connection.prepare(`SELECT data FROM ${table} WHERE project_id=? AND id=?`).get(projectId, id)
    if (!row) throw new DomainError('NOT_FOUND', table === 'generation_approvals' ? 'approval-required' : 'item-not-authorized')
    let raw: unknown
    try { raw = JSON.parse(String(row.data)) } catch { throw new DomainError('INVALID_INPUT', 'approval-invalid') }
    const value = this.parse(table, raw)
    if (value.id !== id || value.projectId !== projectId) throw new DomainError('INVALID_INPUT', 'approval-invalid')
    return immutable(value)
  }
  list<T extends ApprovalTable>(table: T, projectId: string): Row<T>[] {
    this.database.get(projectId)
    return this.database.connection.prepare(`SELECT id FROM ${table} WHERE project_id=? ORDER BY rowid`).all(projectId).map(r => this.get(table, projectId, String(r.id)))
  }
  insert<T extends ApprovalTable>(table: T, raw: unknown): Row<T> {
    const value = this.parse(table, raw)
    this.database.connection.prepare(`INSERT INTO ${table}(id,project_id,data) VALUES (?,?,?)`).run(value.id, value.projectId, JSON.stringify(value))
    return immutable(value)
  }
  update<T extends ApprovalTable>(table: T, raw: unknown): Row<T> {
    const value = this.parse(table, raw)
    const result = this.database.connection.prepare(`UPDATE ${table} SET data=? WHERE project_id=? AND id=?`).run(JSON.stringify(value), value.projectId, value.id)
    if (result.changes !== 1) throw new DomainError('CONFLICT', 'reservation-conflict')
    return immutable(value)
  }
  history(projectId: string, approvalId: string): Reservation[] {
    return this.list('approval_reservations', projectId).filter(r => r.approvalId === approvalId)
  }
  used(projectId: string, approvalId: string, itemId?: string): bigint {
    return this.history(projectId, approvalId).filter(r => !itemId || r.approvalItemId === itemId).reduce((sum, r) => {
      const amount = ['reserved', 'submitted', 'pending-unknown'].includes(r.status) ? r.reservedAmountMicro : ['consumed', 'requires-review'].includes(r.status) ? r.actualAmountMicro! : 0
      return sum + BigInt(amount)
    }, 0n)
  }
}
