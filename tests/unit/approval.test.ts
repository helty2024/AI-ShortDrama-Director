import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { approvalFixture } from '../fixtures/approval.js'
import { GenerationApprovalService } from '../../electron/main/generation/approval.js'
import { reservationSchema, approvalSchema } from '../../src/shared/approval.js'

function prepare(f: Awaited<ReturnType<typeof approvalFixture>>) {
  const a = f.authorize(), attempt = f.attempts[0]
  return { approval: a, ...f.approvals.prepare(attempt.task, attempt.record, a.itemIds[0]) }
}
test('single approval is explicit, reserves atomically and binds immutable record/task', async () => {
  const f = await approvalFixture()
  try {
    const a = f.attempts[0]
    assert.throws(() => f.approvals.prepare(a.task, a.record, randomUUID()), /approval-required/)
    const result = prepare(f)
    assert.equal(result.status, 'ready-for-submit'); assert.equal(result.record.approvalId, result.approval.id)
    assert.equal(f.repo.used(f.project.id, result.approval.id), 60n)
    assert.equal(f.repository.findByTask(f.project.id, a.task.id)!.id, a.record.id)
    assert.throws(() => f.db.connection.prepare("UPDATE generation_records SET data=json_set(data,'$.approvalId',?) WHERE id=?").run(randomUUID(), a.record.id), /Immutable|Invalid .* transition/)
  } finally { f.db.close() }
})
for (const [name, patch, reason] of [
  ['fingerprint', { requestFingerprint: 'sha256:'+'0'.repeat(64) }, 'fingerprint-mismatch'],
  ['prompt', { promptPackageId: randomUUID() }, 'fingerprint-mismatch'],
  ['routing', { routingDecisionId: randomUUID() }, 'routing-mismatch'],
  ['tool', { toolId: 'other.tool' }, 'routing-mismatch'],
  ['version', { toolVersion: '9.0.0' }, 'routing-mismatch'],
  ['model', { modelId: 'another-model' }, 'routing-mismatch'],
  ['estimate', { estimateId: randomUUID() }, 'approval-invalid'],
  ['currency', { currency: 'EUR' }, 'currency-mismatch'],
  ['target', { targetObjectId: randomUUID() }, 'item-not-authorized'],
] as const) test(`changed ${name} cannot reuse approval`, async () => {
  const f = await approvalFixture()
  try { const a = f.authorize(); assert.throws(() => f.approvals.assertApprovalCurrent({ ...f.attempts[0].record, ...patch }, a.itemIds[0]), new RegExp(reason)); assert.equal(f.repo.history(f.project.id,a.id).length,0) }
  finally { f.db.close() }
})
test('estimate expires independently before approval, and invalidation never reactivates', async () => {
  const f = await approvalFixture()
  try {
    const a = f.authorize(), record = f.attempts[0].record
    const later = new GenerationApprovalService(f.repo, () => new Date(Date.now()+4000000).toISOString())
    assert.throws(() => later.assertApprovalCurrent(record,a.itemIds[0]), /estimate-expired/)
    const expired = new GenerationApprovalService(f.repo, () => new Date(Date.now()+8000000).toISOString())
    assert.throws(() => expired.assertApprovalCurrent(record,a.itemIds[0]), /approval-expired/)
    f.approvals.invalidateApproval(f.project.id,a.id,'changed intent')
    assert.throws(() => f.approvals.assertApprovalCurrent(record,a.itemIds[0]), /approval-invalid/)
    assert.throws(() => f.repo.update('generation_approvals', a), /Invalid approval transition/)
  } finally { f.db.close() }
})
test('batch membership, scope and item ceilings remain frozen', async () => {
  const f = await approvalFixture([40,60])
  try {
    const a = f.authorize(), item = f.repo.get('approval_items',f.project.id,a.itemIds[0])
    assert.throws(() => f.approvals.assertApprovalCurrent(f.attempts[0].record,randomUUID()),/item-not-authorized/)
    assert.throws(() => f.repo.insert('approval_items',{ ...item,id:randomUUID() }),/Frozen/)
    assert.throws(() => f.repo.update('approval_items',{ ...item,estimatedMaxCostMicro:80 }),/Immutable|Invalid .* transition/)
    assert.throws(() => f.repo.update('generation_approvals',{ ...a,maxAuthorizedCostMicro:200 }),/Immutable|Invalid .* transition/)
    f.attempts.forEach((v,i) => f.approvals.prepare(v.task,v.record,a.itemIds[i]))
    assert.equal(f.repo.used(f.project.id,a.id),100n)
  } finally { f.db.close() }
})
test('unknown estimate is blocked unless explicitly authorized with ceiling', async () => {
  const f = await approvalFixture([60],100,undefined,true)
  try { assert.throws(() => f.authorize(),/unknown-cost-not-authorized/); const a=f.authorize(true); const v=f.attempts[0]; f.approvals.prepare(v.task,v.record,a.itemIds[0]); assert.equal(f.repo.used(f.project.id,a.id),60n) }
  finally { f.db.close() }
})
test('task insertion failure rolls back reservation and generation record', async () => {
  const f = await approvalFixture()
  try {
    const a=f.authorize(), v=f.attempts[0]
    f.db.connection.prepare('INSERT INTO ai_tasks VALUES (?,?,?)').run(v.task.id,f.project.id,JSON.stringify(v.task))
    assert.throws(() => f.approvals.prepare(v.task,v.record,a.itemIds[0]))
    assert.equal(f.repo.used(f.project.id,a.id),0n); assert.equal(f.repo.history(f.project.id,a.id).length,0)
    assert.equal(f.repository.findByTask(f.project.id,v.task.id),null)
  } finally { f.db.close() }
})
test('pre-submit cancellation releases and retry uses a new attempt', async () => {
  const f=await approvalFixture()
  try {
    const r=prepare(f); f.approvals.release(f.project.id,r.reservation.id,'cancelled-before-submit')
    assert.equal(f.repo.used(f.project.id,r.approval.id),0n)
    assert.throws(() => f.approvals.markSubmissionIntent(f.project.id,r.reservation.id),/reservation-conflict/)
    const task={...f.attempts[0].task,id:randomUUID()},record={...r.record,id:randomUUID(),taskId:task.id,parentGenerationRecordId:r.record.id,attemptType:'retry' as const}
    const retry=f.approvals.prepare(task,record,r.approval.itemIds[0]); assert.notEqual(retry.record.id,r.record.id)
    assert.equal(f.repository.history(f.project.id,f.target.id).length,2)
  } finally { f.db.close() }
})
test('unknown submission holds budget; accepted cancellation is not a refund', async () => {
  const f=await approvalFixture()
  try {
    const r=prepare(f); f.approvals.markSubmissionIntent(f.project.id,r.reservation.id); f.approvals.markUnknownSubmission(f.project.id,r.reservation.id)
    assert.equal(f.repo.used(f.project.id,r.approval.id),60n)
    assert.equal(f.repository.getRecord(f.project.id,r.record.id).outcome,'unknown-submission')
    assert.throws(() => f.approvals.release(f.project.id,r.reservation.id,'cancelled-before-submit'),/reservation-conflict/)
    assert.throws(() => f.approvals.release(f.project.id,r.reservation.id,'remote-no-charge'),/reservation-conflict/)
    assert.throws(() => f.approvals.markSubmissionIntent(f.project.id,r.reservation.id),/reservation-conflict/)
    f.approvals.release(f.project.id,r.reservation.id,'remote-no-charge','verified provider billing receipt: not charged')
    assert.equal(f.repo.used(f.project.id,r.approval.id),0n)
  } finally { f.db.close() }
})
for (const amount of [60,40,80,140]) test(`settlement ${amount}: actual cost and ledger commit together`, async () => {
  const f=await approvalFixture()
  try {
    const r=prepare(f); f.approvals.markSubmissionIntent(f.project.id,r.reservation.id)
    assert.throws(() => f.approvals.consume(f.project.id,r.reservation.id,amount,'EUR','receipt'),/currency-mismatch/)
    const result=f.approvals.consume(f.project.id,r.reservation.id,amount,'USD','verified billing receipt')
    assert.equal(result.issue,amount>60?'cost-overrun':null)
    assert.equal(result.reservation.status,amount>60?'requires-review':'consumed')
    assert.equal(f.repo.used(f.project.id,r.approval.id),BigInt(amount))
    const record=f.repository.getRecord(f.project.id,r.record.id)
    assert.equal(record.actualCost!.amountMicros,amount); assert.equal(record.costStatus,'known')
    assert.throws(() => f.approvals.consume(f.project.id,r.reservation.id,amount,'USD','receipt'),/reservation-conflict/)
    f.service.failAttempt(f.project.id,record.id,'failed')
    assert.equal(f.repository.getRecord(f.project.id,record.id).actualCost!.amountMicros,amount)
  } finally { f.db.close() }
})
test('direct record creation or cost update cannot bypass reservation ledger', async () => {
  const f=await approvalFixture()
  try {
    const a=f.authorize(),v=f.attempts[0]
    assert.throws(() => f.service.createAttempt(v.task,v.record),/reservation-conflict/)
    const r=f.approvals.prepare(v.task,v.record,a.itemIds[0])
    assert.throws(() => f.repository.supplement(f.project.id,r.record.id,{actualCost:{amountMicros:1,currency:'USD'}}),/reservation-conflict/)
    assert.throws(() => f.repo.update('approval_reservations',{...r.reservation,reservedAmountMicro:1}),/Immutable|Invalid .* transition/)
  } finally { f.db.close() }
})
test('malformed authorization JSON is rejected at runtime and on read', async () => {
  const f=await approvalFixture()
  try {
    assert.throws(() => f.approvals.createApproval({confirmed:false}),/approval-invalid/)
    const r=prepare(f)
    assert.equal(approvalSchema.safeParse({...r.approval,maxAuthorizedCostMicro:-1}).success,false)
    assert.equal(reservationSchema.safeParse({...r.reservation,actualAmountMicro:0}).success,false)
    f.db.connection.exec('DROP TRIGGER generation_approvals_immutable')
    f.db.connection.prepare("UPDATE generation_approvals SET data=json_set(data,'$.status','invalid','$.maxAuthorizedCostMicro','broken') WHERE id=?").run(r.approval.id)
    assert.throws(() => f.approvals.getApproval(f.project.id,r.approval.id),/approval-invalid/)
  } finally { f.db.close() }
})

