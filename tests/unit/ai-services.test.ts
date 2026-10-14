import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AIServiceManager } from '../../electron/main/generation/ai-services.js'
import { ImageHttpTransport, transportFailure, type ImageHttpDiagnostics } from '../../electron/main/tools/adapters/image-http.js'
import { aiServicesSnapshotSchema } from '../../src/shared/ai-services.js'
import { EncryptedCredentialStore } from '../../electron/main/video/credentials.js'
import { MockTextProvider } from '../../electron/main/intelligence/mock-provider.js'
import { requestSchema } from '../../src/shared/api.js'
import { AITaskQueue } from '../../electron/main/intelligence/queue.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { emptyScene } from '../../src/shared/intelligence.js'

class ProtocolTransport extends ImageHttpTransport {
  calls: { url: string; method: string | undefined; body: string | Buffer | undefined }[] = []
  valid = true
  auth = true
  structured: unknown = {ok:true}
  override async bytes(url: string, signal: AbortSignal, options: Parameters<ImageHttpTransport['bytes']>[2]) {
    signal.throwIfAborted(); this.calls.push({url,method:options.method,body:options.body})
    if(!this.auth)throw transportFailure('authentication',false)
    const body=url.endsWith('/models')?{data:[{id:'fixture-model'}]}:{choices:[{message:{content:JSON.stringify(this.valid?this.structured:{wrong:true})}}]}
    const diagnostics:ImageHttpDiagnostics={status:200,contentType:'application/json',contentLength:null,requestId:null,host:'fixture.example',redirectCount:0,redirectHosts:[]}
    return {bytes:Buffer.from(JSON.stringify(body)),mime:'application/json',diagnostics}
  }
}
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'director-ai-catalog-')), path=join(root,'ai-services.json'), transport=new ProtocolTransport()
  const credentials=new EncryptedCredentialStore(join(root,'credentials'),{available:()=>true,encrypt:value=>Buffer.from([...Buffer.from(value)].map(v=>v^0x7a)),decrypt:bytes=>Buffer.from([...bytes].map(v=>v^0x7a)).toString()})
  let locked=false,applied=0
  const host={assertIdle:()=>{if(locked)throw new Error('pending task')},apply:async()=>{applied++},importKey:async()=>null,probe:async()=>({accepted:false,reason:'unverified'})}
  const manager=new AIServiceManager(path,credentials,host,false,transport);await manager.load()
  const input={id:null,kind:'text' as const,name:'测试文本模型',baseUrl:'https://fixture.example/v1',model:'fixture-model'}
  const save=async()=>{await manager.execute({op:'ai.save',service:input,apiKey:'sk-ml-FIXTURE_ONLY'});return (await manager.snapshot()).services[0]!}
  return {root,path,manager,credentials,host,transport,input,save,lock:()=>{locked=true},applied:()=>applied,close:()=>rm(root,{recursive:true,force:true})}
}
test('Production catalog does not fall back to Mock, and encrypted config is project-independent',async()=>{
  const f=await fixture()
  try {
    const provider=f.manager.textProvider(new MockTextProvider())
    assert.equal(provider.name,'text-unconfigured')
    await assert.rejects(provider.generateStructured({system:'test',input:{},schema:z.object({ok:z.boolean()}),schemaName:'test',signal:AbortSignal.timeout(1000)}),/请先连接/)
    const s=await f.save();assert.equal(s.credentialSaved,true);assert.equal(s.generation,'unverified')
    const text=await readFile(f.path,'utf8');assert.doesNotMatch(text,/sk-ml-|FIXTURE_ONLY/)
    await f.manager.execute({op:'ai.default',id:s.id})
    assert.match(provider.name,/^text:/);assert.equal(provider.model,'fixture-model')
    await assert.rejects(provider.generateStructured({system:'test',input:{},schema:z.object({ok:z.boolean()}),schemaName:'test',signal:AbortSignal.timeout(1000)}),/结构化/)
    assert.equal(f.transport.calls.length,0)
    const next=new AIServiceManager(f.path,f.credentials,f.host,false,f.transport);await next.load()
    assert.equal((await next.snapshot()).services[0]?.isDefault,true)
  }finally{await f.close()}
})
test('Readonly models probe never claims structured generation; paid validation uses exact strict protocol',async()=>{
  const f=await fixture()
  try{
    const s=await f.save();await f.manager.execute({op:'ai.default',id:s.id})
    await f.manager.execute({op:'ai.probe',id:s.id})
    assert.equal((await f.manager.snapshot()).services[0]?.connection,'accepted')
    assert.equal((await f.manager.snapshot()).services[0]?.generation,'unverified')
    assert.equal(f.transport.calls.length,1);assert.equal(f.transport.calls[0]?.body,undefined)
    await f.manager.execute({op:'ai.validateText',id:s.id,confirmed:true})
    assert.equal((await f.manager.snapshot()).services[0]?.generation,'validated')
    const body=JSON.parse(String(f.transport.calls[1]?.body)) as {model:string;response_format:{type:string;json_schema:{strict:boolean}};max_completion_tokens:number}
    assert.equal(body.model,'fixture-model');assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.max_completion_tokens,4000)
    const result=await f.manager.textProvider(new MockTextProvider()).generateStructured({system:'test',input:{},schema:z.strictObject({ok:z.literal(true)}),schemaName:'test',signal:AbortSignal.timeout(1000)})
    assert.deepEqual(result,{ok:true})
  }finally{await f.close()}
})
test('Malformed structured output never validates a real service or triggers an automatic retry',async()=>{
  const f=await fixture()
  try{const s=await f.save();await f.manager.execute({op:'ai.probe',id:s.id});f.transport.valid=false;await f.manager.execute({op:'ai.validateText',id:s.id,confirmed:true});assert.equal((await f.manager.snapshot()).services[0]?.generation,'unverified');assert.equal(f.transport.calls.length,2)}finally{await f.close()}
})
test('Key replacement preserves historical references, invalidates verification and affects future requests without restart',async()=>{
  const f=await fixture()
  try{const s=await f.save();await f.manager.execute({op:'ai.default',id:s.id});await f.manager.execute({op:'ai.probe',id:s.id});await f.manager.execute({op:'ai.validateText',id:s.id,confirmed:true});const before=f.manager.textProvider(new MockTextProvider()).name;await f.manager.execute({op:'ai.save',service:{...f.input,id:s.id},apiKey:'sk-ml-FIXTURE_ONLY'});assert.notEqual(f.manager.textProvider(new MockTextProvider()).name,before);const stored=JSON.parse(await readFile(f.path,'utf8')) as {revisions:unknown[]};assert.equal(stored.revisions.length,1);assert.equal((await f.manager.snapshot()).services[0]?.connection,'unchecked');assert.equal((await f.manager.snapshot()).services[0]?.generation,'unverified')}finally{await f.close()}
})
test('Disable and soft delete preserve encrypted credentials, and active tasks block configuration mutations',async()=>{
  const f=await fixture()
  try{const s=await f.save();await f.manager.execute({op:'ai.enable',id:s.id,enabled:false});assert.equal((await f.manager.snapshot()).services[0]?.generation,'blocked');await f.manager.execute({op:'ai.delete',id:s.id,confirmed:true});assert.equal((await f.manager.snapshot()).services.length,0);assert.match(await readFile(f.path,'utf8'),/credentialRef/);f.lock();await assert.rejects(f.manager.execute({op:'ai.save',service:f.input}),/pending/)}finally{await f.close()}
})
test('Cloud config rejects unsafe URLs, unsupported native protocols and unauthorised test commands',async()=>{
  const f=await fixture()
  try{for(const baseUrl of ['http://127.0.0.1','https://user:secret@example.com','https://example.com?q=x','https://example.com:8443'])await assert.rejects(f.manager.execute({op:'ai.save',service:{...f.input,baseUrl}}));await assert.rejects(f.manager.execute({op:'ai.save',service:{...f.input,kind:'compshare-video',baseUrl:'https://different.example',model:'MiniMax-H3'}}));for(const command of [{op:'ai.validateText',id:randomUUID(),confirmed:false},{op:'ai.authorizeTrial',id:randomUUID(),confirmed:true,capability:'video.imageToVideo',maxPoints:20,allowedHosts:['arbitrary.example']}])assert.equal(requestSchema.safeParse({action:'serviceSettings',command}).success,false);assert.equal(aiServicesSnapshotSchema.safeParse({mode:'production',services:[],defaultImageTool:null,apiKey:'secret'}).success,false)}finally{await f.close()}
})
test('Configured production Story parsing calls the structured provider and stores its validated output and model',async()=>{
  const f=await fixture(),db=new ProjectDatabase(':memory:'),repo=new IntelligenceRepository(db)
  let queue:AITaskQueue|undefined
  try{
    const s=await f.save();await f.manager.execute({op:'ai.default',id:s.id});await f.manager.execute({op:'ai.probe',id:s.id});await f.manager.execute({op:'ai.validateText',id:s.id,confirmed:true})
    f.transport.structured={episodes:[{name:'模型输出剧集',scenes:[{...emptyScene,heading:'模型输出场次',action:'协议返回的实际结构化内容'}]}],warnings:[]}
    const p=db.create({name:'结构化流程',description:'',genre:'剧情',language:'zh-CN',aspectRatio:'16:9'})
    queue=new AITaskQueue(repo,f.manager.textProvider(new MockTextProvider()))
    assert.throws(()=>queue!.start(p.id,{type:'parse',name:'故事',rawText:'未授权故事'}),/确认/)
    const task=queue.start(p.id,{type:'parse',name:'故事',rawText:'未含场次标记的原始故事'},true)
    for(let n=0;n<100 && ['queued','running'].includes(repo.task(p.id,task.id).status);n++)await new Promise(r=>setTimeout(r,10))
    assert.equal(repo.task(p.id,task.id).status,'succeeded');assert.equal(repo.task(p.id,task.id).model,'fixture-model')
    const snapshot=repo.snapshot(p.id,queue.provider.name)
    assert.equal(snapshot.imports[0]?.parsed.episodes[0]?.scenes[0]?.heading,'模型输出场次')
    assert.match(String(f.transport.calls.at(-1)?.body),/director_structured_script/)
  }finally{queue?.close();db.close();await f.close()}
})
