import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { ProjectDatabase } from '../../electron/main/database.js'
import { ApprovalRepository } from '../../electron/main/generation/approval-repository.js'
import { GenerationApprovalService } from '../../electron/main/generation/approval.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import { persistedRecordSchema } from '../../src/shared/provenance.js'
const payload = z.object({ database:z.string(), task:aiTaskSchema, record:persistedRecordSchema, itemId:z.uuid() }).parse(JSON.parse(readFileSync(process.argv[2], 'utf8')))
const db=new ProjectDatabase(payload.database), service=new GenerationApprovalService(new ApprovalRepository(db))
process.send!({ready:true,pid:process.pid})
process.once('message', () => {
  let result: {ok:boolean; reason?:string; pid:number}
  try { service.prepare(payload.task,payload.record,payload.itemId); result={ok:true,pid:process.pid} }
  catch(error) { result={ok:false,reason:error instanceof Error ? error.message : 'unknown',pid:process.pid} }
  db.close(); process.send!(result); process.disconnect()
})