test('actual Broker preflight token gates the ready-for-submit preparation', async () => {
  const f=await approvalFixture()
  try {
    const a=f.approvals.createApproval({confirmed:true,projectId:f.project.id,scope:'single',currency:'USD',maxAuthorizedCostMicro:200000,expiresAt:new Date(Date.now()+60000).toISOString(),items:[{record:f.record,estimatedMaxCostMicro:100000}]})
    const record={...f.record,approvalId:a.id}
    f.db.connection.prepare('DELETE FROM ai_tasks WHERE id=?').run(f.task.id)
    assert.throws(()=>f.approvals.prepareAfterPreflight(f.broker,f.request,{...f.preflight},f.task,record,a.itemIds[0]))
    assert.equal(f.repo.history(f.project.id,a.id).length,0)
    const result=f.approvals.prepareAfterPreflight(f.broker,f.request,f.preflight,f.task,record,a.itemIds[0])
    assert.equal(result.status,'ready-for-submit')
  } finally {f.db.close()}
})
test('existing submission receipt bridges remote ID without releasing or resubmitting',async()=>{
  const f=await approvalFixture()
  try {
    const r=prepare(f)
    f.approvals.markSubmissionIntent(f.project.id,r.reservation.id)
    f.approvals.reconcileSubmissionReceipt(f.project.id,r.reservation.id,{state:'submitting',id:null})
    f.approvals.reconcileSubmissionReceipt(f.project.id,r.reservation.id,{state:'submitted',id:'mock-remote-123'})
    assert.equal(f.repository.task(f.project.id,r.record.taskId).providerTaskId,'mock-remote-123')
    assert.equal(f.repo.used(f.project.id,r.approval.id),60n)
    assert.throws(()=>f.approvals.reconcileSubmissionReceipt(f.project.id,r.reservation.id,{state:'submitted',id:'other-remote'}),/reservation-conflict/)
  }finally{f.db.close()}
})
test('settlement transaction rollback never separates actualCost from reservation',async()=>{
  const f=await approvalFixture()
  try {
    const r=prepare(f);f.approvals.markSubmissionIntent(f.project.id,r.reservation.id)
    f.db.connection.exec("CREATE TRIGGER reject_cost BEFORE UPDATE ON generation_records BEGIN SELECT RAISE(ABORT,'injected billing persistence failure'); END")
    assert.throws(()=>f.approvals.consume(f.project.id,r.reservation.id,40,'USD','receipt'))
    assert.equal(f.repo.get('approval_reservations',f.project.id,r.reservation.id).status,'submitted')
    assert.equal(f.repository.getRecord(f.project.id,r.record.id).actualCost,null)
    assert.equal(f.repo.used(f.project.id,r.approval.id),60n)
  }finally{f.db.close()}
})

