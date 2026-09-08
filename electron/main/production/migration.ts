import type { DatabaseSync } from 'node:sqlite'
export function migrateProduction(db: DatabaseSync) {
  db.exec(`CREATE TABLE continuity_snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,target_id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(project_id,target_id),FOREIGN KEY(project_id,target_id) REFERENCES entities(project_id,id) ON DELETE CASCADE);
 CREATE TABLE qc_reports(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,shot_id TEXT NOT NULL,version_id TEXT NOT NULL REFERENCES asset_versions(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)),FOREIGN KEY(project_id,shot_id) REFERENCES entities(project_id,id) ON DELETE CASCADE);
 CREATE TABLE production_preferences(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE production_previews(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE regeneration_plans(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)));
 PRAGMA user_version=5;`)
}
