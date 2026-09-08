import type { DatabaseSync } from 'node:sqlite'
export function migrateOperations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE validation_records(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE INDEX validation_records_project ON validation_records(project_id);
    CREATE TABLE qc_jobs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE INDEX qc_jobs_project ON qc_jobs(project_id);
    CREATE INDEX tasks_project_status ON ai_tasks(project_id,json_extract(data,'$.status'));
    CREATE INDEX versions_project_created ON asset_versions(project_id,json_extract(data,'$.createdAt'));
    CREATE INDEX qc_project_shot ON qc_reports(project_id,shot_id);
    PRAGMA user_version=6;
  `)
}
