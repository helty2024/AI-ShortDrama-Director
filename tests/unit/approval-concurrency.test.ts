import { ApprovalRepository } from '../../electron/main/generation/approval-repository.js'
import { GenerationApprovalService } from '../../electron/main/generation/approval.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { ProjectDatabase } from '../../electron/main/database.js'
import { approvalFixture } from '../fixtures/approval.js'
const resultSchema=z.object({ok:z.boolean(),reason:z.string().optional(),pid:z.number()})
async function concurrent(files:string[]) {
  const children=files.map(file => fork(new URL('../fixtures/approval-worker.ts',import.meta.url),[file],{execArgv:['--import','tsx'],silent:true}))
  try {
    const results=children.map(child => new Promise<z.infer<typeof resultSchema>>((resolve,reject) => {
      child.on('message',raw => { const parsed=resultSchema.safeParse(raw); if(parsed.success) resolve(parsed.data) })
      child.on('error',reject); child.on('exit',code => {if(code)reject(new Error(`worker exited ${code}`))})
    }))
    await Promise.all(children.map(child => new Promise<void>((resolve,reject) => {
      child.on('message',raw => {if(z.object({ready:z.literal(true)}).safeParse(raw).success)resolve()})
      child.on('error',reject); child.on('exit',code=>reject(new Error(`worker exited before barrier ${code}`)))
    })))
    children.forEach(child=>child.send('go'))
    const output=await Promise.all(results)
    await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise<void>(resolve=>child.once('exit',()=>resolve()))))
    return output
  } finally { for(const child of children) if(child.exitCode===null)child.kill() }
}
for (const amounts of [[60,60],[40,60],[50,50,1]]) test(`real separate-process SQLite reservation race: ${amounts.join('+')} against 100`,{timeout:30000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'approval-race-')),path=join(dir,'db.sqlite'),f=await approvalFixture(amounts,100,new ProjectDatabase(path))
  try {
    const a=f.authorize(),files:string[]=[]
    for(const [i,v] of f.attempts.entries()) {const file=join(dir,`${i}.json`);await writeFile(file,JSON.stringify({database:path,task:v.task,record:v.record,itemId:a.itemIds[i]}));files.push(file)}
    const results=await concurrent(amounts.length===3?files.slice(0,2):files)
    assert.equal(new Set(results.map(r=>r.pid)).size,2)
    assert.equal(results.filter(r=>r.ok).length,amounts[0]===60?1:2)
    if(amounts.length===3) {const last=await concurrent(files.slice(2));assert.equal(last[0].ok,false);assert.equal(last[0].reason,'budget-exceeded')}
    if(amounts[0]===60)assert.equal(results.find(r=>!r.ok)!.reason,'budget-exceeded')
    assert.equal(f.repo.used(f.project.id,a.id),amounts[0]===60?60n:100n)
    assert.equal(f.db.connection.prepare('PRAGMA foreign_key_check').all().length,0)
  } finally {f.db.close();await rm(dir,{recursive:true,force:true})}
})

test('restart retains possible-charge intent and unknown submission hold',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'approval-restart-')),path=join(dir,'db.sqlite')
  const f=await approvalFixture([60],100,new ProjectDatabase(path))
  const a=f.authorize(),v=f.attempts[0],r=f.approvals.prepare(v.task,v.record,a.itemIds[0])
  f.approvals.markSubmissionIntent(f.project.id,r.reservation.id)
  f.approvals.markUnknownSubmission(f.project.id,r.reservation.id)
  f.db.close()
  const reopened=new ProjectDatabase(path),repository=new ApprovalRepository(reopened),service=new GenerationApprovalService(repository)
  try {
    const stored=repository.get('approval_reservations',f.project.id,r.reservation.id)
    assert.equal(stored.status,'pending-unknown');assert.ok(stored.submissionIntentAt)
    assert.equal(repository.used(f.project.id,a.id),60n)
    assert.throws(()=>service.markSubmissionIntent(f.project.id,stored.id),/reservation-conflict/)
    assert.throws(()=>service.release(f.project.id,stored.id,'cancelled-before-submit'),/reservation-conflict/)
  }finally{reopened.close();await rm(dir,{recursive:true,force:true})}
})
