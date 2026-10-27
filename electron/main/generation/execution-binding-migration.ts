import type { DatabaseSync } from 'node:sqlite'

export const EXECUTION_SCHEMA_VERSION = 11
export function migrateExecutionBinding(db: DatabaseSync) {
  // Additive only. Never attribute an old task to today's default configuration.
  db.exec(`
    CREATE TABLE execution_bindings (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      record_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.generationRecordId')) STORED,
      task_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.taskId')) STORED,
      data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(project_id,record_id), UNIQUE(project_id,task_id),
      CHECK(json_extract(data,'$.id') IS id), CHECK(json_extract(data,'$.projectId') IS project_id),
      FOREIGN KEY(project_id,record_id,task_id) REFERENCES generation_records(project_id,id,task_id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TRIGGER execution_bindings_immutable BEFORE UPDATE ON execution_bindings
      BEGIN SELECT RAISE(ABORT,'Immutable execution binding'); END;
    CREATE TRIGGER execution_bindings_retain BEFORE DELETE ON execution_bindings
      WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
      BEGIN SELECT RAISE(ABORT,'Execution binding retained until project deletion'); END;
    PRAGMA user_version=11;
  `)
}
