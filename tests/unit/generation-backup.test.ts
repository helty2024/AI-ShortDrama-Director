import { migrateGeneration } from '../../electron/main/generation/migration.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { generationFixture, createV6, mediaBytes } from '../fixtures/provenance.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { GenerationRepository } from '../../electron/main/generation/repository.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { backupProject, restoreProject, publicCopy } from '../../electron/main/operations/backup.js'

const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
async function media(root: string, versions: { storageKey: string; thumbnailPath: string }[]) {
  for (const version of versions) for (const key of [version.storageKey, version.thumbnailPath]) { const path = join(root, key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, mediaBytes) }
}

test('v7 backup restores all provenance identities, multiple outputs and separate import history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'provenance-backup-')), f = await generationFixture()
  const visual = new VisualRepository(new IntelligenceRepository(f.db), new MediaStorage(join(dir, 'media')))
  try {
    f.service.recordAttempt(f.record)
    f.service.completeAttempt(f.project.id, f.record.id, f.outputs)
    const v = f.versions[4]
    f.repository.create('import_provenance', { id: randomUUID(), projectId: f.project.id, source: 'file-import', outputAssetVersionIds: [v.id], contentHash: `sha256:${v.hash}`, importedAt: v.createdAt, description: 'import', originalName: 'image.png', originalMime: v.mimeType, sourceApplication: null })
    await media(visual.storage.root, f.versions)
    const folder = await backupProject(visual, f.project.id, dir)
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'))
    assert.equal(manifest.format, 3); assert.equal(manifest.schema, 8)
    const restored = await restoreProject(visual, folder)
    assert.notEqual(restored.id, f.project.id)
    const records = f.repository.list('generation_records', restored.id)
    assert.equal(records.length, 1)
    const record = f.repository.getRecord(restored.id, records[0].id)
    for (const key of ['id', 'projectId', 'taskId', 'targetObjectId', 'routingDecisionId', 'estimateId', 'promptPackageId'] as const) assert.notEqual(record[key], f.record[key])
    assert.equal(record.outputAssetVersionIds.length, 4)
    assert.ok(record.outputAssetVersionIds.every(id => !f.versions.some(v => v.id === id)))
    assert.equal(f.repository.findByTask(restored.id, record.taskId)!.id, record.id)
    assert.equal(f.repository.get('generation_estimates', restored.id, record.estimateId).routingDecisionId, record.routingDecisionId)
    assert.equal(f.repository.get('prompt_packages', restored.id, record.promptPackageId!).targetObjectId, record.targetObjectId)
    assert.ok(record.targetObjectId in record.sourceRevisions)
    assert.equal(record.approvalId, null)
    assert.equal(f.repository.list('import_provenance', restored.id).length, 1)
    f.repository.validateProject(restored.id)
    assert.equal(f.db.connection.prepare('PRAGMA foreign_key_check').all().length, 0)
    assert.deepEqual(publicCopy({ approvalId: randomUUID(), credentialRef: 'secret' }), { approvalId: null, credentialRef: null })
  } finally { f.db.close(); await rm(dir, { recursive: true, force: true }) }
})

for (const schema of [6, 7]) test(`old v${schema} backup restores into v8 without inventing provenance`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'old-provenance-backup-')), folder = join(dir, 'old'), db = new ProjectDatabase(':memory:')
  try {
    await mkdir(folder)
    const legacy = createV6(join(folder, 'project.sqlite'))
    if (schema === 7) { const raw = new DatabaseSync(join(folder, 'project.sqlite')); raw.exec('BEGIN IMMEDIATE'); migrateGeneration(raw); raw.exec('COMMIT'); raw.close() }
    await media(join(folder, 'media'), [legacy.version])
    const files: Record<string, string> = { 'project.sqlite': hash(await readFile(join(folder, 'project.sqlite'))) }
    for (const key of [legacy.version.storageKey, legacy.version.thumbnailPath]) files[`media/${key}`] = hash(mediaBytes)
    await writeFile(join(folder, 'manifest.json'), JSON.stringify({ format: schema === 6 ? 1 : 2, schema, projectId: legacy.project.id, files }))
    const visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(dir, 'restored-media')))
    const project = await restoreProject(visual, folder), repo = new GenerationRepository(db)
    assert.equal(repo.list('generation_records', project.id).length, 0)
    assert.equal(repo.list('import_provenance', project.id).length, 0)
    assert.equal(visual.versions(project.id).length, 1)
    const task = visual.repo.list(project.id, 'ai_tasks', (await import('../../src/shared/intelligence.js')).aiTaskSchema)[0]
    assert.equal(task.providerTaskId, null)
    assert.equal(repo.findByTask(project.id, task.id), null)
  } finally { db.close(); await rm(dir, { recursive: true, force: true }) }
})

test('tampered provenance restores neither partial rows nor staged media', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bad-provenance-backup-')), f = await generationFixture()
  const visual = new VisualRepository(new IntelligenceRepository(f.db), new MediaStorage(join(dir, 'media')))
  try {
    f.service.recordAttempt(f.record); f.service.completeAttempt(f.project.id, f.record.id, f.outputs)
    await media(visual.storage.root, f.versions)
    const folder = await backupProject(visual, f.project.id, dir), path = join(folder, 'project.sqlite')
    const raw = new DatabaseSync(path)
    raw.exec("DROP TRIGGER routing_decisions_immutable; UPDATE routing_decisions SET data=json_set(data,'$.selectedToolVersion','2.0.0')")
    raw.close()
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'))
    manifest.files['project.sqlite'] = hash(await readFile(path))
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest))
    const before = f.db.list().length
    await assert.rejects(restoreProject(visual, folder))
    assert.equal(f.db.list().length, before)
    assert.deepEqual(await readdir(visual.storage.root), [f.project.id])
  } finally { f.db.close(); await rm(dir, { recursive: true, force: true }) }
})
