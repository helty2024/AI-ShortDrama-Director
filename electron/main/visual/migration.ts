import type { DatabaseSync } from 'node:sqlite'
import { entitySchema } from '../../../src/shared/domain.js'
import { aiTaskSchema } from '../../../src/shared/intelligence.js'
export function migrateVisual(db: DatabaseSync) {
  db.exec(`CREATE TABLE asset_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, asset_id TEXT NOT NULL, version_number INTEGER NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), FOREIGN KEY(project_id,asset_id) REFERENCES entities(project_id,id) ON DELETE CASCADE, UNIQUE(asset_id,version_number));
 CREATE INDEX asset_versions_hash ON asset_versions(project_id,hash);
 CREATE TABLE visual_settings (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE workflow_templates (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(project_id,id));`)
  for (const row of db.prepare('SELECT id,data FROM entities').all()) {
    const entity = entitySchema.parse(JSON.parse(String(row.data)))
    // Legacy external URIs are not granted media access; originals require explicit import.
    if (entity.kind === 'asset') entity.uri = null
    db.prepare('UPDATE entities SET data=? WHERE id=?').run(
      JSON.stringify(entity),
      String(row.id),
    )
  }
  for (const row of db.prepare('SELECT id,data FROM ai_tasks').all())
    db.prepare('UPDATE ai_tasks SET data=? WHERE id=?').run(
      JSON.stringify(aiTaskSchema.parse(JSON.parse(String(row.data)))),
      String(row.id),
    )
  db.exec('PRAGMA user_version = 3')
}
