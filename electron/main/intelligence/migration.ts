import type { DatabaseSync } from 'node:sqlite'
import { entitySchema } from '../../../src/shared/domain.js'

// Migration 2 is appended after the immutable Phase 1 migration.
export function migrateIntelligence(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE ai_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE INDEX ai_tasks_project ON ai_tasks(project_id);
    CREATE TABLE intelligence_drafts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, scene_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), FOREIGN KEY(project_id, scene_id) REFERENCES entities(project_id, id) ON DELETE CASCADE);
    CREATE INDEX intelligence_drafts_project_scene ON intelligence_drafts(project_id, scene_id);
    CREATE TABLE import_previews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE production_elements (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
  `)
  const update = db.prepare('UPDATE entities SET data = ? WHERE id = ?')
  for (const row of db.prepare('SELECT id, data FROM entities').all()) {
    const entity = entitySchema.parse(JSON.parse(String(row.data)))
    if (entity.kind === 'scene') {
      entity.content.heading ||= entity.name
      entity.content.sceneNumber ||= String(entity.order + 1)
      entity.content.action ||= entity.description
    }
    update.run(JSON.stringify(entity), String(row.id))
  }
  db.exec('PRAGMA user_version = 2')
}
