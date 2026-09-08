import type { DatabaseSync } from 'node:sqlite'
import { entitySchema } from '../../../src/shared/domain.js'
import { assetVersionSchema } from '../../../src/shared/visual.js'
import { aiTaskSchema } from '../../../src/shared/intelligence.js'
export function migrateVideo(db: DatabaseSync) {
  db.exec(
    `CREATE TABLE video_profiles(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(project_id,id));CREATE TABLE production_batches(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)));`,
  )
  for (const row of db.prepare('SELECT id,data FROM entities').all()) {
    const e = entitySchema.parse(JSON.parse(String(row.data)))
    if (e.kind === 'shot') {
      e.direction.action ||= e.plan?.action || e.description
      e.direction.cameraMovement ||= e.plan?.cameraMovement || ''
      e.direction.performance ||= e.plan?.emotion || ''
      e.direction.continuityNotes ||= e.plan?.continuityNotes || ''
    }
    db.prepare('UPDATE entities SET data=? WHERE id=?').run(
      JSON.stringify(e),
      String(row.id),
    )
  }
  for (const row of db.prepare('SELECT id,data FROM asset_versions').all())
    db.prepare('UPDATE asset_versions SET data=? WHERE id=?').run(
      JSON.stringify(assetVersionSchema.parse(JSON.parse(String(row.data)))),
      String(row.id),
    )
  for (const row of db.prepare('SELECT id,data FROM ai_tasks').all())
    db.prepare('UPDATE ai_tasks SET data=? WHERE id=?').run(
      JSON.stringify(aiTaskSchema.parse(JSON.parse(String(row.data)))),
      String(row.id),
    )
  db.exec('PRAGMA user_version=4')
}
