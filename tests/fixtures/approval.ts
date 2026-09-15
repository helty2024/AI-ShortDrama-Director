import { randomUUID } from 'node:crypto'
import { generationFixture } from './provenance.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { GenerationApprovalService } from '../../electron/main/generation/approval.js'
import { ApprovalRepository } from '../../electron/main/generation/approval-repository.js'
import { requestFingerprint } from '../../electron/main/tools/fingerprint.js'
import { persistedRecordSchema } from '../../src/shared/provenance.js'

export async function approvalFixture(amounts = [60], total = 100, db = new ProjectDatabase(':memory:'), unknown = false) {
  const f = await generationFixture(db)
  const repo = new ApprovalRepository(db), service = new GenerationApprovalService(repo)
  const attempts = amounts.map((amount, index) => {
    const task = { ...f.task, id: randomUUID(), status: 'queued' as const }
    const parameters = { ...f.record.parameters, input: { ...f.record.parameters.input, seed: index + 1 } }
    const fingerprint = requestFingerprint({ fingerprintVersion: '1', snapshot: parameters, toolId: f.record.toolId, toolVersion: f.record.toolVersion, model: f.record.modelId, sourceRevisions: {}, routing: null })
    const estimate = f.repository.create('generation_estimates', { ...f.estimate, id: randomUUID(), requestFingerprint: fingerprint, validUntil: new Date(Date.now()+3600000).toISOString(), cost: unknown ? { status: 'unknown', reason: 'not-quoted' } : { status: 'known', estimatedCost: { amountMicros: amount, currency: 'USD' } } })
    const record = persistedRecordSchema.parse({ ...f.record, id: randomUUID(), taskId: task.id, parameters, seed: index + 1, requestFingerprint: fingerprint, estimateId: estimate.id, estimatedCost: estimate.cost, startedAt: null })
    return { task, record, ceiling: amount }
  })
  function authorize(allowUnknownCost = false) {
    const approval = service.createApproval({ confirmed: true, projectId: f.project.id, scope: amounts.length === 1 ? 'single' : 'batch', currency: 'USD', maxAuthorizedCostMicro: total, expiresAt: new Date(Date.now()+7200000).toISOString(), items: attempts.map(a => ({ record: a.record, estimatedMaxCostMicro: a.ceiling, allowUnknownCost })) })
    attempts.forEach(a => { a.record = { ...a.record, approvalId: approval.id } })
    return approval
  }
  return { ...f, repo, approvals: service, attempts, authorize }
}
