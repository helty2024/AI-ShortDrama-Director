import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generationFixture } from '../fixtures/provenance.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { GenerationRepository } from '../../electron/main/generation/repository.js'

test('unknown submission survives reopening without inventing execution recovery or cost', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-reopen-')), path = join(dir, 'workspace.sqlite')
  try {
    const f = await generationFixture(new ProjectDatabase(path))
    f.service.recordAttempt(f.record)
    f.service.failAttempt(f.project.id, f.record.id, 'unknown-submission')
    const before = f.repository.getRecord(f.project.id, f.record.id)
    f.db.close()
    const db = new ProjectDatabase(path)
    try {
      const repo = new GenerationRepository(db)
      assert.deepEqual(repo.findByTask(f.project.id, f.task.id), before)
      assert.equal(before.actualCost, null)
      assert.equal(before.costStatus, 'unknown')
      assert.equal(before.outputAssetVersionIds.length, 0)
      assert.equal(repo.task(f.project.id, f.task.id).status, 'failed')
    } finally { db.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
