import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createV6 } from '../fixtures/provenance.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { GenerationRepository } from '../../electron/main/generation/repository.js'
import { provenanceTables } from '../../src/shared/provenance.js'

function snapshot(db: DatabaseSync) {
  return Object.fromEntries(['projects', 'entities', 'asset_versions', 'ai_tasks', 'entity_refs'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
test('real v6 upgrades without changing old rows, remote IDs, revisions or confirmed bindings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-migration-')), path = join(dir, 'v6.sqlite')
  try {
    const legacy = createV6(path), raw = new DatabaseSync(path)
    assert.equal(raw.prepare('PRAGMA user_version').get()!.user_version, 6)
    const before = snapshot(raw); raw.close()
    for (let attempt = 0; attempt < 2; attempt++) {
      const db = new ProjectDatabase(path)
      assert.equal(db.connection.prepare('PRAGMA user_version').get()!.user_version, 7)
      assert.deepEqual(snapshot(db.connection), before)
      for (const table of Object.keys(provenanceTables)) assert.equal(db.connection.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0)
      assert.equal(new GenerationRepository(db).findByTask(legacy.project.id, legacy.task.id), null)
      db.close()
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('v7 migration failure rolls back partial DDL and retains v6 contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-failure-')), path = join(dir, 'v6.sqlite')
  try {
    createV6(path)
    const raw = new DatabaseSync(path)
    raw.exec('CREATE TABLE prompt_packages(marker TEXT)')
    const before = snapshot(raw); raw.close()
    assert.throws(() => new ProjectDatabase(path))
    const verify = new DatabaseSync(path)
    assert.equal(verify.prepare('PRAGMA user_version').get()!.user_version, 6)
    assert.deepEqual(snapshot(verify), before)
    assert.equal(verify.prepare("SELECT name FROM sqlite_master WHERE name='routing_decisions'").get(), undefined)
    assert.equal(verify.prepare("SELECT name FROM sqlite_master WHERE name='tasks_scope_id'").get(), undefined)
    verify.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('malformed legacy rows refuse migration without repairing or rewriting the original', () => {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-invalid-')), path = join(dir, 'v6.sqlite')
  try {
    createV6(path)
    const raw = new DatabaseSync(path)
    raw.exec("UPDATE ai_tasks SET data=json_remove(data,'$.input')")
    const before = snapshot(raw); raw.close()
    assert.throws(() => new ProjectDatabase(path))
    const verify = new DatabaseSync(path)
    assert.deepEqual(snapshot(verify), before)
    assert.equal(verify.prepare('PRAGMA user_version').get()!.user_version, 6)
    verify.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('future schema is rejected while preserving the stored version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-future-')), path = join(dir, 'future.sqlite')
  try {
    createV6(path)
    const raw = new DatabaseSync(path); raw.exec('PRAGMA user_version=999'); raw.close()
    assert.throws(() => new ProjectDatabase(path), /数据库版本高于/)
    const verify = new DatabaseSync(path); assert.equal(verify.prepare('PRAGMA user_version').get()!.user_version, 999); verify.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
