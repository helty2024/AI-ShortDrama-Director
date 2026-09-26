import { imageServer } from '../fixtures/image-http.js'
import { ImageApiAdapter } from '../../electron/main/tools/adapters/image-api.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { workflowFixture } from '../fixtures/workflow.js'
import { workflowCommandSchema, workflowInputSchema } from '../../src/shared/workflow.js'

test('workflow create/list/query preserves ordered definitions and stops before generation approval', async () => {
  const f = await workflowFixture()
  try {
    const result = await f.create()
    assert.equal(result.run.status, 'waiting-user')
    assert.equal(result.run.currentStepKey, 'generate-image')
    assert.deepEqual(result.steps.map(s => s.stepType), ['prepare', 'generate-image', 'review-image', 'adopt-image', 'complete'])
    assert.equal(result.steps[0].status, 'succeeded')
    assert.equal(f.imageServer.counts.submit, 0)
    assert.equal(f.services.workflow.repository.list(f.project.id).length, 1)
    assert.deepEqual(f.services.workflow.execute({ op: 'getWorkflowRun', projectId: f.project.id, runId: result.run.id }), result)
  } finally { await f.close() }
})

test('workflow rejects non-Shot, cross-project, arbitrary steps and state-setting IPC', async () => {
  const f = await workflowFixture()
  try {
    assert.throws(() => f.services.workflow.repository.create(workflowInputSchema.parse({ ...f.input, generation: { ...f.input.generation, targetId: f.db.workspace(f.project.id).entities.find(e => e.kind === 'character')!.id } })))
    const { run } = await f.create()
    assert.throws(() => f.get(randomUUID()))
    const other = f.db.create({ name: 'Other', description: '', genre: 'test', language: 'en', aspectRatio: '1:1' })
    assert.throws(() => f.services.workflow.repository.get(other.id, run.id))
    assert.equal(workflowCommandSchema.safeParse({ op: 'resumeWorkflowRun', projectId: f.project.id, runId: run.id, status: 'succeeded' }).success, false)
  } finally { await f.close() }
})

test('image workflow requires separate approve and adopt; records linkage and updates exact Shot pin', async () => {
  const f = await workflowFixture()
  try {
    const { run } = await f.create(), generated = await f.confirm(run.id)
    assert.equal(generated.run.status, 'waiting-user')
    assert.equal(generated.run.currentStepKey, 'review-image')
    const step = generated.steps[1]
    assert.ok(step.relatedTaskId && step.relatedGenerationRecordId && step.relatedApprovalId && step.relatedAssetVersionId)
    assert.equal(step.attemptCount, 1)
    const targetBefore = f.services.visual.repo.entity(f.project.id, f.target.id)
    assert.ok(targetBefore.kind === 'shot' && targetBefore.approvedKeyframeVersionId === null)
    for (let i = 0; i < 3; i++) { f.services.workflow.runner.resume(f.project.id, run.id); await f.settle(run.id) }
    assert.equal(f.get(run.id).run.currentStepKey, 'review-image')
    assert.equal(f.imageServer.counts.submit, 1)
    const approved = await f.review(run.id, 'approve-candidate')
    assert.equal(approved.run.currentStepKey, 'adopt-image')
    assert.equal(approved.run.status, 'waiting-user')
    const beforeAdopt = f.services.visual.repo.entity(f.project.id, f.target.id)
    assert.ok(beforeAdopt.kind === 'shot' && beforeAdopt.approvedKeyframeVersionId === null)
    const done = await f.review(run.id, 'adopt-candidate')
    assert.equal(done.run.status, 'succeeded')
    assert.ok(done.steps.every(s => s.status === 'succeeded'))
    const target = f.services.visual.repo.entity(f.project.id, f.target.id)
    assert.ok(target.kind === 'shot' && target.approvedKeyframeVersionId === step.relatedAssetVersionId)
    assert.equal(done.steps[2].outputSnapshot.decisions[0].action, 'approve-candidate')
    assert.equal(done.steps[3].outputSnapshot.decisions[0].action, 'adopt-candidate')
    assert.equal(f.imageServer.counts.submit, 1)
  } finally { await f.close() }
})

test('reject candidate persists review decision, rejects version and fails without regeneration', async () => {
  const f = await workflowFixture()
  try {
    const { run } = await f.create(); await f.confirm(run.id)
    const rejected = await f.review(run.id, 'reject-candidate')
    assert.equal(rejected.run.status, 'failed')
    assert.equal(rejected.run.errorSummary?.code, 'stopped-by-user')
    assert.equal(f.services.visual.version(f.project.id, rejected.steps[1].relatedAssetVersionId!).status, 'rejected')
    f.services.workflow.runner.resume(f.project.id, run.id); await f.settle(run.id)
    assert.equal(f.imageServer.counts.submit, 1)
  } finally { await f.close() }
})

for (const when of ['pending', 'approval', 'review'] as const) test(`cancel ${when} stops subsequent workflow steps`, async () => {
  const f = await workflowFixture()
  try {
    const snapshot = when === 'pending' ? f.services.workflow.repository.create(f.input) : await f.create()
    if (when === 'review') await f.confirm(snapshot.run.id)
    f.services.workflow.runner.cancel(f.project.id, snapshot.run.id)
    f.services.workflow.runner.resume(f.project.id, snapshot.run.id); await f.settle(snapshot.run.id)
    const stopped = f.get(snapshot.run.id)
    assert.equal(stopped.run.status, 'cancelled')
    assert.equal(stopped.steps[4].status, 'cancelled')
    assert.equal(f.imageServer.counts.submit, when === 'review' ? 1 : 0)
  } finally { await f.close() }
})

