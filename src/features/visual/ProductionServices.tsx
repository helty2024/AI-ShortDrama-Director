import { useContext, useEffect, useState, type ReactNode } from 'react'
import { aiServicesSnapshotSchema, textOutputModeSchema, type AIServiceInput, type AIServiceState } from '../../shared/ai-services'
import { packyImageModels, packyImageModelNames, packyTextOnlyModels } from '../../shared/packy-models'
import type { ServiceSettingsCommand } from '../../shared/service-settings'
import { useWorkspace } from '../workspace/state'
import { CreatorContext } from '../../components/creator-shell/creator-context'
import { aiServiceCommand } from './service-command'
import { applyTextServicePreset, textServicePresets } from './text-service-presets'
const names = { text: '文本 AI', 'packy-image': '图像 AI', 'compshare-video': '视频 AI' }
const template = (kind: AIServiceInput['kind']): AIServiceInput => ({ id: null, kind,
  name: kind === 'text' ? '兼容文本模型' : kind === 'packy-image' ? 'Packy Image' : 'CompShare · MiniMax H3',
  baseUrl: kind === 'text' ? 'https://api.openai.com/v1' : kind === 'packy-image' ? 'https://cf.api.fan/v1' : 'https://cp.compshare.cn',
  model: kind === 'text' ? '' : kind === 'packy-image' ? 'gpt-image-2.5-sunburst' : 'MiniMax-H3',
})
export function ProductionServices({ localService }: { localService: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ReturnType<typeof aiServicesSnapshotSchema.parse> | null>(null)
  const [editing, setEditing] = useState<AIServiceInput | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const act = async (command: ServiceSettingsCommand) => {
    setBusy(true); setError('')
    try { const result = await aiServiceCommand(command); setSnapshot(result); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成，请重试'); return false }
    finally { setBusy(false) }
  }
  useEffect(() => { void aiServiceCommand({ op: 'ai.list' }).then(setSnapshot).catch(() => setError('服务读取失败，请重新打开设置')) }, [])
  return <div className="production-services">
    <p className="settings-scope">服务连接在所有项目中共用。检测连接不会生成作品；真实生成需要单独确认。未配置时不会使用模拟结果。</p>
    {error && <p role="alert">{error}</p>}
    {(['text', 'packy-image', 'compshare-video'] as const).map(kind => <section className="production-service-group" key={kind} aria-label={names[kind]}>
      <header><h2>{names[kind]}</h2><button disabled={busy} onClick={() => setEditing(template(kind))}>添加{names[kind]}服务</button></header>
      <div className="service-grid">{snapshot?.services.filter(s => s.kind === kind).map(s => <ServiceCard key={s.id} service={s} busy={busy} act={act} edit={() => setEditing({ id:s.id,kind:s.kind,name:s.name,baseUrl:s.baseUrl,model:s.model,textOutputMode:s.textOutputMode })} />)}</div>
      {!snapshot?.services.some(s => s.kind === kind) && <p className="settings-note">请先连接{names[kind]}服务。{kind === 'text' ? '用于故事整理、剧本、角色/场景/道具提取和分镜。' : kind === 'packy-image' ? '用于资产参考图和分镜关键帧。' : '用于将已确认关键帧制作成镜头视频。'}</p>}
    </section>)}
    <section className="production-service-group"><h2>本地生成服务</h2>{localService}</section>
    {editing && <ServiceForm key={editing.id ?? editing.kind} initial={editing} busy={busy} close={() => setEditing(null)} save={async (service,apiKey) => { if (await act({ op:'ai.save', service, ...(apiKey ? {apiKey}: {}) })) setEditing(null) }} />}
  </div>
}
function ServiceCard({ service:s, busy, act, edit }: {service:AIServiceState;busy:boolean;act:(c:ServiceSettingsCommand)=>Promise<boolean>;edit:()=>void}) {
  const connection = {unchecked:'尚未检测',accepted:'连接检测通过',rejected:'连接检测未通过',unavailable:'服务不可用'}[s.connection]
  const reason = s.kind !== 'text' && s.generation === 'validated' && s.reason.startsWith('已开放一次小规模真实测试') ? '已完成真实结果校验与入库。后续每次生成仍需单独确认费用与素材授权。' : s.reason
  return <section className="service-card" aria-label={s.name}><div className="service-card-top"><span className="service-state">{!s.enabled ? '已停用' : connection}</span>{s.isDefault && <span>默认服务</span>}</div><h3>{s.name}</h3><p>模型：{s.model}</p><p>{s.kind === 'text' ? '故事、剧本与制作方案' : s.kind === 'packy-image' ? '参考图与关键帧' : '镜头视频'}</p><p>{s.credentialSaved ? '密钥已加密保存' : '请保存或导入密钥'}</p><p>{s.generation === 'validated' ? s.kind === 'text' ? '结构化生成协议已验证；任务可能收费。' : '已有能力完成真实结果入库验证；其他能力需分别测试。' : s.generation === 'trial' ? '单次真实测试已准备，尚未通过生产验收' : '尚未通过真实生成验收'}</p><p>{reason}</p>
    {s.model === 'gpt-image-2' && <p className="settings-note">Images API：单张文生图/图片编辑；必须使用 sora 分组令牌。目录可见不证明分组或编辑权限，图生图须另行单次授权验证。</p>}{packyTextOnlyModels.includes(s.model) && <p className="settings-note">当前支持单张文生图与镜头关键帧，输出为自动尺寸。参考图编辑尚未验证，不提供该操作。</p>}
    {s.kind === 'text' && <p className="settings-note">{!s.enabled ? '启用服务后才能用于创作。' : !s.credentialSaved ? '下一步：在设置中保存密钥，或导入本机密钥文件。' : s.connection !== 'accepted' ? '下一步：检测连接，确认密钥与模型权限。' : !s.isDefault ? '下一步：设为默认，故事整理和剧本分析将使用此模型。' : s.generation !== 'validated' ? '下一步：回到故事，确认一次 AI 整理。首个真实任务同时验证输出，不必额外发送测试请求。' : '已准备好：回到故事，点击 AI 整理。每次真实请求仍需确认。'}</p>}
    <div className="service-actions"><button disabled={busy} onClick={edit}>设置</button><button disabled={busy || !s.enabled || !s.credentialSaved} onClick={() => void act({op:'ai.probe',id:s.id})}>检测连接</button><button disabled={busy || !s.enabled || s.isDefault} onClick={() => void act({op:'ai.default',id:s.id})}>设为默认</button></div>
    {s.kind === 'text' && <button disabled={busy || !s.enabled || s.connection !== 'accepted'} onClick={() => { if (window.confirm('将向此文本模型发送一次小型结构化协议请求，可能收费；费用未知，不会自动重试。确认进行本次验证？')) void act({op:'ai.validateText',id:s.id,confirmed:true}) }}>验证结构化能力（可能收费）</button>}
    {s.kind !== 'text' && <NativeTestControls service={s} busy={busy} act={act} />}
    <details><summary>密钥与配置管理</summary><div className="service-actions"><button disabled={busy} onClick={() => void act({op:'ai.importKey',id:s.id})}>导入或更换密钥</button><button disabled={busy} onClick={() => void act({op:'ai.enable',id:s.id,enabled:!s.enabled})}>{s.enabled?'停用服务':'启用服务'}</button><button disabled={busy} onClick={() => { if(window.confirm('删除此服务配置？历史任务关联及原加密凭据会保留，不删除项目或素材。')) void act({op:'ai.delete',id:s.id,confirmed:true}) }}>删除配置</button></div></details>
  </section>
}
function NativeTestControls({service:s,busy,act}:{service:AIServiceState;busy:boolean;act:(c:ServiceSettingsCommand)=>Promise<boolean>}) {
  const {state}=useWorkspace(), creator=useContext(CreatorContext)
  const [remoteTask,setRemoteTask]=useState(''),[targetId,setTargetId]=useState(''),[points,setPoints]=useState(20)
  const [cap,setCap]=useState<'image.generate'|'image.referenceGenerate'|'video.imageToVideo'|'video.textToVideo'>(s.kind==='packy-image'?'image.generate':'video.imageToVideo')
  const targets=state.workspace?.entities.filter(e=>s.kind==='compshare-video'?e.kind==='shot':['shot','character','location','prop'].includes(e.kind))??[]
  const target=targets.find(t=>t.id===targetId)
  return <details><summary>真实生成测试</summary>
    <p>先通过一次小规模真实测试，再开放该能力的后续制作。保存密钥和只读检测不会自动提交或批量生成。</p>
    {s.kind==='compshare-video' && <><p>可先检测本账户既有成功视频的下载，也可以准备下面的 4 秒单次真实测试。首个结果会核验真实域名与媒体；成功前不开放正式批量生成。</p><label>已有成功视频任务编号<input value={remoteTask} onChange={e=>setRemoteTask(e.target.value)} /></label><button disabled={busy || s.connection!=='accepted' || !remoteTask.trim()} onClick={()=>void act({op:'ai.verifyVideoDownload',id:s.id,taskId:remoteTask.trim()})}>验证真实 MP4 下载</button><label>本次测试积分上限<input type="number" min="20" max="1000000" value={points} onChange={e=>setPoints(Number(e.target.value))}/></label><p>仅测试 4 秒原生 480P，当前官方报价预计 20 积分。积分不是人民币；货币费用未知，仍需在生成页单独授权。</p></>}
    {!state.workspace && <p>请先选择项目，并准备要测试的资产或镜头。</p>}
    {state.workspace && <><label>测试目标<select value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">请选择资产或镜头</option>{targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>测试方式<select value={cap} onChange={e=>setCap(e.target.value as typeof cap)}>{s.kind==='packy-image'?<><option value="image.generate">文字生成图像</option>{!packyTextOnlyModels.includes(s.model) && <option value="image.referenceGenerate">参考图生成图像</option>}</>:<><option value="video.imageToVideo">已确认关键帧生成视频</option><option value="video.textToVideo">文字生成视频</option></>}</select></label></>}
    <button disabled={busy || s.connection!=='accepted' || !s.enabled || !target || !creator} onClick={()=>{if(!target || !creator || !window.confirm('准备一次真实生成测试，可能收费。此操作只开放本次预览；下一页仍需你确认费用与上传授权，才会提交。继续？'))return;void act({op:'ai.authorizeTrial',id:s.id,confirmed:true,capability:cap,maxPoints:s.kind==='compshare-video'?points:0}).then(ok=>{if(!ok)return;creator.navigateCreator('generation',{shotId:target.kind==='shot'?target.id:undefined,targetId:target.kind!=='shot'?target.id:undefined,targetKind:target.kind==='character'||target.kind==='location'||target.kind==='prop'?target.kind:undefined,generationMode:s.kind==='compshare-video'?'video':target.kind==='shot'?'keyframe':'asset',requestedToolId:s.kind==='packy-image'?'packy.image-25':'compshare.minimax-h3',requestedVideoMode:cap==='video.textToVideo'?'text-to-video':'image-to-video',requestedCapability:cap==='image.generate'||cap==='image.referenceGenerate'?cap:undefined})})}}>准备单次真实测试</button>
  </details>
}
function ServiceForm({initial,busy,close,save}:{initial:AIServiceInput;busy:boolean;close:()=>void;save:(s:AIServiceInput,key:string)=>Promise<void>}) {
  const [value,setValue] = useState(initial), [key,setKey] = useState('')
  const [preset,setPreset] = useState('custom')
  const addressChanged = Boolean(initial.id && value.baseUrl !== initial.baseUrl)
  return <div className="creator-generate-confirm-backdrop">
    <section className="creator-generate-confirm" role="dialog" aria-modal="true" aria-label="AI 服务配置">
      <h2>{names[value.kind]}设置</h2>
      <form className="settings-form" onSubmit={e=>{e.preventDefault();const secret=key;setKey('');void save(value,secret)}}>
        <p>保存后所有项目共用。密钥仅交给主进程加密保存，不写入普通配置或项目数据。</p>
        {value.kind === 'text' && <>
          <label>选择服务模板<select value={preset} onChange={e=>{setPreset(e.target.value);setValue(applyTextServicePreset(value,e.target.value));setKey('')}}>
            <option value="custom">自定义兼容服务</option>
            {textServicePresets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <p>可选百炼通义千问或 DeepSeek 模板。模板只填写连接方式，不代表账户已开通；请手动填写本账户可用的准确模型名称，并在服务卡片中手动设为默认。百炼模板为北京区域，其他区域请使用自定义地址。切换模板不会联网或生成，任务失败也不会自动切换供应商。</p>
        </>}
        <label>服务名称<input required value={value.name} onChange={e=>setValue({...value,name:e.target.value})} /></label>
        <label>接口协议<input readOnly value={value.kind==='text'?'Chat Completions':value.kind==='packy-image'?'Packy 原生图像接口':'CompShare MiniMax H3 原生异步接口'} /></label>
        <label>API 地址<input required readOnly={value.kind!=='text'} value={value.baseUrl} onChange={e=>setValue({...value,baseUrl:e.target.value})} /></label>
        <label>模型名称{value.kind === 'packy-image' ? <select aria-label="模型名称" value={value.model} onChange={e=>setValue({...value,model:e.target.value})}>{packyImageModels.map(m=><option key={m} value={m}>{packyImageModelNames[m]}</option>)}</select> : <input required readOnly={value.kind!=='text'} value={value.model} onChange={e=>setValue({...value,model:e.target.value})} />}</label>
        {value.kind === 'text' && <details><summary>模型兼容设置</summary>
          <label>输出兼容方式<select value={value.textOutputMode ?? 'json-schema'} onChange={e=>setValue({...value,textOutputMode:textOutputModeSchema.parse(e.target.value)})}>
            <option value="json-schema">严格结构化输出</option><option value="json-object">兼容 JSON 输出</option><option value="json-prompt">提示约束 JSON（服务不支持格式参数）</option>
          </select></label>
          <p>按服务文档选择；所有方式都会严格检查结果。不支持时会停止并提示，不自动切换或重复收费请求。SenseNova 模板使用提示约束 JSON，原配置保持原模式。</p>
        </details>}
        <label>API Key<input type="password" required={addressChanged} autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} placeholder={addressChanged?'地址已改变，请输入新服务的密钥':value.id?'留空保留现有密钥；填写新值更换':'可以输入密钥，或保存后导入本机密钥文件'} /></label>
        {addressChanged && <p>更换地址必须重新输入对应密钥，原密钥不会交给新服务。</p>}
        <div className="actions"><button type="button" disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy}>保存服务</button></div>
      </form>
    </section>
  </div>
}
export function TestModeControl() {
  const [message,setMessage] = useState('')
  return <div><p>普通工作流默认使用真实服务。模拟模式需要明确开启，只能验证流程，不能用于真实供应商验收。</p>{(['test','production'] as const).map(mode=><button key={mode} onClick={() => {if(window.confirm(mode==='test'?'开启明确标记的模拟测试模式？真实服务验收将暂停。':'返回真实生产模式？未配置服务时不会回退到模拟。'))void aiServiceCommand({op:'ai.mode',mode,confirmed:true}).then(()=>window.location.reload()).catch(cause=>setMessage(cause instanceof Error?cause.message:'切换失败'))}}>{mode==='test'?'开启模拟测试模式':'返回真实生产模式'}</button>)}{message && <p role="alert">{message}</p>}</div>
}
