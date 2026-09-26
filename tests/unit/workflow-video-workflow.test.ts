import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workflowFixture } from '../fixtures/workflow.js'
import { workflowSnapshotSchema } from '../../src/shared/workflow.js'

test('video workflow text generation, review and adopt pins confirmed video with full provenance', async () => {
  const f = await workflowFixture(true)
  try {
    const first = await f.create(), waiting = await f.confirm(first.run.id)
    assert.equal(waiting.run.currentStepKey, 'review-video')
    assert.equal(waiting.run.status, 'waiting-user')
    await f.review(first.run.id, 'approve-candidate')
    const complete = await f.review(first.run.id, 'adopt-candidate')
    assert.equal(complete.run.status, 'succeeded')
    const target = f.services.visual.repo.entity(f.project.id, f.target.id)
    assert.ok(target.kind === 'shot' && target.confirmedVideoAssetVersionId === complete.steps[1].relatedAssetVersionId)
    assert.equal(f.videos!.counts.submit, 1)
    const record = f.services.image.generation.getRecord(f.project.id, complete.steps[1].relatedGenerationRecordId!)
    assert.equal(record.actualCost?.amountMicros, 7)
    assert.equal(record.taskId, complete.steps[1].relatedTaskId)
  } finally { await f.close() }
})

test('image-to-video workflow uses explicitly selected approved frame and still waits for video review', async () => {
  const f = await workflowFixture(true)
  try {
    const path = join(f.dir, 'frame.png')
    await writeFile(path, f.imageServer.bytes)
    const stored = await f.services.visual.importFile(f.project.id, path, 'frame', null)
    // Import is a separate human input, no generated image request is made.
    const version = f.services.visual.review(f.project.id, stored.id, stored.revision, 'approved', null, null)
    assert.equal(f.input.workflowType, 'shot-video')
    if (f.input.workflowType !== 'shot-video') throw new Error()
    const created = workflowSnapshotSchema.parse(f.services.workflow.execute({ op: 'createWorkflowRun', input: { ...f.input, generation: {
      ...f.input.generation, mode: 'image-to-video', firstFrameAssetVersionId: version.id,
    } } }))
    await f.settle(created.run.id)
    const waiting = await f.confirm(created.run.id)
    assert.equal(waiting.run.currentStepKey, 'review-video')
    const record = f.services.image.generation.getRecord(f.project.id, waiting.steps[1].relatedGenerationRecordId!)
    assert.deepEqual(record.inputAssetVersionIds, [version.id])
    assert.equal(f.videos!.counts.submit, 1)
    assert.equal(f.imageServer.counts.submit, 0)
  } finally { await f.close() }
})

test('unknown video submission fails workflow while retaining hold and never re-submits', async () => {
  const f = await workflowFixture(true)
  try {
    f.videos!.setMode('unknown-submit')
    const first = await f.create(), failed = await f.confirm(first.run.id)
    assert.equal(failed.run.status, 'failed')
    const result = await f.services.video.query(f.project.id, failed.steps[1].relatedTaskId!)
    assert.equal(result.reservationStatus, 'pending-unknown')
    assert.equal(result.versions.length, 0)
    f.restart().workflow.runner.recoverUnfinished(); await f.settle(first.run.id)
    assert.equal(f.videos!.counts.submit, 1)
  } finally { await f.close() }
})
