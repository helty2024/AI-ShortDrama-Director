import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { ProjectDatabase, references } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { entitySchema, projectInputSchema } from '../../src/shared/domain.js'
import { requestSchema } from '../../src/shared/api.js'

const input = {
  name: '测试项目',
  description: '',
  genre: '悬疑',
  aspectRatio: '9:16' as const,
  language: 'zh-CN',
}
test('a newer database version is rejected without rewriting it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'director-future-'))
  const path = join(directory, 'workspace.sqlite')
  try {
    const raw = new DatabaseSync(path)
    raw.exec('PRAGMA user_version = 99')
    raw.close()
    assert.throws(() => new ProjectDatabase(path), /数据库版本高于/)
    const verify = new DatabaseSync(path)
    assert.equal(verify.prepare('PRAGMA user_version').get()?.user_version, 99)
    verify.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
function withDatabase(run: (db: ProjectDatabase) => void) {
  const db = new ProjectDatabase(':memory:')
  try {
    run(db)
  } finally {
    db.close()
  }
}
test('project CRUD validates inputs and detects conflicting updates', () =>
  withDatabase((db) => {
    assert.throws(() => db.create({ ...input, name: '  ' }))
    const project = db.create(input)
    assert.equal(db.get(project.id).name, input.name)
    const renamed = db.update({
      id: project.id,
      expectedRevision: 1,
      changes: { name: '新名称' },
    })
    assert.equal(renamed.revision, 2)
    assert.equal(renamed.createdAt, project.createdAt)
    assert.throws(
      () =>
        db.update({
          id: project.id,
          expectedRevision: 1,
          changes: { name: '过期' },
        }),
      /项目已更新/,
    )
    assert.equal(db.list().length, 1)
    db.delete(project.id)
    assert.throws(() => db.get(project.id), /不存在/)
  }))
test('migrations are repeatable and persistence survives reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'director-unit-'))
  const path = join(directory, 'workspace.sqlite')
  try {
    const first = new ProjectDatabase(path)
    const project = first.create(input)
    first.open(project.id)
    first.close()
    const second = new ProjectDatabase(path)
    assert.equal(second.get(project.id).name, input.name)
    assert.ok(second.list()[0]?.lastOpenedAt)
    second.close()
    const raw = new DatabaseSync(path)
    assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, 5)
    raw.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('seed is idempotent and all shot references resolve', () =>
  withDatabase((db) => {
    const project = db.seed(buildSeed)
    assert.equal(db.seed(buildSeed).id, project.id)
    const { entities } = db.workspace(project.id)
    for (const [kind, count] of [
      ['episode', 1],
      ['scene', 2],
      ['character', 3],
      ['location', 2],
      ['prop', 2],
      ['asset', 2],
      ['shot', 6],
    ] as const)
      assert.equal(entities.filter((e) => e.kind === kind).length, count)
    for (const entity of entities)
      for (const ref of references(entity))
        assert.ok(entities.some((e) => e.id === ref.id && e.kind === ref.kind))
  }))
test('project deletion cascades entities and relation rows but preserves other projects', () => {
  const directory = mkdtempSync(join(tmpdir(), 'director-cascade-'))
  const path = join(directory, 'workspace.sqlite')
  try {
    const db = new ProjectDatabase(path)
    const seeded = db.seed(buildSeed)
    const other = db.create(input)
    db.delete(seeded.id)
    assert.equal(db.list()[0]?.id, other.id)
    db.close()
    const raw = new DatabaseSync(path)
    assert.equal(raw.prepare('SELECT count(*) AS n FROM entities').get()?.n, 0)
    assert.equal(
      raw.prepare('SELECT count(*) AS n FROM entity_refs').get()?.n,
      0,
    )
    raw.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('invalid references and cross-project references roll back an entire batch', () =>
  withDatabase((db) => {
    const seeded = db.seed(buildSeed)
    const project = db.create(input)
    const character = db
      .workspace(seeded.id)
      .entities.find((e) => e.kind === 'character')!
    const data = buildSeed(project.id)
    const shot = data.find((e) => e.kind === 'shot')!
    assert.equal(shot.kind, 'shot')
    if (shot.kind === 'shot') shot.characterIds = [character.id]
    assert.throws(() => db.insertEntities(project.id, data), /关联对象/)
    assert.equal(db.workspace(project.id).entities.length, 0)
  }))
test('failed seed is atomic and does not leave a project', () =>
  withDatabase((db) => {
    assert.throws(() => db.seed(() => [{ invalid: true }]))
    assert.equal(db.list().length, 0)
  }))
test('draft entities enforce parent type and same-episode shot relationships', () =>
  withDatabase((db) => {
    const project = db.seed(buildSeed)
    const workspace = db.workspace(project.id)
    const script = workspace.entities.find((e) => e.kind === 'script')!
    const board = workspace.entities.find((e) => e.kind === 'storyboard')!
    assert.throws(
      () =>
        db.createDraft({
          projectId: project.id,
          kind: 'episode',
          name: '错误',
          parentId: board.id,
        }),
      /关联对象/,
    )
    const episode = db.createDraft({
      projectId: project.id,
      kind: 'episode',
      name: '第二集',
      parentId: script.id,
    })
    const scene = db.createDraft({
      projectId: project.id,
      kind: 'scene',
      name: '第二集场次',
      parentId: episode.id,
    })
    assert.throws(
      () =>
        db.createDraft({
          projectId: project.id,
          kind: 'shot',
          name: '错误镜头',
          parentId: board.id,
          sceneId: scene.id,
        }),
      /同一集/,
    )
    assert.equal(
      db.workspace(project.id).entities.filter((e) => e.kind === 'shot').length,
      6,
    )
  }))
test('schemas reject malformed IDs, unrecognized actions and extra IPC fields', () => {
  assert.equal(
    projectInputSchema.safeParse({ ...input, id: randomUUID() }).success,
    false,
  )
  assert.equal(
    requestSchema.safeParse({ action: 'projects.delete', id: '../../secret' })
      .success,
    false,
  )
  assert.equal(
    requestSchema.safeParse({ action: 'sql', query: 'DROP TABLE projects' })
      .success,
    false,
  )
  assert.equal(
    requestSchema.safeParse({ action: 'projects.list', path: '/other.db' })
      .success,
    false,
  )
  const entity = buildSeed(randomUUID())[0]!
  assert.equal(
    entitySchema.safeParse({ ...entity, createdAt: 'yesterday' }).success,
    false,
  )
})
test('SQL-like project names are stored as ordinary text', () =>
  withDatabase((db) => {
    const name = "'; DROP TABLE projects; --"
    const project = db.create({ ...input, name })
    assert.equal(db.get(project.id).name, name)
    assert.equal(db.list().length, 1)
  }))
