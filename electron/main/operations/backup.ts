import { DatabaseSync } from 'node:sqlite'
import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  stat,
  realpath,
  rm,
} from 'node:fs/promises'
import { join, dirname, relative, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { ProjectDatabase, DomainError, references } from '../database.js'
import type { VisualRepository } from '../visual/repository.js'
import { projectSchema, entitySchema } from '../../../src/shared/domain.js'
import {
  aiTaskSchema,
  intelligenceDraftSchema,
  importPreviewSchema,
  productionElementSchema,
} from '../../../src/shared/intelligence.js'
import {
  assetVersionSchema,
  providerSettingsSchema,
  workflowTemplateSchema,
} from '../../../src/shared/visual.js'
import {
  videoProfileSchema,
  batchSchema,
  defaultVideoProfile,
} from '../../../src/shared/video.js'
import {
  continuitySnapshotSchema,
  qcReportSchema,
  productionSettingsSchema,
  batchPreviewSchema,
  regenerationPlanSchema,
} from '../../../src/shared/production.js'
import { jobSchema } from '../../../src/shared/operations.js'
const tables: Record<string, z.ZodType> = {
  projects: projectSchema,
  entities: entitySchema,
  ai_tasks: aiTaskSchema,
  intelligence_drafts: intelligenceDraftSchema,
  import_previews: importPreviewSchema,
  production_elements: productionElementSchema,
  asset_versions: assetVersionSchema,
  visual_settings: providerSettingsSchema,
  workflow_templates: workflowTemplateSchema,
  video_profiles: videoProfileSchema,
  production_batches: batchSchema,
  continuity_snapshots: continuitySnapshotSchema,
  qc_reports: qcReportSchema,
  production_preferences: productionSettingsSchema,
  production_previews: batchPreviewSchema,
  regeneration_plans: regenerationPlanSchema,
  qc_jobs: jobSchema,
}
// Omit transient paid previews and recovery capabilities. Never export the global settings/credential store.
export function publicCopy(value: unknown, field = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => publicCopy(item, field))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /credentialRef/i.test(k)
          ? null
          : /api.?key|authorization|password|secret|access.?token|encrypted/i.test(
                k,
              )
            ? ''
            : publicCopy(v, k),
      ]),
    )
  if (
    /url|endpoint/i.test(field) &&
    typeof value === 'string' &&
    /^https?:\/\//i.test(value)
  ) {
    try {
      const u = new URL(value)
      u.username = ''
      u.password = ''
      u.search = ''
      u.hash = ''
      return u.href
    } catch {
      return ''
    }
  }
  return value
}
async function hashFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function contained(root: string, key: string) {
  const base = await realpath(root),
    actual = await realpath(resolve(base, key)),
    rel = relative(base, actual)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new DomainError('FORBIDDEN', '备份路径越界')
  return actual
}
type Row = Record<string, string | number | null>
function rows(db: DatabaseSync, table: string, projectId: string): Row[] {
  return db
    .prepare(
      `SELECT * FROM ${table} WHERE ${table === 'projects' ? 'id' : 'project_id'}=?`,
    )
    .all(projectId)
    .map((row) => {
      const result: Row = {}
      for (const [key, value] of Object.entries(row)) {
        if (
          typeof value !== 'string' &&
          typeof value !== 'number' &&
          value !== null
        )
          throw new Error('Invalid backup row')
        result[key] = value
      }
      return result
    })
}
function insert(db: DatabaseSync, table: string, row: Row) {
  const columns = Object.keys(row)
  // Columns come only from the freshly created target schema, never imported SQL.
  const allowed = new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => String(r.name)),
  )
  if (columns.some((c) => !allowed.has(c))) throw new Error('Invalid column')
  db.prepare(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  ).run(...Object.values(row))
}
const manifestSchema = z.strictObject({
  format: z.literal(1),
  projectId: z.uuid(),
  schema: z.literal(6),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
})
export async function backupProject(
  visual: VisualRepository,
  p: string,
  parent: string,
) {
  const db = visual.repo.database
  db.get(p)
  if (
    db.connection
      .prepare(
        "SELECT id FROM ai_tasks WHERE project_id=? AND json_extract(data,'$.status') IN ('queued','running') UNION ALL SELECT id FROM qc_jobs WHERE project_id=? AND json_extract(data,'$.status') IN ('queued','running') LIMIT 1",
      )
      .get(p, p)
  )
    throw new DomainError('CONFLICT', '请等待或取消运行中的任务再备份')
  const captured = Object.fromEntries(
    [...Object.keys(tables), 'entity_refs'].map((table) => [
      table,
      rows(db.connection, table, p),
    ]),
  )
  const versions = visual.versions(p)
  const folder = join(parent, `director-backup-${randomUUID()}`)
  await mkdir(folder)
  const snapshot = new ProjectDatabase(join(folder, 'project.sqlite'))
  try {
    snapshot.transaction(() => {
      snapshot.connection.exec('PRAGMA defer_foreign_keys=ON')
      for (const [table, schema] of Object.entries(tables))
        for (const row of captured[table]!) {
          row.data = JSON.stringify(
            schema.parse(publicCopy(JSON.parse(String(row.data)))),
          )
          insert(snapshot.connection, table, row)
        }
      snapshot.connection
        .prepare('INSERT OR IGNORE INTO visual_settings VALUES (?,?)')
        .run(p, JSON.stringify(visual.settings(p)))
      for (const template of visual.templates(p))
        snapshot.connection
          .prepare('INSERT OR IGNORE INTO workflow_templates VALUES (?,?,?)')
          .run(
            p,
            template.id,
            JSON.stringify(workflowTemplateSchema.parse(publicCopy(template))),
          )
      snapshot.connection
        .prepare('INSERT OR IGNORE INTO video_profiles VALUES (?,?,?)')
        .run(p, defaultVideoProfile.id, JSON.stringify(defaultVideoProfile))
      for (const row of captured.entity_refs!)
        insert(snapshot.connection, 'entity_refs', row)
    })
  } finally {
    snapshot.close()
  }
  const files: Record<string, string> = {
    'project.sqlite': await hashFile(join(folder, 'project.sqlite')),
  }
  for (const v of versions)
    for (const key of [v.storageKey, v.thumbnailPath]) {
      if (files[`media/${key}`]) continue
      const source = await visual.storage.resolveRegisteredFile(key),
        target = join(folder, 'media', key)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target)
      files[`media/${key}`] = await hashFile(target)
    }
  await writeFile(
    join(folder, 'manifest.json'),
    JSON.stringify({ format: 1, projectId: p, schema: 6, files }, null, 2),
    { flag: 'wx' },
  )
  return folder
}
export async function restoreProject(visual: VisualRepository, folder: string) {
  const manifestPath = await contained(folder, 'manifest.json')
  if ((await stat(manifestPath)).size > 4 * 1024 * 1024)
    throw new Error('Manifest too large')
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  )
  if (!manifest.files['project.sqlite']) throw new Error('Missing database')
  for (const [key, hash] of Object.entries(manifest.files)) {
    if (
      key !== 'project.sqlite' &&
      !/^media\/[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+(?:-thumb)?\.(png|jpg|webp|mp4)$/.test(
        key,
      )
    )
      throw new Error('Invalid file')
    const path = await contained(folder, key)
    if (
      (await stat(path)).size > 256 * 1024 * 1024 ||
      (await hashFile(path)) !== hash
    )
      throw new Error('Backup integrity check failed')
  }
  const source = new DatabaseSync(await contained(folder, 'project.sqlite'), {
    readOnly: true,
    allowExtension: false,
  })
  const data: Record<string, Row[]> = {}
  try {
    if (Number(source.prepare('PRAGMA user_version').get()?.user_version) !== 6)
      throw new Error('Unsupported backup schema')
    if (source.prepare('SELECT id FROM projects').all().length !== 1)
      throw new Error('One project required')
    for (const table of [...Object.keys(tables), 'entity_refs']) {
      if (
        source.prepare('SELECT type FROM sqlite_master WHERE name=?').get(table)
          ?.type !== 'table'
      )
        throw new Error('Invalid table')
      data[table] = rows(source, table, manifest.projectId)
      if (
        source.prepare(`SELECT count(*) count FROM ${table}`).get()?.count !==
        data[table].length
      )
        throw new Error('Cross-project backup rows')
      for (const row of data[table])
        if (tables[table]) {
          const value = z
            .record(z.string(), z.unknown())
            .parse(tables[table].parse(JSON.parse(String(row.data))))
          if ('id' in value && value.id !== row.id)
            throw new Error('Row identity mismatch')
          if ('projectId' in value && value.projectId !== manifest.projectId)
            throw new Error('Project scope mismatch')
          if (table === 'entities' && value.kind !== row.kind)
            throw new Error('Entity kind mismatch')
          if (
            table === 'asset_versions' &&
            (value.assetId !== row.asset_id ||
              value.hash !== row.hash ||
              value.versionNumber !== row.version_number)
          )
            throw new Error('Version identity mismatch')
        }
    }
    if (source.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Broken references')
  } finally {
    source.close()
  }
  const ids = new Map<string, string>([[manifest.projectId, randomUUID()]])
  const uuidPattern =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
  for (const list of Object.values(data))
    for (const row of list)
      if (typeof row.id === 'string' && !ids.has(row.id))
        ids.set(row.id, randomUUID())
  for (const key of Object.keys(manifest.files))
    for (const id of key.match(uuidPattern) ?? [])
      if (!ids.has(id)) ids.set(id, randomUUID())
  const remap = (text: string) =>
    text.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      (id) => ids.get(id) ?? id,
    )
  const projectId = ids.get(manifest.projectId)!
  const targetRoot = resolve(visual.storage.root, projectId)
  if (relative(visual.storage.root, targetRoot) !== projectId)
    throw new Error('Invalid target')
  await mkdir(targetRoot, { recursive: true })
  try {
    for (const row of data.asset_versions ?? []) {
      const v = assetVersionSchema.parse(JSON.parse(String(row.data)))
      for (const key of [v.storageKey, v.thumbnailPath]) {
        if (
          !key.startsWith(manifest.projectId + '/') ||
          !manifest.files['media/' + key]
        )
          throw new Error('Missing media')
        if (key === v.storageKey && manifest.files['media/' + key] !== v.hash)
          throw new Error('Asset hash mismatch')
        const target = join(visual.storage.root, remap(key))
        await mkdir(dirname(target), { recursive: true })
        await copyFile(await contained(folder, 'media/' + key), target)
      }
    }
    visual.repo.database.transaction(() => {
      const db = visual.repo.database.connection
      db.exec('PRAGMA defer_foreign_keys=ON')
      for (const [table, list] of Object.entries(data))
        for (const original of list) {
          const row: Row = {}
          for (const [key, value] of Object.entries(original))
            row[key] = typeof value === 'string' ? remap(value) : value
          if (tables[table]) {
            let parsed = publicCopy(JSON.parse(String(row.data)))
            if (table === 'ai_tasks') {
              const task = aiTaskSchema.parse(parsed)
              if (['queued', 'running'].includes(task.status)) {
                task.status = 'failed'
                task.error = {
                  code: 'PROVIDER',
                  message:
                    '从备份恢复的任务不会自动提交，请重新绑定凭据并审核后重试',
                }
              }
              // A restored project has no authority to poll or resubmit the original remote job.
              task.providerTaskId = null
              parsed = task
            }
            if (table === 'projects') {
              const p = projectSchema.parse(parsed)
              p.name = (p.name + '（恢复）').slice(0, 120)
              parsed = p
            }
            row.data = JSON.stringify(tables[table].parse(parsed))
          }
          insert(db, table, row)
        }
      const entities = visual.repo.database.workspace(projectId).entities
      for (const e of entities)
        for (const r of references(e))
          if (
            !entities.some(
              (target) => target.id === r.id && target.kind === r.kind,
            )
          )
            throw new Error('Invalid restored relationship')
    })
    return visual.repo.database.get(projectId)
  } catch (error) {
    await rm(targetRoot, { recursive: true, force: true })
    throw error
  }
}
