import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createV6, mediaBytes } from '../tests/fixtures/provenance.js'
import { workflowFixture } from '../tests/fixtures/workflow.js'
import { migrateGeneration } from '../electron/main/generation/migration.js'
import { migrateApproval } from '../electron/main/generation/approval-migration.js'
import { backupProject } from '../electron/main/operations/backup.js'

const requested = process.argv[2]
if (!requested)
  throw new Error('Usage: tsx scripts/prepare-rc-fixtures.ts <fixture-root>')

const allowed = resolve(tmpdir(), 'ai-shortdrama-director-release-tests')
const root = resolve(requested)
const scope = relative(allowed, root)
if (!scope || scope.startsWith('..') || isAbsolute(scope))
  throw new Error('RC fixture root must be inside the dedicated temp root')

const hash = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex')

async function writeMedia(
  mediaRoot: string,
  version: { storageKey: string; thumbnailPath: string },
) {
  for (const key of [version.storageKey, version.thumbnailPath]) {
    const path = join(mediaRoot, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, mediaBytes)
  }
}

async function legacyBackup(format: 1 | 2 | 3) {
  const schema = format + 5
  const folder = join(root, 'backups', `format-${format}`)
  await mkdir(folder, { recursive: true })
  const legacy = createV6(join(folder, 'project.sqlite'))
  if (schema >= 7) {
    const database = new DatabaseSync(join(folder, 'project.sqlite'))
    database.exec('BEGIN IMMEDIATE')
    try {
      migrateGeneration(database)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    if (schema >= 8) {
      database.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
      try {
        migrateApproval(database)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }
    database.close()
  }
  await writeMedia(join(folder, 'media'), legacy.version)
  const databaseBytes = await readFile(join(folder, 'project.sqlite'))
  const files = {
    'project.sqlite': hash(databaseBytes),
    [`media/${legacy.version.storageKey}`]: hash(mediaBytes),
    [`media/${legacy.version.thumbnailPath}`]: hash(mediaBytes),
  }
  await writeFile(
    join(folder, 'manifest.json'),
    JSON.stringify({ format, schema, projectId: legacy.project.id, files }),
  )
  return { format, schema, folder, sourceProjectId: legacy.project.id }
}

await mkdir(root, { recursive: true })
const upgradeUserData = join(root, 'upgrade-user-data')
await mkdir(upgradeUserData, { recursive: true })
const upgrade = createV6(join(upgradeUserData, 'workspace.sqlite'))
await writeMedia(join(upgradeUserData, 'media'), upgrade.version)

const backups = [
  await legacyBackup(1),
  await legacyBackup(2),
  await legacyBackup(3),
]

const workflow = await workflowFixture()
try {
  const created = await workflow.create()
  const waitingReview = await workflow.confirm(created.run.id)
  if (waitingReview.run.currentStepKey !== 'review-image')
    throw new Error('Format 4 fixture did not reach review')
  const generated = await backupProject(
    workflow.services.visual,
    workflow.project.id,
    join(root, 'backups'),
  )
  const folder = join(root, 'backups', 'format-4')
  await rename(generated, folder)
  const snapshotPath = join(folder, 'project.sqlite')
  const snapshot = new DatabaseSync(snapshotPath)
  try {
    const row = snapshot.prepare('SELECT id,data FROM projects').get()!
    const data = JSON.parse(String(row.data)) as Record<string, unknown>
    for (const key of ['logline', 'style', 'worldview', 'creativeRequirements']) delete data[key]
    snapshot.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(data), row.id)
    snapshot.exec('PRAGMA user_version=9')
  } finally { snapshot.close() }
  const manifestPath = join(folder, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { format: number; schema: number; files: Record<string, string> }
  manifest.format = 4
  manifest.schema = 9
  manifest.files['project.sqlite'] = hash(await readFile(snapshotPath))
  await writeFile(manifestPath, JSON.stringify(manifest))
  backups.push({
    format: 4,
    schema: 9,
    folder,
    sourceProjectId: workflow.project.id,
  })
} finally {
  await workflow.close()
}

const report = {
  root,
  upgradeUserData,
  upgrade: {
    projectId: upgrade.project.id,
    projectName: upgrade.project.name,
    versionId: upgrade.version.id,
    assetId: upgrade.version.assetId,
    taskId: upgrade.task.id,
    providerTaskId: upgrade.task.providerTaskId,
  },
  backups,
}
await writeFile(join(root, 'fixtures.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
