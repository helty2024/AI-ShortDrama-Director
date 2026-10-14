import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { DomainError } from '../database.js'
import type { StoredAIService } from './ai-services.js'
import { ImageHttpTransport, transportFailure } from '../tools/adapters/image-http.js'
import type { CredentialStore } from '../video/credentials.js'
import type { ToolExecutionContext } from '../../../src/shared/tools.js'
import type { GenerationRepository } from './repository.js'
import type { VisualRepository } from '../visual/repository.js'
import { probeVideo } from '../video/ffmpeg.js'

const capability = z.enum(['image.generate', 'image.referenceGenerate', 'video.textToVideo', 'video.imageToVideo'])
type NativeCapability = z.infer<typeof capability>
const stateSchema = z.strictObject({
  download: z.strictObject({ host: z.string().min(1).max(253), hash: z.string().regex(/^[a-f0-9]{64}$/), checkedAt: z.iso.datetime(), duration: z.number().positive(), model: z.literal('MiniMax-H3') }).nullable(),
  trial: z.strictObject({ capability, expiresAt: z.iso.datetime(), maxPoints: z.number().int().nonnegative() }).nullable(),
})
type NativeState = z.infer<typeof stateSchema>
const taskReply = z.object({ task: z.object({ id: z.string(), model: z.literal('MiniMax-H3'), status: z.literal('succeeded'), content: z.object({ url: z.url().max(4000) }), resolution: z.enum(['480P', '768P']), duration: z.number().int().min(4).max(30) }) })
/** A native adapter can submit only an authorized trial or a capability with a real ingested result. */
export class NativeProductionGate {
  private readonly root: string
  private readonly credentials: CredentialStore
  private readonly generation: GenerationRepository
  private readonly visual: VisualRepository
  private readonly transport: ImageHttpTransport
  constructor(root: string, credentials: CredentialStore, generation: GenerationRepository, visual: VisualRepository, transport = new ImageHttpTransport({ timeoutMs: 180000 })) {
    this.root=root; this.credentials=credentials; this.generation=generation; this.visual=visual; this.transport=transport
  }
  private directory(s: StoredAIService) { return join(this.root, s.id, `revision-${s.revision}`) }
  private async state(s: StoredAIService): Promise<NativeState> {
    try { return stateSchema.parse(JSON.parse(await readFile(join(this.directory(s), 'state.json'), 'utf8'))) }
    catch { return { download: null, trial: null } }
  }
  private async save(s: StoredAIService, value: NativeState) {
    const directory=this.directory(s); await mkdir(directory,{recursive:true})
    await writeFile(join(directory,'state.json.tmp'),JSON.stringify(stateSchema.parse(value))+'\n',{mode:0o600})
    await rename(join(directory,'state.json.tmp'),join(directory,'state.json'))
  }
  private tool(s: StoredAIService) { return s.kind==='packy-image' ? 'packy.image-25' : 'compshare.minimax-h3' }
  private trialMarker(s: StoredAIService, expiresAt: string) { return join(this.directory(s),'trial-'+createHash('sha256').update(expiresAt).digest('hex')+'.consumed') }
  private async trialAvailable(s: StoredAIService, state: NativeState, cap: NativeCapability) {
    if(state.trial?.capability!==cap || Date.parse(state.trial.expiresAt)<=Date.now())return false
    try {await readFile(this.trialMarker(s,state.trial.expiresAt));return false}catch(error){return Boolean(error && typeof error==='object' && 'code' in error && error.code==='ENOENT')}
  }
  private successes(s: StoredAIService, cap: NativeCapability) {
    return this.generation.database.list().flatMap(p=>this.generation.list('generation_records',p.id)).filter(r=>
      r.toolId===this.tool(s) && r.modelId===s.model && r.generationType===cap && r.outcome==='succeeded' &&
      // Only an intent issued for this exact configuration revision can validate it.
      r.approvalId!==null && r.taskId)
  }
  async validated(s: StoredAIService, cap: NativeCapability) {
    for(const record of this.successes(s,cap)) {
      try {
        const intent=JSON.parse(await readFile(join(this.directory(s),record.taskId+'.json'),'utf8')) as { fingerprint?: string }
        if(intent.fingerprint!==record.requestFingerprint)continue
        const versions=this.visual.versions(record.projectId).filter(v=>v.generationTaskId===record.taskId && v.sourceType==='generated')
        if(!versions.length)continue
        for(const version of versions)await this.visual.storage.resolveRegisteredFile(version.storageKey)
        return true
      } catch { /* Missing or invalid evidence never opens production. */ }
    }
    return false
  }
  async available(s: StoredAIService, cap?: NativeCapability) {
    if(!s.enabled || s.deleted || s.connection!=='accepted' || !s.credentialRef)return false
    const state=await this.state(s)
    const caps: NativeCapability[] = cap ? [cap] : s.kind==='packy-image' ? ['image.generate','image.referenceGenerate'] : ['video.imageToVideo','video.textToVideo']
    for(const c of caps)if(await this.validated(s,c) || await this.trialAvailable(s,state,c))return true
    return false
  }
  async status(s: StoredAIService) {
    const caps: NativeCapability[]=s.kind==='packy-image'?['image.generate','image.referenceGenerate']:['video.imageToVideo','video.textToVideo']
    for(const c of caps)if(await this.validated(s,c))return 'validated' as const
    return await this.available(s)?'trial' as const:'unverified' as const
  }
  async hosts(s: StoredAIService) { const state=await this.state(s); return state.download?[state.download.host]:[] }
  async pending(s: StoredAIService) {
    for(const p of this.generation.database.list())for(const r of this.generation.list('generation_records',p.id)) {
      if(r.toolId!==this.tool(s) || r.outcome!=='pending' || !r.approvalId)continue
      const task=this.generation.task(p.id,r.taskId)
      if(!task.providerTaskId)continue
      try {const intent=JSON.parse(await readFile(join(this.directory(s),r.taskId+'.json'),'utf8')) as {fingerprint?:string};if(intent.fingerprint===r.requestFingerprint)return true}catch{/* Unowned tasks do not open the download path. */}
    }
    return false
  }
  private async ownedIntent(s: StoredAIService, context: ToolExecutionContext) {
    const record=this.generation.findByTask(context.projectId,context.taskId)
    if(!record || record.toolId!==this.tool(s) || record.modelId!==s.model || !context.approvalId || record.approvalId!==context.approvalId || record.requestFingerprint!==context.requestFingerprint)throw transportFailure('authorization',false)
    const intent=z.object({fingerprint:z.string(),trial:z.boolean()}).parse(JSON.parse(await readFile(join(this.directory(s),context.taskId+'.json'),'utf8')))
    if(intent.fingerprint!==context.requestFingerprint)throw transportFailure('authorization',false)
    return {record,intent}
  }
  async taskDownloadHosts(s: StoredAIService, externalTaskId: string, value: string, context: ToolExecutionContext) {
    const {intent}=await this.ownedIntent(s,context),task=this.generation.task(context.projectId,context.taskId)
    if(task.providerTaskId!==externalTaskId)throw transportFailure('authorization',false)
    const url=new URL(value)
    if(url.protocol!=='https:' || url.username || url.password || url.hash || url.port && url.port!=='443' || !/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(url.hostname))throw transportFailure('authorization',false)
    const hosts=await this.hosts(s)
    // Only the first explicitly authorized owned trial may establish a host.
    // Subsequent production requests must use the previously verified exact host.
    if(!intent.trial && !hosts.includes(url.hostname) || hosts.length && !hosts.includes(url.hostname))throw transportFailure('authorization',false)
    return [url.hostname]
  }
  async noteVerifiedOutput(s: StoredAIService, url: string, context: ToolExecutionContext, bytes: Buffer, duration: number) {
    await this.ownedIntent(s,context)
    await this.save(s,{...(await this.state(s)),download:{host:new URL(url).hostname,hash:createHash('sha256').update(bytes).digest('hex'),checkedAt:new Date().toISOString(),duration,model:'MiniMax-H3'}})
  }
  async verifyVideoDownload(s: StoredAIService, taskId: string) {
    if(s.kind!=='compshare-video' || s.connection!=='accepted' || !s.credentialRef)throw new DomainError('CONFLICT','请先完成 CompShare 只读鉴权')
    const response=await this.transport.bytes('https://cp.compshare.cn/minimax/v2/query/video_generation/'+encodeURIComponent(taskId),AbortSignal.timeout(15000),{key:await this.credentials.get(s.credentialRef),limit:64000})
    const {task}=taskReply.parse(JSON.parse(response.bytes.toString('utf8')))
    if(task.id!==taskId)throw new DomainError('CONFLICT','供应商任务身份不匹配')
    const url=new URL(task.content.url)
    if(url.protocol!=='https:' || url.username || url.password || url.hash || url.port && url.port!=='443')throw new DomainError('FORBIDDEN','供应商输出地址不符合安全要求')
    // The exact host is issued by the authenticated fixed native API for this task.
    // Each DNS address is checked and pinned; no redirect or download credential is allowed.
    const output=await this.transport.bytes(task.content.url,AbortSignal.timeout(180000),{limit:256*1024*1024,redirects:{max:0,allowedHosts:[url.hostname]}})
    if(output.mime!=='video/mp4' || output.bytes.length<12 || output.bytes.subarray(4,8).toString('ascii')!=='ftyp')throw new DomainError('INVALID_INPUT','真实输出不是有效 MP4')
    const directory=this.directory(s);await mkdir(directory,{recursive:true});const file=join(directory,'download-check.mp4.tmp')
    await writeFile(file,output.bytes,{mode:0o600})
    try {
      const media=await probeVideo(file)
      if(Math.abs(media.duration-task.duration)>0.5)throw new DomainError('INVALID_INPUT','真实输出时长与任务响应不匹配')
      const hash=createHash('sha256').update(output.bytes).digest('hex')
      await this.save(s,{...(await this.state(s)),download:{host:url.hostname,hash,checkedAt:new Date().toISOString(),duration:media.duration,model:'MiniMax-H3'}})
      return '已验证真实任务、模型权限与 MP4 下载。仅允许该精确 CDN 域名；仍需单独授权新镜头生成。'
    } finally {await rm(file,{force:true})}
  }
  async authorize(s: StoredAIService, cap: NativeCapability, maxPoints: number) {
    if(!s.enabled || s.connection!=='accepted' || !s.credentialRef)throw new DomainError('CONFLICT','请先保存密钥并完成只读连接检测')
    if(s.kind==='text' || (s.kind==='packy-image')!==cap.startsWith('image.'))throw new DomainError('INVALID_INPUT','服务与测试能力不匹配')
    const state=await this.state(s)
    if(s.kind==='compshare-video' && maxPoints<20)throw new DomainError('CONFLICT','请授权至少 20 积分的 4 秒单次测试；不会开放批量生产')
    const previous=this.generation.database.list().flatMap(p=>this.generation.list('generation_records',p.id)).filter(r=>r.toolId===this.tool(s) && (r.outcome==='unknown' || r.outcome==='pending' && r.approvalId!==null))
    if(previous.length)throw new DomainError('CONFLICT','任务状态待核实；请先核实原任务，禁止新增付费测试')
    await this.save(s,{...state,trial:{capability:cap,maxPoints,expiresAt:new Date(Date.now()+15*60*1000).toISOString()}})
  }
  async consume(s: StoredAIService, cap: NativeCapability, context: ToolExecutionContext, duration=0) {
    if(!context.approvalId || !await this.available(s,cap))throw transportFailure('authorization',false)
    const record=this.generation.findByTask(context.projectId,context.taskId)
    if(!record || record.taskId!==context.taskId || record.toolId!==this.tool(s) || record.modelId!==s.model || record.generationType!==cap || record.approvalId!==context.approvalId || record.requestFingerprint!==context.requestFingerprint)throw transportFailure('authorization',false)
    const state=await this.state(s), verified=await this.validated(s,cap)
    if(!verified && (state.trial?.capability!==cap || Date.parse(state.trial.expiresAt)<=Date.now() || s.kind==='compshare-video' && (duration!==4 || duration*5>state.trial.maxPoints)))throw transportFailure('authorization',false)
    const directory=this.directory(s);await mkdir(directory,{recursive:true})
    if(!verified && state.trial) {
      const marker=await open(this.trialMarker(s,state.trial.expiresAt),'wx',0o600)
      try {await marker.writeFile(context.taskId)}finally{await marker.close()}
    }
    // Exclusive persisted intent prevents another submit even after network ambiguity or restart.
    const file=await open(join(directory,context.taskId+'.json'),'wx',0o600)
    try {await file.writeFile(JSON.stringify({taskId:context.taskId,capability:cap,fingerprint:context.requestFingerprint,approvalId:context.approvalId,trial:!verified,createdAt:new Date().toISOString(),estimatedPoints:duration?duration*5:null}))}finally{await file.close()}
    if(!verified)await this.save(s,{...state,trial:null})
  }
}
