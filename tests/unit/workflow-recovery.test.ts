import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { workflowFixture } from '../fixtures/workflow.js'

test('restart before approval re-preflights but requires fresh confirmation and zero submit', async () => {
  const f = await workflowFixture()
  try {
    const first = await f.create(), oldPreview = first.steps[1].outputSnapshot.preview!.id
    f.restart().workflow.runner.recoverUnfinished()
    const next = await f.settle(first.run.id)
    assert.equal(next.run.status, 'waiting-user')
    assert.notEqual(next.steps[1].outputSnapshot.preview!.id, oldPreview)
    await assert.rejects(f.decide(first.run.id, { action: 'confirm-generation', previewId: oldPreview, maxCostMicro: 0, allowUnknownCost: false }))
    assert.equal(f.imageServer.counts.submit, 0)
  } finally { await f.close() }
})

test('restart at review and then adopt retains decisions and never repeats image generation', async () => {
  const f = await workflowFixture()
  try {
    const first = await f.create(); await f.confirm(first.run.id)
    const task = f.get(first.run.id).steps[1].relatedTaskId
    f.restart().workflow.runner.recoverUnfinished()
    assert.equal((await f.settle(first.run.id)).run.currentStepKey, 'review-image')
    await f.review(first.run.id, 'approve-candidate')
    f.restart().workflow.runner.recoverUnfinished()
    const next = await f.settle(first.run.id)
    assert.equal(next.run.currentStepKey, 'adopt-image')
    assert.equal(next.steps[2].outputSnapshot.decisions[0].action, 'approve-candidate')
    const done = await f.review(first.run.id, 'adopt-candidate')
    assert.equal(done.run.status, 'succeeded')
    assert.equal(done.steps[1].relatedTaskId, task)
    assert.equal(f.imageServer.counts.submit, 1)
  } finally { await f.close() }
})

for (const video of [false, true]) test(`accepted ${video ? 'video' : 'image'} crash snapshot recovers existing remote identity through service without submit`, async () => {
  const f = await workflowFixture(video)
  try {
    if (video) f.videos!.setMode('always-running'); else f.imageServer.setMode('running')
    const first = await f.create()
    const completion = f.confirm(first.run.id)
    let taskId: string | null = null
    for (let i = 0; i < 100; i++) {
      taskId = f.get(first.run.id).steps[1].relatedTaskId
      if (taskId && f.services.image.generation.task(f.project.id, taskId).providerTaskId) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(taskId)
    const taskBefore = f.services.image.generation.task(f.project.id, taskId)
    assert.ok(taskBefore.providerTaskId)
    const crash = join(f.dir, 'crash.sqlite')
    f.db.connection.prepare('VACUUM INTO ?').run(crash)
    if (video) f.videos!.setMode('ok'); else f.imageServer.setMode('ok')
    await completion
    const counts = video ? f.videos!.counts : f.imageServer.counts
    assert.equal(counts.submit, 1)
    // New DB/services load the snapshot captured after acceptance, before any output existed.
    f.restart(crash).workflow.runner.recoverUnfinished()
    const recovered = await f.settle(first.run.id)
    assert.equal(recovered.run.status, 'waiting-user', JSON.stringify(recovered.run.errorSummary))
    assert.equal(recovered.run.currentStepKey, video ? 'review-video' : 'review-image')
    assert.equal(recovered.steps[1].relatedTaskId, taskId)
    assert.ok(recovered.steps[1].relatedAssetVersionId)
    assert.equal(counts.submit, 1)
    assert.equal(f.services.image.generation.task(f.project.id, taskId).providerTaskId, taskBefore.providerTaskId)
  } finally { await f.close() }
})

test('cancel after acceptance keeps task/record and does not fake remote cancellation or release', async () => {
  const f = await workflowFixture()
  try {
    f.imageServer.setMode('running')
    const first = await f.create(), work = f.confirm(first.run.id)
    for (let i = 0; i < 100 && f.imageServer.counts.submit === 0; i++) await new Promise(resolve => setTimeout(resolve, 10))
    f.services.workflow.runner.cancel(f.project.id, first.run.id)
    f.imageServer.setMode('ok'); await work
    const stopped = f.get(first.run.id), result = f.services.image.query(f.project.id, stopped.steps[1].relatedTaskId!)
    assert.equal(stopped.run.status, 'cancelled')
    assert.equal(result.task.status, 'succeeded')
    assert.equal(result.versions[0].status, 'draft')
    assert.equal(result.reservationStatus, 'consumed')
    assert.equal(f.imageServer.counts.submit, 1)
    assert.equal(f.imageServer.counts.cancel, 0)
  } finally { await f.close() }
})
