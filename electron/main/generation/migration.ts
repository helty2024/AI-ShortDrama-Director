import type { DatabaseSync } from 'node:sqlite'
import { entitySchema, projectSchema } from '../../../src/shared/domain.js'
import { aiTaskSchema } from '../../../src/shared/intelligence.js'
import { assetVersionSchema } from '../../../src/shared/visual.js'

export const PROVENANCE_SCHEMA_VERSION = 7
export function migrateGeneration(db: DatabaseSync) {
  // Validate legacy rows before adding constraints; do not rewrite or backfill them.
  for (const [table, schema] of [['projects', projectSchema], ['entities', entitySchema], ['ai_tasks', aiTaskSchema], ['asset_versions', assetVersionSchema]] as const) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      const value = schema.parse(JSON.parse(String(row.data)))
      if (value.id !== row.id || ('projectId' in value && value.projectId !== row.project_id)) throw new Error('Legacy row identity mismatch')
      if ('kind' in value && value.kind !== row.kind) throw new Error('Legacy entity kind mismatch')
      if ('assetId' in value && (value.assetId !== row.asset_id || value.hash !== row.hash || value.versionNumber !== row.version_number)) throw new Error('Legacy asset identity mismatch')
    }
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Legacy foreign keys are invalid')
  db.exec(`
    CREATE UNIQUE INDEX tasks_scope_id ON ai_tasks(project_id,id);
    CREATE UNIQUE INDEX versions_scope_id ON asset_versions(project_id,id);
  `)
  const base = `id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(project_id,id),
    CHECK(json_extract(data,'$.id') IS id), CHECK(json_extract(data,'$.projectId') IS project_id)`
  const column = (name: string, path: string) => `${name} TEXT GENERATED ALWAYS AS (json_extract(data,'$.${path}')) STORED`
  const ref = (col: string, table: string) => `FOREIGN KEY(project_id,${col}) REFERENCES ${table}(project_id,id) DEFERRABLE INITIALLY DEFERRED`
  // NO ACTION deferred FKs preserve referenced history while allowing whole-project cascades.
  db.exec(`
    CREATE TABLE routing_decisions(${column('tool_id', 'selectedToolId')}, ${base});
    CREATE TABLE generation_estimates(${column('decision_id','routingDecisionId')}, ${base}, ${ref('decision_id','routing_decisions')}, CHECK(decision_id IS NOT NULL));
    CREATE TABLE prompt_packages(${column('target_id','targetObjectId')}, ${base}, ${ref('target_id','entities')}, CHECK(target_id IS NOT NULL));
    CREATE TABLE generation_records(
      ${column('target_id','targetObjectId')}, ${column('task_id','taskId')},
      ${column('decision_id','routingDecisionId')}, ${column('estimate_id','estimateId')},
      ${column('prompt_id','promptPackageId')}, ${column('parent_id','parentGenerationRecordId')},
      ${base}, UNIQUE(task_id), UNIQUE(project_id,id,task_id),
      ${ref('target_id','entities')}, ${ref('task_id','ai_tasks')}, ${ref('decision_id','routing_decisions')},
      ${ref('estimate_id','generation_estimates')}, ${ref('prompt_id','prompt_packages')}, ${ref('parent_id','generation_records')},
      FOREIGN KEY(project_id,id,task_id) REFERENCES task_generation_links(project_id,record_id,task_id) DEFERRABLE INITIALLY DEFERRED,
      CHECK(target_id IS NOT NULL AND task_id IS NOT NULL AND decision_id IS NOT NULL AND estimate_id IS NOT NULL),
      CHECK(json_type(data,'$.outputAssetVersionIds') IS NULL), CHECK(json_extract(data,'$.approvalId') IS NULL)
    );
    CREATE TABLE task_generation_links(${column('record_id','generationRecordId')}, ${column('task_id','taskId')},
      ${base}, UNIQUE(task_id), UNIQUE(record_id), UNIQUE(project_id,record_id,task_id),
      FOREIGN KEY(project_id,record_id,task_id) REFERENCES generation_records(project_id,id,task_id) DEFERRABLE INITIALLY DEFERRED,
      ${ref('task_id','ai_tasks')}, CHECK(record_id IS NOT NULL AND task_id IS NOT NULL));
    CREATE TABLE generation_outputs(${column('record_id','generationRecordId')}, ${column('version_id','assetVersionId')},
      output_index INTEGER GENERATED ALWAYS AS (json_extract(data,'$.outputIndex')) STORED,
      ${base}, ${ref('record_id','generation_records')}, ${ref('version_id','asset_versions')}, UNIQUE(version_id), UNIQUE(record_id,output_index),
      CHECK(record_id IS NOT NULL AND version_id IS NOT NULL AND output_index >= 0));
    CREATE TABLE import_provenance(${column('version_id','outputAssetVersionIds[0]')}, ${base},
      ${ref('version_id','asset_versions')}, UNIQUE(version_id), CHECK(version_id IS NOT NULL));
    CREATE INDEX decisions_project ON routing_decisions(project_id);
    CREATE INDEX estimates_decision ON generation_estimates(project_id,decision_id);
    CREATE INDEX prompts_target ON prompt_packages(project_id,target_id);
    CREATE INDEX records_target ON generation_records(project_id,target_id);
    CREATE INDEX records_parent ON generation_records(parent_id);
    CREATE INDEX outputs_project_record ON generation_outputs(project_id,record_id);
  `)
  for (const table of ['routing_decisions', 'generation_estimates', 'prompt_packages', 'task_generation_links', 'generation_outputs', 'import_provenance']) db.exec(`
    CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable provenance'); END;
  `)
  for (const table of ['routing_decisions', 'generation_estimates', 'prompt_packages', 'generation_records', 'task_generation_links', 'generation_outputs', 'import_provenance']) db.exec(`
    CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table}
    WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
    BEGIN SELECT RAISE(ABORT,'Provenance is retained until project deletion'); END;
  `)
  const mutablePaths = ['updatedAt', 'startedAt', 'completedAt', 'actualDuration', 'actualCost', 'currency', 'costStatus', 'outcome'].map(v => `'$.${v}'`).join(',')
  db.exec(`
    CREATE TRIGGER records_immutable BEFORE UPDATE ON generation_records
    WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR json_remove(NEW.data,${mutablePaths}) IS NOT json_remove(OLD.data,${mutablePaths})
    BEGIN SELECT RAISE(ABORT,'Immutable generation input'); END;
    CREATE TRIGGER outputs_not_import BEFORE INSERT ON generation_outputs
    WHEN EXISTS(SELECT 1 FROM import_provenance WHERE version_id=NEW.version_id)
    BEGIN SELECT RAISE(ABORT,'Imported output is not generated'); END;
    CREATE TRIGGER imports_not_generated BEFORE INSERT ON import_provenance
    WHEN EXISTS(SELECT 1 FROM generation_outputs WHERE version_id=NEW.version_id)
    BEGIN SELECT RAISE(ABORT,'Generated output is not imported'); END;
    CREATE TRIGGER generation_input_scope BEFORE INSERT ON generation_records BEGIN
      SELECT RAISE(ABORT,'Input asset scope mismatch') WHERE EXISTS(
        SELECT 1 FROM json_each(NEW.data,'$.inputAssetVersionIds') j WHERE NOT EXISTS(SELECT 1 FROM asset_versions v WHERE v.project_id=NEW.project_id AND v.id=j.value));
      SELECT RAISE(ABORT,'Source entity scope mismatch') WHERE EXISTS(
        SELECT 1 FROM json_each(NEW.data,'$.sourceRevisions') j WHERE NOT EXISTS(SELECT 1 FROM entities e WHERE e.project_id=NEW.project_id AND e.id=j.key));
    END;
    CREATE TRIGGER version_provenance_retention BEFORE DELETE ON asset_versions
    WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(
      SELECT 1 FROM generation_records g,json_each(g.data,'$.inputAssetVersionIds') j WHERE g.project_id=OLD.project_id AND j.value=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Version retained by provenance'); END;
    CREATE TRIGGER source_provenance_retention BEFORE DELETE ON entities
    WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(
      SELECT 1 FROM generation_records g,json_each(g.data,'$.sourceRevisions') j WHERE g.project_id=OLD.project_id AND j.key=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Source retained by provenance'); END;
    PRAGMA user_version=7;
  `)
}
