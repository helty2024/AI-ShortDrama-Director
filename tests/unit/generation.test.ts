import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { generationFixture } from '../fixtures/provenance.js'
import { DomainError } from '../../electron/main/database.js'

test('decision, known/unknown estimates and compiler prompt snapshots persist immutably', async () => {
  const f = await generationFixture()
  try {
    assert.deepEqual(f.repository.get('routing_decisions', f.project.id, f.decision.id), f.decision)
    const unknown = f.repository.create('generation_estimates', { ...f.estimate, id: randomUUID(), cost: { status: 'unknown', reason: 'not-quoted' }, estimatedDurationRange: { status: 'unknown' }, billingRisk: 'unknown' })
    assert.equal(unknown.cost.status, 'unknown')
    assert.ok(!('estimatedCost' in unknown.cost))
    for (const [table, id] of [['routing_decisions', f.decision.id], ['generation_estimates', f.estimate.id], ['prompt_packages', f.prompt.id]]) assert.throws(() => f.db.connection.prepare(`UPDATE ${table} SET data=data WHERE id=?`).run(id))
    assert.equal(f.prompt.compilerVersion, 'visual-compiler-v1')
    assert.throws(() => { f.prompt.compilerVersion = 'changed' })
  } finally { f.db.close() }
})

for (const count of [0, 1, 4]) test(`atomic completion with ${count} outputs and task state`, async () => {
  const f = await generationFixture()
  try {
    f.service.recordAttempt(f.record)
    const completed = f.service.completeAttempt(f.project.id, f.record.id, f.outputs.slice(0, count))
    assert.equal(completed.outcome, 'succeeded')
    assert.equal(completed.outputAssetVersionIds.length, count)
    assert.equal(f.repository.task(f.project.id, f.task.id).status, 'succeeded')
    assert.deepEqual(f.repository.findByTask(f.project.id, f.task.id), completed)
    const stored = JSON.parse(String(f.db.connection.prepare('SELECT data FROM generation_records WHERE id=?').get(f.record.id)!.data))
    assert.ok(!('outputAssetVersionIds' in stored))
    assert.equal(f.service.history(f.project.id, f.target.id).length, 1)
  } finally { f.db.close() }
})

test('failed, cancelled and ambiguous attempts remain queryable; retry and regenerate are new tasks', async () => {
  const f = await generationFixture()
  try {
    f.service.recordAttempt(f.record)
    f.service.failAttempt(f.project.id, f.record.id, 'unknown-submission')
    assert.equal(f.repository.getRecord(f.project.id, f.record.id).outcome, 'unknown-submission')
    for (const [attemptType, outcome] of [['retry', 'failed'], ['regenerate', 'cancelled'], ['retry', 'malformed-output']] as const) {
      const task = { ...f.task, id: randomUUID() }
      f.db.connection.prepare('INSERT INTO ai_tasks VALUES (?,?,?)').run(task.id, task.projectId, JSON.stringify(task))
      const record = { ...f.record, id: randomUUID(), taskId: task.id, parentGenerationRecordId: f.record.id, attemptType }
      f.service.recordAttempt(record)
      f.service.failAttempt(f.project.id, record.id, outcome)
    }
    assert.equal(f.service.history(f.project.id, f.target.id).length, 4)
    assert.equal(f.repository.list('generation_outputs', f.project.id).length, 0)
  } finally { f.db.close() }
})

test('record/link uniqueness and missing link commit roll back atomically', async () => {
  const f = await generationFixture()
  try {
    assert.throws(() => f.repository.create('generation_records', f.record))
    assert.equal(f.repository.list('generation_records', f.project.id).length, 0)
    f.service.recordAttempt(f.record)
    assert.throws(() => f.service.recordAttempt({ ...f.record, id: randomUUID() }))
    assert.equal(f.repository.list('generation_records', f.project.id).length, 1)
    assert.equal(f.repository.list('task_generation_links', f.project.id).length, 1)
  } finally { f.db.close() }
})

test('cross-project references rejected by repository and composite database constraints', async () => {
  const f = await generationFixture(), other = await generationFixture(f.db)
  try {
    for (const changed of [{ taskId: other.task.id }, { estimateId: other.estimate.id }, { routingDecisionId: other.decision.id }, { promptPackageId: other.prompt.id }, { inputAssetVersionIds: [other.versions[0].id] }]) assert.throws(() => f.service.recordAttempt({ ...f.record, ...changed }))
    f.service.recordAttempt(f.record)
    assert.throws(() => f.service.completeAttempt(f.project.id, f.record.id, [{ ...f.outputs[0], assetVersionId: other.versions[0].id }]))
    assert.equal(f.repository.getRecord(f.project.id, f.record.id).outcome, 'pending')
    assert.equal(f.repository.task(f.project.id, f.task.id).status, 'running')
    assert.throws(() => f.db.transaction(() => f.db.connection.prepare('INSERT INTO generation_outputs(id,project_id,data) VALUES (?,?,?)').run(f.outputs[0].id, f.project.id, JSON.stringify({ ...f.outputs[0], assetVersionId: other.versions[0].id }))))
  } finally { f.db.close() }
})

