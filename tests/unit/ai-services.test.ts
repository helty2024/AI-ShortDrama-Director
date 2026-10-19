import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AIServiceManager, TEXT_ANALYSIS_MAX_REQUEST_BYTES, TEXT_ANALYSIS_MAX_TOKENS, TEXT_REQUEST_TIMEOUT_MS } from '../../electron/main/generation/ai-services.js'
import { ImageHttpTransport, classifyTransportNetworkError, transportFailure, type ImageHttpDiagnostics, type TransportFailure } from '../../electron/main/tools/adapters/image-http.js'
import { AIError } from '../../electron/main/intelligence/provider.js'
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
  failure: TransportFailure | null = null
  valid = true
  auth = true
  structured: unknown = {ok:true}
  override async bytes(url: string, signal: AbortSignal, options: Parameters<ImageHttpTransport['bytes']>[2]) {
    signal.throwIfAborted(); this.calls.push({url,method:options.method,body:options.body})
    if (this.failure) throw this.failure
    if(!this.auth)throw transportFailure('authentication',false)
    const body=url.endsWith('/models')?{data:[{id:'fixture-model'}]}:{choices:[{message:{content:JSON.stringify(this.valid?this.structured:{wrong:true})}}]}
    const diagnostics:ImageHttpDiagnostics={status:200,contentType:'application/json',contentLength:null,requestId:null,host:'fixture.example',redirectCount:0,redirectHosts:[]}
    return {bytes:Buffer.from(JSON.stringify(body)),mime:'application/json',diagnostics}
  }
}

test('Text diagnostics distinguish sanitized HTTP, timeout, DNS, TLS, interruption and invalid output without retry', async () => {
  assert.equal(classifyTransportNetworkError({ code: 'ENOTFOUND' }), 'dns')
  assert.equal(classifyTransportNetworkError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }), 'tls')
  assert.equal(classifyTransportNetworkError({ code: 'ECONNRESET' }), 'connection-interrupted')
  const f = await fixture()
  try {
    const s = await f.save()
    await f.manager.execute({ op: 'ai.default', id: s.id })
    const provider = f.manager.textProvider(new MockTextProvider(), { validateOnFirstTask: true })
    const request = () => ({ system: 'fixture', input: {}, schema: z.strictObject({ ok: z.literal(true) }), schemaName: 'fixture', signal: AbortSignal.timeout(1000) })
    const cases = [
      { failure: transportFailure('validation', true, { status: 400 } as ImageHttpDiagnostics), kind: 'http-4xx', code: 'PROVIDER', status: 400 },
      { failure: transportFailure('rate-limit', true, { status: 429 } as ImageHttpDiagnostics), kind: 'http-429', code: 'RATE_LIMIT', status: 429 },
      { failure: transportFailure('provider', true, { status: 503 } as ImageHttpDiagnostics), kind: 'http-5xx', code: 'PROVIDER', status: 503 },
      { failure: transportFailure('timeout', true), kind: 'timeout', code: 'TIMEOUT', status: null },
      { failure: transportFailure('network', false, undefined, 'dns'), kind: 'dns', code: 'NETWORK', status: null },
      { failure: transportFailure('network', false, undefined, 'tls'), kind: 'tls', code: 'NETWORK', status: null },
      { failure: transportFailure('network', true, undefined, 'connection-interrupted'), kind: 'connection-interrupted', code: 'NETWORK', status: null },
    ] as const
    for (const item of cases) {
      f.transport.failure = item.failure
      const before = f.transport.calls.length
      await assert.rejects(provider.generateStructured(request()), (raw: unknown) => {
        assert.ok(raw instanceof AIError)
        assert.equal(raw.code, item.code)
        assert.equal(raw.diagnostics?.kind, item.kind)
        assert.equal(raw.diagnostics?.httpStatus, item.status)
        assert.equal(raw.diagnostics?.requestSent, item.failure.sent)
        assert.ok((raw.diagnostics?.elapsedMs ?? -1) >= 0)
        assert.doesNotMatch(JSON.stringify(raw), /FIXTURE_ONLY|Authorization|Bearer|private response/)
        return true
      })
      assert.equal(f.transport.calls.length, before + 1)
    }
    f.transport.failure = null
    f.transport.valid = false
    await assert.rejects(provider.generateStructured(request()), (raw: unknown) => {
      assert.ok(raw instanceof AIError)
      assert.equal(raw.diagnostics?.kind, 'structured-output')
      assert.equal(raw.diagnostics?.httpStatus, 200)
      assert.equal(raw.diagnostics?.requestSent, true)
      return true
    })
  } finally { await f.close() }
})

