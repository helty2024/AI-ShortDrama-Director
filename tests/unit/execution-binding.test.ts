import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectDatabase } from '../../electron/main/database.js'
import { approvalFixture } from '../fixtures/approval.js'
import { ExecutionBindings } from '../../electron/main/generation/execution-binding.js'
import type { VideoApiTool } from '../../electron/main/tools/adapters/video-api.js'

test('schema10 -> 11 adds an empty binding table, preserves every historical row and blocks guessed recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'execution-binding-migrate-')), path = join(dir, 'project.sqlite')
  let db = new ProjectDatabase(path)
  try {
    const f = await approvalFixture([60], 100, db), approved = f.authorize(), attempt = f.attempts[0]!
    f.approvals.prepare(attempt.task, attempt.record, approved.itemIds[0]!)
    const tables = ['projects', 'entities', 'ai_tasks', 'asset_versions', 'generation_records', 'generation_approvals', 'approval_items', 'approval_reservations']
    const rows = () => tables.map(table => db.connection.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
    const before = rows()
    db.close()
    const raw = new DatabaseSync(path); raw.exec('DROP TABLE execution_bindings; PRAGMA user_version=10'); raw.close()
    db = new ProjectDatabase(path)
    assert.equal(db.connection.prepare('PRAGMA user_version').get()!.user_version, 11)
    assert.deepEqual(rows(), before)
    assert.equal(db.connection.prepare('SELECT count(*) n FROM execution_bindings').get()!.n, 0)
    const bindings = new ExecutionBindings<VideoApiTool>(new (await import('../../electron/main/generation/repository.js')).GenerationRepository(db))
    await assert.rejects(bindings.resolve(attempt.record), /缺少可验证的原执行绑定/)
    assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { db.close(); await rm(dir, { recursive: true, force: true }) }
})

test('binding migration failure rolls back without changing schema10 or historical project content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'execution-binding-rollback-')), path = join(dir, 'project.sqlite')
  try {
    const first = new ProjectDatabase(path), p = first.create({ name: 'Migration rollback', description: '', genre: 'test', language: 'zh-CN', aspectRatio: '9:16' })
    first.close()
    const raw = new DatabaseSync(path)
    raw.exec('DROP TABLE execution_bindings; CREATE TABLE execution_bindings(sentinel TEXT); PRAGMA user_version=10')
    const before = raw.prepare('SELECT data FROM projects WHERE id=?').get(p.id)!.data; raw.close()
    assert.throws(() => new ProjectDatabase(path))
    const after = new DatabaseSync(path)
    assert.equal(after.prepare('PRAGMA user_version').get()!.user_version, 10)
    assert.equal(after.prepare('SELECT data FROM projects WHERE id=?').get(p.id)!.data, before)
    after.close()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