test('completion failure rolls back outputs, outcome and final task state', async () => {
  const f = await generationFixture()
  try {
    f.service.recordAttempt(f.record)
    assert.throws(() => f.service.completeAttempt(f.project.id, f.record.id, [f.outputs[0], { ...f.outputs[1], assetVersionId: randomUUID() }]))
    assert.equal(f.repository.outputs(f.project.id, f.record.id).length, 0)
    assert.equal(f.repository.getRecord(f.project.id, f.record.id).outcome, 'pending')
    assert.equal(f.repository.task(f.project.id, f.task.id).status, 'running')
    assert.throws(() => f.db.connection.prepare("UPDATE generation_records SET data=json_set(data,'$.seed',13) WHERE id=?").run(f.record.id))
    assert.throws(() => f.db.connection.prepare('DELETE FROM generation_records WHERE id=?').run(f.record.id))
  } finally { f.db.close() }
})

test('import provenance is separate, mutually exclusive, and stores no absolute path', async () => {
  const f = await generationFixture()
  try {
    const v = f.versions[0]
    v.sourceType = 'imported'
    f.db.connection.prepare('UPDATE asset_versions SET data=? WHERE id=?').run(JSON.stringify(v), v.id)
    const data = { id: randomUUID(), projectId: f.project.id, source: 'file-import', outputAssetVersionIds: [v.id], contentHash: `sha256:${v.hash}`, importedAt: v.createdAt, description: '', originalName: 'image.png', originalMime: v.mimeType, sourceApplication: null }
    f.repository.create('import_provenance', data)
    assert.equal(f.repository.list('generation_records', f.project.id).length, 0)
    assert.throws(() => f.repository.create('import_provenance', { ...data, id: randomUUID(), originalName: 'C:\\private\\image.png' }))
    f.service.recordAttempt(f.record)
    assert.throws(() => f.service.completeAttempt(f.project.id, f.record.id, [f.outputs[0]]))
  } finally { f.db.close() }
})

test('referenced versions cannot be deleted alone; whole project deletion cascades cleanly', async () => {
  const f = await generationFixture()
  try {
    f.service.recordAttempt({ ...f.record, inputAssetVersionIds: [f.versions[4].id] })
    f.service.completeAttempt(f.project.id, f.record.id, [f.outputs[0]])
    for (const id of [f.versions[0].id, f.versions[4].id]) assert.throws(() => f.db.connection.prepare('DELETE FROM asset_versions WHERE id=?').run(id))
    f.db.delete(f.project.id)
    assert.equal(f.db.connection.prepare('SELECT count(*) n FROM generation_records').get()!.n, 0)
    assert.equal(f.db.connection.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { f.db.close() }
})

test('malformed persisted snapshot is rejected with structured error', async () => {
  const f = await generationFixture()
  try {
    // Simulate offline corruption, bypassing the immutable guard deliberately.
    f.db.connection.exec('DROP TRIGGER routing_decisions_immutable')
    f.db.connection.prepare("UPDATE routing_decisions SET data=json_remove(data,'$.selectedToolVersion') WHERE id=?").run(f.decision.id)
    assert.throws(() => f.repository.get('routing_decisions', f.project.id, f.decision.id), (e: unknown) => e instanceof DomainError && e.code === 'INVALID_INPUT')
  } finally { f.db.close() }
})

test('new task plus record and link are one transaction; bad input rolls all three back', async () => {
  const f = await generationFixture()
  try {
    const task = { ...f.task, id: randomUUID() }
    assert.throws(() => f.service.createAttempt(task, { ...f.record, taskId: task.id, estimateId: randomUUID() }))
    assert.equal(f.db.connection.prepare('SELECT id FROM ai_tasks WHERE id=?').get(task.id), undefined)
    f.service.createAttempt(task, { ...f.record, taskId: task.id })
    assert.equal(f.repository.findByTask(f.project.id, task.id)!.id, f.record.id)
  } finally { f.db.close() }
})

test('cost can arrive after completion without changing input, prompt or task state', async () => {
  const f = await generationFixture()
  try {
    f.service.recordAttempt({ ...f.record, startedAt: null })
    f.repository.supplement(f.project.id, f.record.id, { startedAt: f.record.createdAt })
    f.service.completeAttempt(f.project.id, f.record.id, [])
    const result = f.repository.supplement(f.project.id, f.record.id, { actualCost: { amountMicros: 1234, currency: 'USD' } })
    assert.equal(result.costStatus, 'known')
    assert.equal(result.outcome, 'succeeded')
    assert.equal(result.promptPackageId, f.record.promptPackageId)
    assert.throws(() => f.repository.supplement(f.project.id, f.record.id, { actualCost: { amountMicros: 0, currency: 'USD' } }))
    assert.throws(() => f.repository.supplement(f.project.id, f.record.id, { seed: 123 }))
  } finally { f.db.close() }
})
