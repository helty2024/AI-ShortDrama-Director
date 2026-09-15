import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { approvalFixture } from '../fixtures/approval.js'
import { mediaBytes } from '../fixtures/provenance.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { backupProject, restoreProject } from '../../electron/main/operations/backup.js'

for(const settled of [false,true]) test(`backup/restore retains ${settled?'consumed':'unknown held'} audit and removes all spending authority`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'approval-backup-')),f=await approvalFixture()
  try {
    const a=f.authorize(),v=f.attempts[0],r=f.approvals.prepare(v.task,v.record,a.itemIds[0])
    f.approvals.markSubmissionIntent(f.project.id,r.reservation.id)
    f.approvals.markUnknownSubmission(f.project.id,r.reservation.id)
    if(settled)f.approvals.consume(f.project.id,r.reservation.id,40,'USD','verified receipt')
    f.db.connection.prepare('UPDATE ai_tasks SET data=? WHERE id=?').run(JSON.stringify({...f.task,status:'succeeded'}),f.task.id)
    const visual=new VisualRepository(new IntelligenceRepository(f.db),new MediaStorage(join(dir,'media')))
    for(const version of f.versions)for(const key of [version.storageKey,version.thumbnailPath]){const path=join(visual.storage.root,key);await mkdir(dirname(path),{recursive:true});await writeFile(path,mediaBytes)}
    const folder=await backupProject(visual,f.project.id,dir)
    assert.equal(JSON.parse(await readFile(join(folder,'manifest.json'),'utf8')).schema,8)
    const restored=await restoreProject(visual,folder),approval=f.approvals.listApprovals(restored.id)[0],reservation=f.approvals.history(restored.id,approval.id)[0]
    assert.equal(approval.status,'historical');assert.notEqual(approval.id,a.id);assert.equal(approval.maxAuthorizedCostMicro,a.maxAuthorizedCostMicro)
    assert.equal(reservation.status,'historical');assert.equal(reservation.historicalStatus,settled?'consumed':'pending-unknown')
    assert.equal(reservation.actualAmountMicro,settled?40:null);assert.equal(reservation.reservedAmountMicro,60)
    assert.equal(f.repo.used(restored.id,approval.id),0n)
    const record=f.repository.getRecord(restored.id,reservation.generationRecordId)
    assert.equal(record.approvalId,approval.id);assert.equal(record.taskId,reservation.taskId)
    for(const field of ['id','projectId','targetObjectId','taskId','estimateId','routingDecisionId','promptPackageId'] as const)assert.notEqual(record[field],r.record[field])
    assert.notEqual(reservation.approvalItemId,a.itemIds[0]);assert.notEqual(reservation.id,r.reservation.id)
    assert.equal(record.actualCost?.amountMicros??null,settled?40:null)
    assert.throws(()=>f.approvals.assertApprovalCurrent(record,reservation.approvalItemId),/approval-invalid/)
    assert.throws(()=>f.approvals.markSubmissionIntent(restored.id,reservation.id),/reservation-conflict/)
    assert.equal(f.repo.used(f.project.id,a.id),settled?40n:60n)
    f.repository.validateProject(restored.id)
    f.db.delete(restored.id);assert.equal(f.db.connection.prepare('PRAGMA foreign_key_check').all().length,0)
  }finally{f.db.close();await rm(dir,{recursive:true,force:true})}
})
