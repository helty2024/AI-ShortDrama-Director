import { useEffect, useState } from 'react'
import { readinessSchema, type Readiness } from '../../shared/compatibility'
import { compshareConfigurationSchema, compshareProbeSchema, type CompShareCommand } from '../../shared/compshare-minimax-h3'
import { comfyConfigurationSchema, type ServiceSettingsCommand } from '../../shared/service-settings'
import { imageConnectivitySchema } from '../../shared/image-api'
import type { ProviderSettings } from '../../shared/visual'
import { imageCommand } from '../generate/generation-api'
import { comfyStatus, h3Status } from './service-status'

async function service(command: ServiceSettingsCommand) {
  const result = await window.desktop!.workspace.request({action:'serviceSettings',command})
  if (!result.ok) throw new Error(result.message)
  return comfyConfigurationSchema.parse(result.data)
}
async function h3(command: CompShareCommand) {
  const result = await window.desktop!.workspace.request({action:'compshareH3',command})
  if (!result.ok) throw new Error(result.message)
  return result.data
}
export function AIServiceCards() {
  const [rows,setRows] = useState<Readiness>([]), [busy,setBusy] = useState(false), [error,setError] = useState('')
  const [open,setOpen] = useState(false)
  const refresh = async () => {
    setBusy(true);setError('')
    try {
      const result = await window.desktop!.workspace.request({action:'compatibility',command:{op:'readiness'}})
      if (!result.ok) throw new Error(result.message)
      setRows(readinessSchema.parse(result.data))
    } catch { setRows([]);setError('无法检测本地服务，请重试。云服务状态不受此检测影响。') }
    finally { setBusy(false) }
  }
  useEffect(()=>{const timer=setTimeout(()=>void refresh(),0);return()=>clearTimeout(timer)},[])
  const comfy = comfyStatus(rows.find(row=>row.toolId==='comfyui.local')?.runtime)
  return <div className="settings-services">
    <p className="settings-scope">服务连接保存在这台电脑上，所有项目共用。检测连接不会生成作品。</p>
    <div className="service-group"><h2>图像生成</h2><div className="service-grid">
      <section className="service-card" aria-label="ComfyUI 服务"><div className="service-card-top"><span className="service-symbol mint">◈</span><span className="service-state">{busy?'检测中…':comfy.label}</span></div><h3>ComfyUI</h3><p className="service-purpose">在本机生成角色、场景和分镜图像</p><p>{comfy.reason}</p><div className="service-actions"><button onClick={()=>setOpen(!open)} aria-expanded={open}>{open?'收起配置':'配置 ComfyUI'}</button><button disabled={busy} onClick={()=>void refresh()}>检测本地连接</button></div>{open && <ComfyConfiguration onSaved={refresh} />}</section>
      <PackyCard rows={rows} refresh={refresh} />
    </div></div><div className="service-group"><h2>视频生成</h2><CompShareCard /></div>
    {error && <p role="alert">{error}</p>}
  </div>
}
function ComfyConfiguration({onSaved}:{onSaved:()=>Promise<void>}) {
  const [configuration,setConfiguration] = useState<ReturnType<typeof comfyConfigurationSchema.parse>|null>(null)
  const [message,setMessage] = useState(''), [busy,setBusy] = useState(false)
  useEffect(()=>{void service({op:'comfy.configuration'}).then(setConfiguration).catch(()=>setMessage('配置读取失败，请收起后重新打开。'))},[])
  const change = <K extends keyof ProviderSettings>(key:K,value:ProviderSettings[K])=>setConfiguration(c=>c && {...c,settings:{...c.settings,[key]:value}})
  return <form className="settings-form service-config" aria-label="ComfyUI 配置" onSubmit={e=>{e.preventDefault();if(!configuration)return;setBusy(true);setMessage('');void service({op:'comfy.save',settings:configuration.settings}).then(async c=>{setConfiguration(c);setMessage('服务配置已保存并生效。下方状态来自实际连接检测。');await onSaved()}).catch(()=>setMessage('保存失败：请使用本机服务地址，选择内置模板；等待图像任务结束或预览过期后重试。')).finally(()=>setBusy(false))}}>
    <p>先启动本机 ComfyUI，填写地址和已安装的模型。保存后应用立即使用此连接。</p>
    {configuration && <><label>本地服务地址<input required value={configuration.settings.baseUrl} onChange={e=>change('baseUrl',e.target.value)} /></label><label>图像模型<input required value={configuration.settings.checkpoint} onChange={e=>change('checkpoint',e.target.value)} placeholder="填写 ComfyUI 中已安装的模型文件名" /></label><label>制作模板<select value={configuration.settings.templateId} onChange={e=>change('templateId',e.target.value)}>{configuration.templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <details><summary>专业图像参数</summary><div className="settings-field-row">{(['steps','cfg'] as const).map(key=><label key={key}>{key==='steps'?'采样步数':'提示词强度（CFG）'}<input type="number" min={key==='steps'?1:0} max={key==='steps'?150:30} step={key==='steps'?1:0.5} value={configuration.settings[key]} onChange={e=>change(key,Number(e.target.value))} /></label>)}</div><details><summary>查看内置制作模板</summary><pre>{JSON.stringify(configuration.templates.find(t=>t.id===configuration.settings.templateId)?.workflow,null,2)}</pre></details></details>
    <button className="primary" disabled={busy}>{busy?'保存并检测中…':'保存并检测连接'}</button></>}{message && <p role="status">{message}</p>}
  </form>
}
function PackyCard({rows,refresh}:{rows:Readiness;refresh:()=>Promise<void>}) {
  const registered = rows.find(row=>row.name.startsWith('PackyAPI'))
  const configured = registered?.runtime==='configured-unverified' ? registered : undefined
  const [busy,setBusy] = useState(false),[message,setMessage] = useState(''),[checked,setChecked] = useState(false)
  const run = async (probe:boolean) => {
    setBusy(true);setMessage('')
    try {
      if(probe && configured) {
        const report = imageConnectivitySchema.parse(await imageCommand({op:'probe',toolId:configured.toolId}))
        setChecked(report.authentication==='accepted')
        setMessage(report.authentication==='accepted'?'连接检测通过。真实生成仍受独立验收门禁限制。':'连接检测未通过。请检查密钥、模型权限和网络后重试。')
      } else { await imageCommand({op:'importProfile'}); await refresh();setChecked(false);setMessage('导入流程已结束。请根据卡片状态确认是否保存成功。') }
    } catch {setChecked(false);setMessage('操作未完成，请检查配置格式、密钥和网络后重试。')}
    finally {setBusy(false)}
  }
  return <section className="service-card" aria-label="Packy Image 服务"><div className="service-card-top"><span className="service-symbol peach">✧</span><span className="service-state">{checked?'连接检测通过':configured?'密钥已保存':registered?'密钥不可用':'尚未配置'}</span></div><h3>Packy Image</h3><p className="service-purpose">通过云端服务生成图像</p><p>暂不可用于普通真实生成。已有接入保留独立验收门禁；保存密钥或检测通过不会开放生成。</p><div className="service-actions"><button disabled={busy || Boolean(registered)} onClick={()=>void run(false)}>导入图像服务配置</button><button disabled={busy || !configured} onClick={()=>void run(true)}>检测图像连接</button></div>{registered && !configured && <p>原配置已保留，但本机密钥不可用。当前版本不支持替换已有配置，请在高级连接诊断中检查，不要删除用户数据。</p>}<details><summary>配置导入说明</summary><p>选择服务配置文件，再选择仅含密钥的本地文本文件。密钥由主进程加密保存，不会显示在页面上。</p></details>{message && <p role="status">{message}</p>}</section>
}
function CompShareCard() {
  const [configured,setConfigured] = useState(false),[importAllowed,setImportAllowed] = useState(false),[loaded,setLoaded] = useState(false),[open,setOpen] = useState(false),[busy,setBusy] = useState(false),[message,setMessage] = useState('')
  const [probe,setProbe] = useState<ReturnType<typeof compshareProbeSchema.parse>|null>(null)
  useEffect(()=>{void h3({op:'configuration'}).then(result=>{const configuration=compshareConfigurationSchema.parse(result);setConfigured(configuration.configured);setImportAllowed(configuration.importAllowed ?? !configuration.configured);setLoaded(true)}).catch(()=>setMessage('读取密钥状态失败，请重新打开设置。'))},[])
  const run = async (importKey:boolean) => {
    setBusy(true);setMessage('')
    try {
      if(importKey){await h3({op:'importCredential'});const configuration=compshareConfigurationSchema.parse(await h3({op:'configuration'}));const saved=configuration.configured;setImportAllowed(configuration.importAllowed ?? !saved);setConfigured(saved);setProbe(null);setMessage(saved?'密钥已加密保存。请检测连接。':'已取消导入，未保存密钥。')}
      else {const report=compshareProbeSchema.parse(await h3({op:'probe'}));setProbe(report);setMessage(report.authenticated?'连接检测通过。暂不可用于真实生成。':'连接检测未通过：请检查密钥是否有效、网络是否可达，再重试。')}
    } catch {setProbe(null);setMessage('操作未完成，请检查密钥文件或网络后重试。')}
    finally{setBusy(false)}
  }
  return <section className="service-card" aria-label="CompShare H3 非付费接入"><div className="service-card-top"><span className="service-symbol violet">▷</span><span className="service-state">{loaded?(!configured && !importAllowed?'密钥不可用':h3Status(configured,probe?.authenticated)):'读取状态中…'}</span></div><h3>CompShare · MiniMax H3</h3><p className="service-purpose">视频服务连接与只读积分查询</p><p>暂不可用于真实生成。检测只查询鉴权与积分，不提交视频任务、不上传素材、不消费积分。</p><div className="service-actions"><button onClick={()=>setOpen(!open)} aria-expanded={open}>{open?'收起密钥配置':'配置视频连接'}</button><button disabled={!configured || busy} onClick={()=>void run(false)}>检测视频连接（只读）</button></div>{open && <div className="service-config"><p>{configured?'密钥已保存':'请选择只含 API Key 的本地文本文件。密钥会加密保存在这台电脑，不显示在页面中。'}</p><button disabled={!loaded || busy || !importAllowed} onClick={()=>void run(true)}>导入 CompShare API Key（加密保存）</button>{loaded && !configured && !importAllowed && <p>原配置已保留，但本机密钥不可用。当前版本不支持替换已有配置，请在高级连接诊断中检查，不要删除用户数据。</p>}{configured && <p>已有密钥无需重复导入。请保管原始密钥文件，连接检测不会显示或导出密钥。</p>}</div>}{message && <p role="status">{message}</p>}{probe?.authenticated && probe.points && <p>可用积分：{probe.points.available}。积分不足不会自动充值或触发生成。</p>}{probe && <details><summary>检测详情</summary><p>检测时间：{probe.checkedAt}；诊断代码：{probe.errorCode ?? '无'}；真实生成关闭。</p></details>}</section>
}