test('caught nested preparation failure rolls back its savepoint',async()=>{
  const f=await approvalFixture()
  try {
    const a=f.authorize(),v=f.attempts[0]
    f.db.connection.prepare('INSERT INTO ai_tasks VALUES (?,?,?)').run(v.task.id,f.project.id,JSON.stringify(v.task))
    f.db.transaction(()=>{
      assert.throws(()=>f.approvals.prepare(v.task,v.record,a.itemIds[0]))
      assert.equal(f.repo.history(f.project.id,a.id).length,0)
    })
    assert.equal(f.repo.used(f.project.id,a.id),0n)
  }finally{f.db.close()}
})
test('local validation failure releases; invalidated in-flight approval can still settle evidence',async()=>{
  const f=await approvalFixture([40,60])
  try {
    const a=f.authorize(),first=f.attempts[0],second=f.attempts[1]
    const r1=f.approvals.prepare(first.task,first.record,a.itemIds[0])
    f.approvals.release(f.project.id,r1.reservation.id,'local-validation-failed')
    assert.equal(f.repo.used(f.project.id,a.id),0n)
    const r2=f.approvals.prepare(second.task,second.record,a.itemIds[1])
    f.approvals.markSubmissionIntent(f.project.id,r2.reservation.id)
    f.approvals.invalidateApproval(f.project.id,a.id,'user revoked future submissions')
    assert.equal(f.repo.used(f.project.id,a.id),60n)
    f.approvals.consume(f.project.id,r2.reservation.id,50,'USD','receipt after revocation')
    assert.equal(f.repo.used(f.project.id,a.id),50n)
  }finally{f.db.close()}
})