test('Failed real text task persists only sanitized diagnostics and never repeats an ambiguous request', async () => {
  const f = await fixture(), db = new ProjectDatabase(':memory:'), repo = new IntelligenceRepository(db)
  let queue: AITaskQueue | undefined
  try {
    const s = await f.save()
    await f.manager.execute({ op: 'ai.default', id: s.id })
    f.transport.failure = transportFailure('timeout', true)
    const project = db.create({ name: '诊断记录', description: '', genre: '剧情', language: 'zh-CN', aspectRatio: '16:9' })
    queue = new AITaskQueue(repo, f.manager.textProvider(new MockTextProvider(), { validateOnFirstTask: true }))
    const task = queue.start(project.id, { type: 'parse', name: '故事', rawText: '一个角色进入车站。' }, true)
    for (let n = 0; n < 100 && ['queued', 'running'].includes(repo.task(project.id, task.id).status); n++) await new Promise(resolve => setTimeout(resolve, 10))
    const failed = repo.task(project.id, task.id)
    assert.equal(failed.status, 'failed')
    assert.deepEqual(failed.error?.diagnostics && { kind: failed.error.diagnostics.kind, httpStatus: failed.error.diagnostics.httpStatus, requestSent: failed.error.diagnostics.requestSent }, { kind: 'timeout', httpStatus: null, requestSent: true })
    assert.ok((failed.error?.diagnostics?.elapsedMs ?? -1) >= 0)
    assert.doesNotMatch(JSON.stringify(failed.error), /FIXTURE_ONLY|Authorization|Bearer|private response/)
    assert.equal(f.transport.calls.length, 1)
  } finally { queue?.close(); db.close(); await f.close() }
})

test('Breakdown and shot planning use a larger output cap, one request and a bounded preflight; Story stays unchanged', async () => {
  assert.equal(TEXT_REQUEST_TIMEOUT_MS, 90000)
  assert.equal(TEXT_ANALYSIS_MAX_TOKENS, 8192)
  const f = await fixture()
  try {
    await f.manager.execute({ op: 'ai.save', service: { ...f.input, textOutputMode: 'json-prompt' }, apiKey: 'FIXTURE_ONLY' })
    const s = (await f.manager.snapshot()).services[0]!
    await f.manager.execute({ op: 'ai.default', id: s.id })
    const provider = f.manager.textProvider(new MockTextProvider(), { validateOnFirstTask: true })
    for (const schemaName of ['production_breakdown', 'shot_plan']) {
      await provider.generateStructured({ system: 'fixture', input: {}, schema: z.strictObject({ ok: z.literal(true) }), schemaName, signal: AbortSignal.timeout(1000) })
      assert.equal(JSON.parse(String(f.transport.calls.at(-1)?.body)).max_tokens, TEXT_ANALYSIS_MAX_TOKENS)
    }
    const before = f.transport.calls.length
    await assert.rejects(provider.generateStructured({ system: 'fixture', input: { value: 'a'.repeat(TEXT_ANALYSIS_MAX_REQUEST_BYTES) }, schema: z.strictObject({ ok: z.literal(true) }), schemaName: 'shot_plan', signal: AbortSignal.timeout(1000) }), /内容过长/)
    assert.equal(f.transport.calls.length, before)
    await provider.generateStructured({ system: 'fixture', input: {}, schema: z.strictObject({ ok: z.literal(true) }), schemaName: 'director_structured_script', signal: AbortSignal.timeout(1000) })
    assert.equal(JSON.parse(String(f.transport.calls.at(-1)?.body)).max_tokens, 4000)
  } finally { await f.close() }
})
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

