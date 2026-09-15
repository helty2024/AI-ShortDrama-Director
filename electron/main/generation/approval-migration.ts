import type { DatabaseSync } from 'node:sqlite'
import { provenanceTables } from '../../../src/shared/provenance.js'

export const APPROVAL_SCHEMA_VERSION = 8
/** Caller disables foreign_keys outside the transaction, then restores it in finally. */
export function migrateApproval(db: DatabaseSync) {
  for (const [table, schema] of Object.entries(provenanceTables)) for (const row of db.prepare(`SELECT id,project_id,data FROM ${table}`).all()) {
    const value = schema.parse(JSON.parse(String(row.data)))
    if (value.id !== row.id || value.projectId !== row.project_id) throw new Error('Invalid provenance identity')
  }
  const base = `id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(project_id,id),
    CHECK(json_extract(data,'$.id') IS id),CHECK(json_extract(data,'$.projectId') IS project_id)`
  const col = (name: string, path: string) => `${name} TEXT GENERATED ALWAYS AS (json_extract(data,'$.${path}')) STORED`
  const ref = (column: string, table: string) => `FOREIGN KEY(project_id,${column}) REFERENCES ${table}(project_id,id) DEFERRABLE INITIALLY DEFERRED`
  db.exec(`
    CREATE TABLE generation_approvals(${base});
    CREATE TABLE approval_items(${col('approval_id','approvalId')},${col('target_id','targetObjectId')},${col('decision_id','routingDecisionId')},${col('estimate_id','estimateId')},${col('prompt_id','promptPackageId')},${base},
      ${ref('approval_id','generation_approvals')},${ref('target_id','entities')},${ref('decision_id','routing_decisions')},${ref('estimate_id','generation_estimates')},${ref('prompt_id','prompt_packages')},
      UNIQUE(project_id,approval_id,id),CHECK(approval_id IS NOT NULL AND target_id IS NOT NULL AND decision_id IS NOT NULL AND estimate_id IS NOT NULL));
    CREATE TABLE approval_reservations(${col('approval_id','approvalId')},${col('item_id','approvalItemId')},${col('record_id','generationRecordId')},${col('task_id','taskId')},${base},
      ${ref('approval_id','generation_approvals')},${ref('record_id','generation_records')},${ref('task_id','ai_tasks')},
      FOREIGN KEY(project_id,approval_id,item_id) REFERENCES approval_items(project_id,approval_id,id) DEFERRABLE INITIALLY DEFERRED,
      UNIQUE(record_id),UNIQUE(task_id),UNIQUE(project_id,record_id,task_id,approval_id),
      CHECK(approval_id IS NOT NULL AND item_id IS NOT NULL AND record_id IS NOT NULL AND task_id IS NOT NULL));
    CREATE INDEX reservations_approval ON approval_reservations(project_id,approval_id);
    CREATE INDEX reservations_item ON approval_reservations(project_id,item_id);
  `)
  const definition = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='generation_records'").get()!.sql)
  const decorations = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='generation_records' AND type IN ('index','trigger') AND sql IS NOT NULL").all()
  const rebuilt = definition.replace('CREATE TABLE generation_records(', (`CREATE TABLE generation_records_v8(${col('approval_id','approvalId')},`))
    .replace("CHECK(json_extract(data,'$.approvalId') IS NULL)", `${ref('approval_id','generation_approvals')}, FOREIGN KEY(project_id,id,task_id,approval_id) REFERENCES approval_reservations(project_id,record_id,task_id,approval_id) DEFERRABLE INITIALLY DEFERRED`)
  db.exec(rebuilt)
  db.exec('INSERT INTO generation_records_v8(id,project_id,data) SELECT id,project_id,data FROM generation_records; DROP TABLE generation_records;')
  db.exec('PRAGMA legacy_alter_table=ON; ALTER TABLE generation_records_v8 RENAME TO generation_records; PRAGMA legacy_alter_table=OFF;')
  for (const row of decorations) db.exec(String(row.sql))
  for (const [table, mutable] of [
    ['generation_approvals', ['status','invalidatedAt','invalidationReason']],
    ['approval_items', []],
    ['approval_reservations', ['status','actualAmountMicro','submissionIntentAt','releasedAt','consumedAt','evidence']],
  ] as const) {
    const expression = (side: string) => mutable.length ? `json_remove(${side}.data,${mutable.map(v => `'$.${v}'`).join(',')})` : `${side}.data`
    db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table}
      WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR ${expression('NEW')} IS NOT ${expression('OLD')}
      BEGIN SELECT RAISE(ABORT,'Immutable approval scope'); END;
      CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
      BEGIN SELECT RAISE(ABORT,'Approval history retained'); END;`)
  }
  db.exec(`CREATE TRIGGER approval_state BEFORE UPDATE ON generation_approvals
    WHEN json_extract(OLD.data,'$.status') != 'active' OR json_extract(NEW.data,'$.status') != 'invalid'
    BEGIN SELECT RAISE(ABORT,'Invalid approval transition'); END;
    CREATE TRIGGER reservation_state BEFORE UPDATE ON approval_reservations WHEN NOT (
      (json_extract(OLD.data,'$.status')='reserved' AND json_extract(NEW.data,'$.status') IN ('submitted','released','cancelled-before-submit')) OR
      (json_extract(OLD.data,'$.status') IN ('submitted','pending-unknown') AND json_extract(NEW.data,'$.status') IN ('pending-unknown','consumed','released','requires-review')))
    BEGIN SELECT RAISE(ABORT,'Invalid reservation transition'); END;
    CREATE TRIGGER approval_membership BEFORE INSERT ON approval_items WHEN NOT EXISTS(
      SELECT 1 FROM generation_approvals a,json_each(a.data,'$.itemIds') j WHERE a.id=NEW.approval_id AND a.project_id=NEW.project_id AND j.value=NEW.id)
    BEGIN SELECT RAISE(ABORT,'Frozen approval membership'); END;`)
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Invalid v8 foreign keys')
  db.exec('PRAGMA user_version=8')
}
