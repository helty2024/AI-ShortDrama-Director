import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createV6 } from '../fixtures/provenance.js'
import { migrateGeneration } from '../../electron/main/generation/migration.js'
import { migrateApproval } from '../../electron/main/generation/approval-migration.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { workflowFixture } from '../fixtures/workflow.js'
import { backupProject, restoreProject } from '../../electron/main/operations/backup.js'

function v8(path: string) {
  const old = createV6(path), db = new DatabaseSync(path)
  db.exec('BEGIN'); migrateGeneration(db); db.exec('COMMIT; PRAGMA foreign_keys=OFF; BEGIN')
  migrateApproval(db); db.exec('COMMIT; PRAGMA foreign_keys=ON')
  return { old, db }
}
const content = (db: DatabaseSync) => Object.fromEntries(['projects','entities','ai_tasks','asset_versions','generation_records','approval_reservations'].map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]))
test('published v8 -> v9 preserves old projects, tasks, media and is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-v9-')), path = join(dir, 'db.sqlite')
  try {
    const source = v8(path), before = content(source.db)
    assert.equal(source.db.prepare('PRAGMA user_version').get()!.user_version, 8)
    source.db.close()
    for (let i = 0; i < 2; i++) {
      const db = new ProjectDatabase(path)
      try {
        assert.equal(db.connection.prepare('PRAGMA user_version').get()!.user_version, 9)
        assert.deepEqual(content(db.connection), before)
        assert.equal(db.connection.prepare('SELECT count(*) n FROM workflow_runs').get()!.n, 0)
        assert.equal(db.connection.prepare('SELECT count(*) n FROM step_runs').get()!.n, 0)
        assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length, 0)
      } finally { db.close() }
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('v9 migration failure rolls back all new tables and preserves schema 8', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-v9-fail-')), path = join(dir, 'db.sqlite')
  try {
    const source = v8(path), before = content(source.db)
    source.db.exec('CREATE TABLE step_runs(marker TEXT)'); source.db.close()
    assert.throws(() => new ProjectDatabase(path))
    const db = new DatabaseSync(path)
    try {
      assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 8)
      assert.deepEqual(content(db), before)
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='workflow_runs'").get(), undefined)
    } finally { db.close() }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

for (const complete of [false, true]) test(`v9 backup remaps ${complete ? 'completed' : 'waiting'} workflow links and disables all execution`, async () => {
  const f = await workflowFixture()
  try {
    const first = await f.create(); await f.confirm(first.run.id)
    if (complete) { await f.review(first.run.id, 'approve-candidate'); await f.review(first.run.id, 'adopt-candidate') }
    const folder = await backupProject(f.services.visual, f.project.id, f.dir)
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'))
    assert.equal(manifest.format, 4); assert.equal(manifest.schema, 9)
    const restored = await restoreProject(f.services.visual, folder)
    const [run] = f.services.workflow.repository.list(restored.id)
    assert.equal(run.executionAllowed, false)
    assert.notEqual(run.id, first.run.id)
    assert.notEqual(run.targetObjectId, f.target.id)
    const next = f.services.workflow.repository.get(restored.id, run.id)
    const original = f.get(first.run.id)
    for (const key of ['relatedTaskId','relatedGenerationRecordId','relatedAssetVersionId','relatedApprovalId'] as const)
      assert.notEqual(next.steps[1][key], original.steps[1][key])
    f.services.workflow.runner.resume(restored.id, run.id); await f.services.workflow.runner.wait(run.id)
    assert.equal(f.imageServer.counts.submit, 1)
    assert.equal(f.db.connection.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { await f.close() }
})

test('workflow project cascade removes its steps while preserving unrelated project', async () => {
  const f = await workflowFixture()
  try {
    await f.create()
    const second = f.db.create({ name: 'keep', description: '', genre: 'test', language: 'en', aspectRatio: '1:1' })
    f.db.connection.prepare('DELETE FROM projects WHERE id=?').run(f.project.id)
    assert.equal(f.db.connection.prepare('SELECT count(*) n FROM workflow_runs').get()!.n, 0)
    assert.equal(f.db.connection.prepare('SELECT count(*) n FROM step_runs').get()!.n, 0)
    assert.equal(f.db.get(second.id).name, 'keep')
  } finally { await f.close() }
})
