import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProjectDatabase } from '../../electron/main/database.js'
import { workflowFixture } from '../fixtures/workflow.js'
import { backupProject, restoreProject } from '../../electron/main/operations/backup.js'

test('schema9 project gains empty Story fields without changing identity, revision or timestamps; migration is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'director-story-v9-'))
  const path = join(dir, 'project.sqlite')
  try {
    const first = new ProjectDatabase(path)
    const project = first.create({ name: '旧故事', description: '旧梗概', genre: '悬疑', aspectRatio: '9:16', language: 'zh-CN' })
    first.close()
    const raw = new DatabaseSync(path)
    const legacy = Object.fromEntries(Object.entries(project).filter(([key]) => !['logline', 'style', 'worldview', 'creativeRequirements'].includes(key)))
    raw.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(legacy), project.id)
    raw.exec('PRAGMA user_version=9')
    raw.close()
    for (let i = 0; i < 2; i++) {
      const db = new ProjectDatabase(path)
      try {
        const actual = db.get(project.id)
        for (const key of ['id', 'name', 'description', 'genre', 'aspectRatio', 'language', 'revision', 'createdAt', 'updatedAt'] as const)
          assert.equal(actual[key], project[key])
        for (const key of ['logline', 'style', 'worldview', 'creativeRequirements'] as const) assert.equal(actual[key], '')
        assert.equal(db.connection.prepare('PRAGMA user_version').get()?.user_version, 10)
      } finally { db.close() }
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Story fields save through project revisions and survive restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'director-story-save-'))
  const path = join(dir, 'project.sqlite')
  try {
    const db = new ProjectDatabase(path)
    const project = db.create({ name: '初始', description: '', genre: '悬疑', aspectRatio: '9:16', language: 'zh-CN' })
    const values = { logline: '雨夜重逢', description: '一封旧信', style: '黑色电影', worldview: '沿海小城', creativeRequirements: '节奏紧凑' }
    const updated = db.update({ id: project.id, expectedRevision: project.revision, changes: values })
    assert.throws(() => db.update({ id: project.id, expectedRevision: project.revision, changes: { logline: '覆盖' } }), /项目已更新/)
    db.close()
    const reopened = new ProjectDatabase(path)
    try {
      assert.equal(reopened.get(project.id).revision, updated.revision)
      for (const [key, value] of Object.entries(values)) assert.equal(reopened.get(project.id)[key as keyof typeof values], value)
    } finally { reopened.close() }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('format5 preserves Story; simulated format4/schema9 restores empty Story and no workflow execution', async () => {
  const f = await workflowFixture()
  try {
    const run = await f.create()
    const story = { logline: '一句话', description: '梗概', style: '现实主义', worldview: '未来都市', creativeRequirements: '每集悬念' }
    f.db.update({ id: f.project.id, expectedRevision: f.project.revision, changes: story })
    const folder = await backupProject(f.services.visual, f.project.id, f.dir)
    const manifestPath = join(folder, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(manifest.format, 5)
    assert.equal(manifest.schema, 10)
    const restored5 = await restoreProject(f.services.visual, folder)
    for (const [key, value] of Object.entries(story)) assert.equal(restored5[key as keyof typeof story], value)
    assert.equal(f.services.workflow.repository.list(restored5.id)[0]?.executionAllowed, false)
    const snapshotPath = join(folder, 'project.sqlite')
    const snapshot = new DatabaseSync(snapshotPath)
    const row = snapshot.prepare('SELECT data FROM projects').get()!
    const old = JSON.parse(String(row.data)) as Record<string, unknown>
    for (const key of ['logline', 'style', 'worldview', 'creativeRequirements']) delete old[key]
    snapshot.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(old), f.project.id)
    snapshot.exec('PRAGMA user_version=9')
    snapshot.close()
    manifest.format = 4
    manifest.schema = 9
    manifest.files['project.sqlite'] = createHash('sha256').update(await readFile(snapshotPath)).digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest))
    const restored4 = await restoreProject(f.services.visual, folder)
    assert.equal(restored4.description, story.description)
    for (const key of ['logline', 'style', 'worldview', 'creativeRequirements'] as const) assert.equal(restored4[key], '')
    assert.equal(f.services.workflow.repository.list(restored4.id)[0]?.executionAllowed, false)
    assert.notEqual(f.services.workflow.repository.list(restored4.id)[0]?.id, run.run.id)
  } finally { await f.close() }
})
