import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectDatabase } from '../../electron/main/database.js'
import { GenerationRepository } from '../../electron/main/generation/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { NativeProductionGate } from '../../electron/main/generation/native-production.js'
import type { StoredAIService } from '../../electron/main/generation/ai-services.js'
import { generationFixture } from '../fixtures/provenance.js'

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'director-native-gate-')),db=new ProjectDatabase(':memory:')
  const repository=new GenerationRepository(db),visual=new VisualRepository(new IntelligenceRepository(db),new MediaStorage(join(root,'media')))
  const credentials={get:async()=> 'sk-ml-FIXTURE_ONLY',set:async()=>{},has:async()=>true}
  const gate=new NativeProductionGate(root,credentials,repository,visual)
  const image:StoredAIService={id:randomUUID(),kind:'packy-image',name:'Packy',baseUrl:'https://cf.api.fan/v1',model:'gpt-image-2.5-sunburst',credentialRef:randomUUID(),enabled:true,deleted:false,revision:1,connection:'accepted',checkedAt:new Date().toISOString(),structuredValidated:false,reason:'fixture'}
  return {root,db,visual,gate,image,close:async()=>{db.close();await rm(root,{recursive:true,force:true})}}
}
test('Native paid capabilities are closed until explicit capability-specific single trial authorization',async()=>{
  const f=await fixture()
  try{
    assert.equal(await f.gate.available(f.image),false)
    await f.gate.authorize(f.image,'image.generate',0)
    assert.equal(await f.gate.available(f.image,'image.generate'),true)
    assert.equal(await f.gate.available(f.image,'image.referenceGenerate'),false)
    assert.equal(await f.gate.status(f.image),'trial')
    assert.equal(await f.gate.validated(f.image,'image.generate'),false)
    assert.equal(await f.gate.available({...f.image,revision:2}),false)
    assert.equal(await f.gate.available({...f.image,enabled:false}),false)
  }finally{await f.close()}
})
test('H3 first trial needs explicit points authorization and cannot claim verified CDN or production before real output',async()=>{
  const f=await fixture()
  try{
    const video:StoredAIService={...f.image,kind:'compshare-video',model:'MiniMax-H3',baseUrl:'https://cp.compshare.cn'}
    assert.equal(await f.gate.available(video),false)
    await assert.rejects(f.gate.authorize(video,'video.imageToVideo',19),/20 积分/)
    await f.gate.authorize(video,'video.imageToVideo',20)
    assert.equal(await f.gate.status(video),'trial');assert.deepEqual(await f.gate.hosts(video),[])
    assert.equal(await f.gate.validated(video,'video.imageToVideo'),false)
    await assert.rejects(f.gate.authorize(f.image,'video.textToVideo',20),/不匹配/)
    await assert.rejects(f.gate.verifyVideoDownload(f.image,'fixture-task'),/只读鉴权/)
  }finally{await f.close()}
})
test('No approval or bound generation record can consume a native paid grant',async()=>{
  const f=await fixture()
  try{
    await f.gate.authorize(f.image,'image.generate',0)
    const context={projectId:randomUUID(),taskId:randomUUID(),estimateId:randomUUID(),approvalId:null,routingDecisionId:randomUUID(),model:f.image.model,requestFingerprint:'sha256:'+'0'.repeat(64)}
    await assert.rejects(f.gate.consume(f.image,'image.generate',context))
    await assert.rejects(f.gate.consume(f.image,'image.generate',{...context,approvalId:randomUUID()}))
    assert.equal(await f.gate.available(f.image,'image.generate'),true)
  }finally{await f.close()}
})
test('Single native trial is consumed once under concurrency and remains consumed after a simulated crash',async()=>{
  const f=await fixture(), source=await generationFixture(), approvalId=randomUUID()
  class BoundRepository extends GenerationRepository {
    override findByTask(projectId:string,taskId:string) {return {...source.record,projectId,taskId,toolId:'packy.image-25',modelId:f.image.model,approvalId}}
  }
  try{
    const repository=new BoundRepository(f.db)
    const gate=new NativeProductionGate(f.root,{get:async()=> 'sk-ml-FIXTURE_ONLY',set:async()=>{},has:async()=>true},repository,f.visual)
    await gate.authorize(f.image,'image.generate',0)
    const path=join(f.root,f.image.id,'revision-1','state.json'),before=await readFile(path,'utf8')
    const context={projectId:source.project.id,taskId:randomUUID(),estimateId:source.estimate.id,approvalId,routingDecisionId:source.decision.id,model:f.image.model,requestFingerprint:source.record.requestFingerprint}
    const outcomes=await Promise.allSettled([gate.consume(f.image,'image.generate',context),gate.consume(f.image,'image.generate',{...context,taskId:randomUUID()})])
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
    await writeFile(path,before)
    assert.equal(await gate.available(f.image,'image.generate'),false)
    await assert.rejects(gate.consume(f.image,'image.generate',{...context,taskId:randomUUID()}))
  }finally{source.db.close();await f.close()}
})
test('First H3 result host is bound to the owned accepted task; later production cannot admit a new host',async()=>{
  const f=await fixture(),source=await generationFixture(),approvalId=randomUUID(),taskId=randomUUID()
  const video:StoredAIService={...f.image,kind:'compshare-video',model:'MiniMax-H3',baseUrl:'https://cp.compshare.cn'}
  class BoundRepository extends GenerationRepository {
    override findByTask(projectId:string,id:string) {return {...source.record,projectId,taskId:id,toolId:'compshare.minimax-h3',modelId:'MiniMax-H3',generationType:'video.textToVideo' as const,approvalId}}
    override task(projectId:string,id:string) {return {...source.task,projectId,id,providerTaskId:'owned-remote-task'}}
  }
  try{
    const gate=new NativeProductionGate(f.root,{get:async()=> 'sk-ml-FIXTURE_ONLY',set:async()=>{},has:async()=>true},new BoundRepository(f.db),f.visual)
    await gate.authorize(video,'video.textToVideo',20)
    const context={projectId:source.project.id,taskId,estimateId:source.estimate.id,approvalId,routingDecisionId:source.decision.id,model:'MiniMax-H3',requestFingerprint:source.record.requestFingerprint}
    await gate.consume(video,'video.textToVideo',context,4)
    await assert.rejects(gate.taskDownloadHosts(video,'other-task','https://cdn.example.com/output.mp4',context))
    for(const url of ['https://127.0.0.1/a.mp4','http://cdn.example.com/a.mp4','https://user:password@cdn.example.com/a.mp4','https://cdn.example.com:8443/a.mp4'])await assert.rejects(gate.taskDownloadHosts(video,'owned-remote-task',url,context))
    assert.deepEqual(await gate.taskDownloadHosts(video,'owned-remote-task','https://cdn.example.com/a.mp4?signature=FIXTURE_ONLY',context),['cdn.example.com'])
    await gate.noteVerifiedOutput(video,'https://cdn.example.com/a.mp4?signature=FIXTURE_ONLY',context,Buffer.from('isolated verified-ingestion fixture'),4)
    const state=await readFile(join(f.root,video.id,'revision-1','state.json'),'utf8');assert.doesNotMatch(state,/signature|FIXTURE_ONLY/)
    assert.equal(await gate.validated(video,'video.textToVideo'),false)
    const intentPath=join(f.root,video.id,'revision-1',taskId+'.json'),intent=JSON.parse(await readFile(intentPath,'utf8')) as {trial:boolean};intent.trial=false;await writeFile(intentPath,JSON.stringify(intent))
    await assert.rejects(gate.taskDownloadHosts(video,'owned-remote-task','https://different.example.com/a.mp4',context))
    assert.deepEqual(await gate.taskDownloadHosts(video,'owned-remote-task','https://cdn.example.com/a.mp4',context),['cdn.example.com'])
  }finally{source.db.close();await f.close()}
})