test('duplicate confirmation and stale decisions cannot produce a second task', async () => {
  const f = await workflowFixture()
  try {
    const first = await f.create(), previewId = first.steps[1].outputSnapshot.preview!.id
    const command = { op: 'submitWorkflowUserDecision' as const, projectId: f.project.id, runId: first.run.id, expectedRevision: first.run.revision,
      decision: { action: 'confirm-generation' as const, previewId, maxCostMicro: 0, allowUnknownCost: false } }
    f.services.workflow.execute(command)
    assert.throws(() => f.services.workflow.execute(command))
    await f.settle(first.run.id)
    assert.equal(f.imageServer.counts.submit, 1)
    assert.equal(f.db.connection.prepare('SELECT count(*) n FROM generation_records').get()!.n, 1)
  } finally { await f.close() }
})

test('task linkage failure rolls back approval, reservation, task and record before submit', async () => {
  const f = await workflowFixture()
  try {
    const first = await f.create()
    f.db.connection.exec("CREATE TRIGGER injected_link_failure BEFORE UPDATE ON step_runs WHEN json_extract(NEW.data,'$.relatedTaskId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected'); END")
    await assert.rejects(f.confirm(first.run.id))
    assert.equal(f.imageServer.counts.submit, 0)
    for (const table of ['generation_records', 'approval_reservations', 'generation_approvals', 'ai_tasks'])
      assert.equal(f.db.connection.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0)
    assert.equal(f.get(first.run.id).steps[1].relatedTaskId, null)
  } finally { await f.close() }
})

test('malformed step order and task linkage reject recovery before network execution', async () => {
  const f = await workflowFixture()
  try {
    const first = await f.create()
    f.db.connection.prepare("UPDATE step_runs SET data=json_set(data,'$.status','succeeded') WHERE id=?").run(first.steps[3].id)
    assert.throws(() => f.services.workflow.runner.resume(f.project.id, first.run.id), /损坏/)
    assert.equal(f.imageServer.counts.submit, 0)
  } finally { await f.close() }
})

test('generation failure is localized to generate step and never auto retries', async () => {
  const f = await workflowFixture()
  try {
    f.imageServer.setMode('failed')
    const first = await f.create(); const done = await f.confirm(first.run.id)
    assert.equal(done.run.status, 'failed')
    assert.equal(done.steps[1].status, 'failed')
    assert.equal(done.run.errorSummary?.stepKey, 'generate-image')
    assert.equal(done.steps[1].relatedAssetVersionId, null)
    assert.equal(f.imageServer.counts.submit, 1)
  } finally { await f.close() }
})

test('adoption and decision commit atomically; rollback does not change official Shot binding', async () => {
  const f = await workflowFixture()
  try {
    const first = await f.create(); await f.confirm(first.run.id); await f.review(first.run.id, 'approve-candidate')
    f.db.connection.exec("CREATE TRIGGER injected_adopt_failure BEFORE UPDATE ON step_runs WHEN json_extract(NEW.data,'$.stepKey')='adopt-image' AND json_extract(NEW.data,'$.status')='succeeded' BEGIN SELECT RAISE(ABORT,'injected'); END")
    await assert.rejects(f.review(first.run.id, 'adopt-candidate'))
    const target = f.services.visual.repo.entity(f.project.id, f.target.id)
    assert.ok(target.kind === 'shot' && target.approvedKeyframeVersionId === null)
    assert.equal(f.get(first.run.id).steps[3].outputSnapshot.decisions.length, 0)
    assert.equal(f.get(first.run.id).run.status, 'waiting-user')
  } finally { await f.close() }
})


test('cloud image workflow preview uses the same existing service contract', async () => {
  const f = await workflowFixture(), cloud = await imageServer()
  try {
    f.services.image.register(new ImageApiAdapter(cloud.profile, async () => 'FIXTURE', new ImageHttpTransport({ fixtureOrigin: cloud.origin })))
    const input = workflowInputSchema.parse({ ...f.input, generation: { ...f.input.generation, toolId: cloud.profile.toolId, localOnly: false, allowAssetUpload: true } })
    await f.services.image.preview(input.generation)
    const created = f.services.workflow.repository.create(input)
    f.services.workflow.runner.resume(f.project.id, created.run.id)
    const next = await f.settle(created.run.id)
    assert.equal(next.run.status, 'waiting-user', JSON.stringify(next.run.errorSummary))
  } finally { await f.close(); await cloud.close() }
})

test('malformed skipped step cannot bypass generation or enter an infinite resume loop', async () => {
  const f = await workflowFixture()
  try {
    const first = await f.create()
    f.db.connection.prepare("UPDATE step_runs SET data=json_set(data,'$.status','skipped') WHERE id=?").run(first.steps[1].id)
    assert.throws(() => f.services.workflow.runner.resume(f.project.id, first.run.id), /损坏/)
    assert.equal(f.imageServer.counts.submit, 0)
  } finally { await f.close() }
})
