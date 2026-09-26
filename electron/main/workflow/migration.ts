import type { DatabaseSync } from 'node:sqlite'

export const WORKFLOW_SCHEMA_VERSION = 9
export function migrateWorkflow(db: DatabaseSync) {
  const base = `id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(project_id,id),
    CHECK(json_extract(data,'$.id') IS id), CHECK(json_extract(data,'$.projectId') IS project_id)`
  const col = (name: string, path: string) => `${name} TEXT GENERATED ALWAYS AS (json_extract(data,'$.${path}')) STORED`
  const ref = (name: string, table: string) => `FOREIGN KEY(project_id,${name}) REFERENCES ${table}(project_id,id) DEFERRABLE INITIALLY DEFERRED`
  db.exec(`
    CREATE TABLE workflow_runs(${col('target_id','targetObjectId')}, ${base}, ${ref('target_id','entities')}, CHECK(target_id IS NOT NULL));
    CREATE TABLE step_runs(${col('run_id','workflowRunId')}, ${col('step_key','stepKey')},
      ${col('task_id','relatedTaskId')}, ${col('record_id','relatedGenerationRecordId')},
      ${col('version_id','relatedAssetVersionId')}, ${col('approval_id','relatedApprovalId')}, ${base},
      ${ref('run_id','workflow_runs')}, ${ref('task_id','ai_tasks')}, ${ref('record_id','generation_records')},
      ${ref('version_id','asset_versions')}, ${ref('approval_id','generation_approvals')},
      UNIQUE(project_id,run_id,step_key), CHECK(run_id IS NOT NULL AND step_key IS NOT NULL),
      CHECK((task_id IS NULL) = (record_id IS NULL)));
    CREATE UNIQUE INDEX step_execution_owner ON step_runs(task_id) WHERE step_key IN ('generate-image','generate-video');
    CREATE INDEX workflow_project_status ON workflow_runs(project_id,json_extract(data,'$.status'));
    CREATE INDEX steps_run ON step_runs(project_id,run_id);
    PRAGMA user_version=9;
  `)
}