test('Explicit JSON compatibility persists, uses the configured mode and invalidates old validation on change', async () => {
  const f = await fixture()
  try {
    await f.manager.execute({ op: 'ai.save', service: { ...f.input, textOutputMode: 'json-object' }, apiKey: 'sk-ml-FIXTURE_ONLY' })
    const s = (await f.manager.snapshot()).services[0]!
    await f.manager.execute({ op: 'ai.probe', id: s.id })
    await f.manager.execute({ op: 'ai.validateText', id: s.id, confirmed: true })
    assert.equal((await f.manager.snapshot()).services[0]?.generation, 'validated')
    assert.equal(JSON.parse(String(f.transport.calls[1]!.body)).response_format.type, 'json_object')
    const reopened = new AIServiceManager(f.path, f.credentials, f.host, false, f.transport)
    await reopened.load()
    assert.equal((await reopened.snapshot()).services[0]?.textOutputMode, 'json-object')
    await reopened.execute({ op: 'ai.save', service: { ...f.input, id: s.id, textOutputMode: 'json-schema' } })
    assert.equal((await reopened.snapshot()).services[0]?.generation, 'unverified')
    assert.equal((await reopened.snapshot()).services[0]?.connection, 'unchecked')
  } finally { await f.close() }
})

test('Changing the endpoint cannot reuse the original secret or trigger any request to the new supplier', async () => {
  const f = await fixture()
  try {
    const s = await f.save()
    await assert.rejects(f.manager.execute({ op: 'ai.save', service: { ...f.input, id: s.id, baseUrl: 'https://different.example/v1' } }), /重新输入对应服务密钥/)
    assert.equal((await f.manager.snapshot()).services[0]?.baseUrl, f.input.baseUrl)
    assert.equal(f.transport.calls.length, 0)
    await assert.rejects(f.manager.execute({ op: 'ai.save', service: { ...f.input, id: null, kind: 'compshare-video', textOutputMode: 'json-object' } }), /仅适用于文本/)
  } finally { await f.close() }
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

test('First confirmed Story task validates the text service with one POST and survives reopening', async () => {
  const f = await fixture(), db = new ProjectDatabase(':memory:'), repo = new IntelligenceRepository(db)
  let queue: AITaskQueue | undefined
  try {
    await f.manager.execute({ op: 'ai.save', service: { ...f.input, textOutputMode: 'json-prompt' }, apiKey: 'sk-ml-FIXTURE_ONLY' })
    const s = (await f.manager.snapshot()).services[0]!
    await f.manager.execute({ op: 'ai.default', id: s.id })
    f.transport.structured = { episodes: [{ name: '真实任务协议', scenes: [{ ...emptyScene, heading: '场次', action: '单次请求结果' }] }], warnings: [] }
    const p = db.create({ name: '首任务验证', description: '', genre: '剧情', language: 'zh-CN', aspectRatio: '16:9' })
    queue = new AITaskQueue(repo, f.manager.textProvider(new MockTextProvider(), { validateOnFirstTask: true }))
    assert.throws(() => queue!.start(p.id, { type: 'parse', name: '故事', rawText: '未授权' }), /确认/)
    assert.equal(f.transport.calls.length, 0)
    const task = queue.start(p.id, { type: 'parse', name: '故事', rawText: '授权单次请求' }, true)
    for (let n = 0; n < 100 && ['queued', 'running'].includes(repo.task(p.id, task.id).status); n++) await new Promise(r => setTimeout(r, 10))
    assert.equal(repo.task(p.id, task.id).status, 'succeeded')
    assert.equal(f.transport.calls.length, 1)
    assert.equal(JSON.parse(String(f.transport.calls[0]!.body)).response_format, undefined)
    const reopened = new AIServiceManager(f.path, f.credentials, f.host, false, f.transport)
    await reopened.load()
    assert.equal((await reopened.snapshot()).services[0]?.generation, 'validated')
    assert.equal((await reopened.snapshot()).services[0]?.textOutputMode, 'json-prompt')
  } finally { queue?.close(); db.close(); await f.close() }
})

test('An invalid first real task never marks the service validated or retries', async () => {
  const f = await fixture()
  try {
    const s = await f.save()
    await f.manager.execute({ op: 'ai.default', id: s.id })
    f.transport.valid = false
    await assert.rejects(f.manager.textProvider(new MockTextProvider(), { validateOnFirstTask: true }).generateStructured({ system: 'test', input: {}, schema: z.strictObject({ ok: z.literal(true) }), schemaName: 'test', signal: AbortSignal.timeout(1000) }))
    assert.equal(f.transport.calls.length, 1)
    assert.equal((await f.manager.snapshot()).services[0]?.generation, 'unverified')
  } finally { await f.close() }
})
