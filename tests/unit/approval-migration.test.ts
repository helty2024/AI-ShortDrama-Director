import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createV6, generationFixture } from '../fixtures/provenance.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { migrateGeneration } from '../../electron/main/generation/migration.js'
import { provenanceTables } from '../../src/shared/provenance.js'
import { GenerationRepository } from '../../electron/main/generation/repository.js'

function v7(path:string) {const legacy=createV6(path),raw=new DatabaseSync(path);raw.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');migrateGeneration(raw);raw.exec('COMMIT');raw.close();return legacy}
for(const version of [6,7]) test(`published v${version} upgrades to v8 preserving legacy tasks and media`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'approval-migrate-')),path=join(dir,'db.sqlite')
  try {
    const old=version===6?createV6(path):v7(path), db=new ProjectDatabase(path)
    try {
      assert.equal(db.connection.prepare('PRAGMA user_version').get()!.user_version,8)
      assert.equal(db.connection.prepare('PRAGMA foreign_keys').get()!.foreign_keys,1)
      assert.equal(new GenerationRepository(db).task(old.project.id,old.task.id).providerTaskId,'legacy-remote-123')
      assert.equal(db.connection.prepare('SELECT count(*) n FROM generation_approvals').get()!.n,0)
      assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length,0)
    } finally {db.close()}
  } finally {await rm(dir,{recursive:true,force:true})}
})
test('v7 provenance record rebuild retains snapshots, outputs, immutability and project cascade',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'approval-record-migrate-')),path=join(dir,'db.sqlite'),f=await generationFixture()
  try {
    f.service.recordAttempt(f.record);f.service.completeAttempt(f.project.id,f.record.id,f.outputs)
    v7(path)
    const raw=new DatabaseSync(path)
    raw.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON')
    for(const table of ['projects','entities','ai_tasks','asset_versions',...Object.keys(provenanceTables)]) {
      const columns=table in provenanceTables?'id,project_id,data':'*'
      const rows=f.db.connection.prepare(`SELECT ${columns} FROM ${table}`).all()
      for(const row of rows) {const keys=Object.keys(row);raw.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(row))}
    }
    raw.exec('COMMIT');raw.close()
    const db=new ProjectDatabase(path),repo=new GenerationRepository(db)
    try {
      assert.deepEqual(repo.getRecord(f.project.id,f.record.id),f.repository.getRecord(f.project.id,f.record.id))
      repo.validateProject(f.project.id)
      assert.throws(()=>db.connection.prepare("UPDATE generation_records SET data=json_set(data,'$.approvalId',?) WHERE id=?").run(f.project.id,f.record.id),/Immutable/)
      db.delete(f.project.id);assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length,0)
    } finally {db.close()}
  } finally {f.db.close();await rm(dir,{recursive:true,force:true})}
})
test('v8 migration failure rolls back DDL and leaves a real v7 database',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'approval-rollback-')),path=join(dir,'db.sqlite')
  try {
    v7(path);const raw=new DatabaseSync(path)
    raw.exec('CREATE TABLE approval_items(collision TEXT)');raw.close()
    assert.throws(()=>new ProjectDatabase(path))
    const check=new DatabaseSync(path)
    try {assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,7);assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name='generation_approvals'").get(),undefined);assert.match(String(check.prepare("SELECT sql FROM sqlite_master WHERE name='generation_records'").get()!.sql),/approvalId'\) IS NULL/)}finally{check.close()}
  }finally{await rm(dir,{recursive:true,force:true})}
})
