import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { comfyServer } from './fixtures/comfyui-http.js'
import { runSettingsAudit } from './fixtures/settings-audit.js'
import { createAlphaStory } from './fixtures/alpha-journey.js'

async function launch(root:string) {
  const env:Record<string,string> = Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined))
  for(const key of ['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL','DIRECTOR_TEST_IMAGE_ORIGIN','DIRECTOR_TEST_VIDEO_ORIGIN']) delete env[key]
  Object.assign(env,{DIRECTOR_TEST_USER_DATA:root,DIRECTOR_DISABLE_ALPHA_FIXTURE:'0',DIRECTOR_TEXT_PROVIDER:'mock'})
  return electron.launch({args:['.'],env})
}
test('Settings three entrances, default technical isolation, no-project actions, advanced tools and both desktop layouts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-settings-audit-'));const app=await launch(root)
  try {await runSettingsAudit(app,'test-results/settings-audit')} finally {await app.close();await rm(root,{recursive:true,force:true})}
})
test('Global Comfy save changes active adapter, detects real HTTP readiness and persists after restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-settings-comfy-'));const server=await comfyServer();let app=await launch(root)
  try {
    let page=await app.firstWindow();await page.getByRole('button',{name:'设置',exact:true}).click()
    await page.getByRole('button',{name:'配置 ComfyUI'}).click()
    await page.getByLabel('本地服务地址',{exact:true}).fill(server.origin);await page.getByLabel('图像模型',{exact:true}).fill('fixture.safetensors')
    await page.getByRole('button',{name:'保存并检测连接',exact:true}).click()
    await expect(page.getByRole('region',{name:'ComfyUI 服务'}).locator('.service-state')).toHaveText('可用')
    expect(server.counts.objectInfo).toBeGreaterThan(0);expect(server.counts.submit).toBe(0)
    await app.close();app=await launch(root);page=await app.firstWindow()
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'配置 ComfyUI'}).click()
    await expect(page.getByLabel('本地服务地址',{exact:true})).toHaveValue(server.origin)
    await expect(page.getByLabel('图像模型',{exact:true})).toHaveValue('fixture.safetensors')
    await expect(page.getByRole('region',{name:'ComfyUI 服务'}).locator('.service-state')).toHaveText('可用')
  } finally {await app.close();await server.close();await rm(root,{recursive:true,force:true})}
})
test('Comfy reachable service with missing model cannot appear usable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-settings-model-'));const server=await comfyServer('missing-model');const app=await launch(root)
  try {
    const page=await app.firstWindow();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'配置 ComfyUI'}).click()
    await page.getByLabel('本地服务地址',{exact:true}).fill(server.origin);await page.getByLabel('图像模型',{exact:true}).fill('fixture.safetensors')
    await page.getByRole('button',{name:'保存并检测连接',exact:true}).click()
    await expect(page.getByRole('region',{name:'ComfyUI 服务'}).locator('.service-state')).toHaveText('需要配置')
    expect(server.counts.submit).toBe(0)
  } finally {await app.close();await server.close();await rm(root,{recursive:true,force:true})}
})
test('Changing Comfy connection cannot alter a pending reviewed generation preview',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-settings-frozen-'));const server=await comfyServer();const app=await launch(root)
  try {
    const page=await app.firstWindow();await createAlphaStory(page,'冻结配置验收')
    const result=await page.evaluate(async origin=>{
      const projectId=(document.querySelector('[aria-label="切换项目"]') as HTMLSelectElement).value
      const snapshot=await window.desktop!.workspace.request({action:'visual',command:{operation:'snapshot',projectId}})
      if(!snapshot.ok || !snapshot.data || typeof snapshot.data!=='object' || !('settings' in snapshot.data))throw new Error('snapshot')
      const settings=snapshot.data.settings as import('../src/shared/visual.js').ProviderSettings
      const saved=await window.desktop!.workspace.request({action:'serviceSettings',command:{op:'comfy.save',settings:{...settings,provider:'comfyui',baseUrl:origin,checkpoint:'fixture.safetensors'}}})
      if(!saved.ok)throw new Error(saved.message)
      const entity=await window.desktop!.workspace.request({action:'entities.createDraft',input:{projectId,kind:'character',name:'冻结角色'}})
      if(!entity.ok || !entity.data || typeof entity.data!=='object' || !('id' in entity.data))throw new Error('entity')
      const preview=await window.desktop!.workspace.request({action:'imageApi',command:{op:'preview',input:{projectId,targetId:String(entity.data.id),toolId:'comfyui.local',routingMode:'fixed',resolution:{width:512,height:512},aspectRatio:'1:1',count:1,references:[],allowAssetUpload:false,localOnly:true}}})
      if(!preview.ok)throw new Error(preview.message)
      return window.desktop!.workspace.request({action:'serviceSettings',command:{op:'comfy.save',settings:{...settings,provider:'comfyui',baseUrl:origin,checkpoint:'changed.safetensors'}}})
    },server.origin)
    expect(result).toMatchObject({ok:false,code:'CONFLICT'})
    expect(JSON.parse(await readFile(join(root,'comfyui-service-settings.json'),'utf8')).checkpoint).toBe('fixture.safetensors')
    expect(server.counts.submit).toBe(0)
  } finally {await app.close();await server.close();await rm(root,{recursive:true,force:true})}
})
test('H3 UI import encrypts fixture key, reloads saved state, and missing credential probe reports failure without video',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-settings-h3-'));const keyFile=join(root,'fixture-key.txt');await writeFile(keyFile,'sk-ml-FIXTURE_ONLY');let app=await launch(root)
  try {
    let page=await app.firstWindow();await page.getByRole('button',{name:'设置',exact:true}).click();let panel=page.getByRole('region',{name:'CompShare H3 非付费接入'})
    await panel.getByRole('button',{name:'配置视频连接'}).click()
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},keyFile)
    await panel.getByRole('button',{name:'导入 CompShare API Key（加密保存）'}).click()
    await expect(panel.locator('.service-state')).toHaveText('密钥已保存')
    const files=await readdir(join(root,'credentials'));expect(files).toHaveLength(1)
    expect((await readFile(join(root,'credentials',files[0]!))).includes(Buffer.from('sk-ml-FIXTURE_ONLY'))).toBe(false)
    expect(await readFile(join(root,'compshare-minimax-h3-profile.json'),'utf8')).not.toContain('sk-ml-')
    await app.close();app=await launch(root);page=await app.firstWindow();await page.getByRole('button',{name:'设置',exact:true}).click();panel=page.getByRole('region',{name:'CompShare H3 非付费接入'})
    await expect(panel.locator('.service-state')).toHaveText('密钥已保存')
    // Only a credential created by this test is removed, to exercise the real safe-storage failure path.
    await rm(join(root,'credentials',files[0]!))
    await panel.getByRole('button',{name:'检测视频连接（只读）'}).click()
    await expect(panel.getByRole('status')).toContainText('连接检测未通过')
    await expect(panel.getByText(/暂不可用于真实生成/)).toBeVisible()
    const profiles=await page.evaluate(()=>window.desktop!.workspace.request({action:'videoApi',command:{op:'profiles'}}))
    expect(JSON.stringify(profiles)).not.toContain('compshare.minimax-h3')
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})
test('Packy import cancellation and invalid native profile yield actual outcomes, never a fake connected state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-settings-packy-'));const app=await launch(root)
  try {
    const page=await app.firstWindow();await page.getByRole('button',{name:'设置',exact:true}).click();const panel=page.getByRole('region',{name:'Packy Image 服务'})
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]})})
    await panel.getByRole('button',{name:'导入图像服务配置'}).click();await expect(panel.locator('.service-state')).toHaveText('尚未配置')
    const path=join(root,'invalid-profile.json');await writeFile(path,'{}');await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path)
    await panel.getByRole('button',{name:'导入图像服务配置'}).click();await expect(panel.getByRole('status')).toContainText('操作未完成')
    await expect(panel.getByRole('button',{name:'检测图像连接'})).toBeDisabled()
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})
test('Project preferences persist and professional settings remain editable only through explicit advanced entry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-settings-project-'));const app=await launch(root)
  try {
    const page=await app.firstWindow();await createAlphaStory(page,'项目偏好验收')
    await page.getByRole('navigation',{name:'次级导航'}).getByRole('button',{name:'设置',exact:true}).click()
    await page.getByRole('tab',{name:'基本设置',exact:true}).click();await page.getByLabel('画面风格',{exact:true}).fill('暖色自然光')
    await page.getByRole('button',{name:'保存项目偏好'}).click();await expect(page.getByRole('tabpanel').getByRole('status')).toHaveText('项目偏好已保存')
    await page.getByRole('tab',{name:'AI 服务',exact:true}).click();await page.getByRole('tab',{name:'基本设置',exact:true}).click()
    await expect(page.getByLabel('画面风格',{exact:true})).toHaveValue('暖色自然光')
    await page.getByRole('tab',{name:'高级与诊断',exact:true}).click();await page.getByRole('button',{name:'项目专业配置',exact:true}).click()
    await expect(page.getByRole('heading',{name:'项目生产诊断'})).toBeVisible()
    await expect(page.getByRole('option',{name:/Mock/})).toHaveCount(0)
    await page.getByRole('button',{name:'测试工具',exact:true}).click();await page.getByText('旧版模拟与项目图像参数',{exact:true}).click()
    await expect(page.getByRole('button',{name:'导入 workflow JSON'})).toBeVisible()
    await page.getByLabel('风格',{exact:true}).fill('旧版参数仍可保存');await page.getByRole('button',{name:'保存设置',exact:true}).click()
    await expect(page.locator('.provider-settings').getByRole('status')).toContainText('配置已保存')
    await page.getByRole('button',{name:'新增兼容视频配置',exact:true}).click()
    await page.getByLabel('配置名称',{exact:true}).fill('本地模拟测试')
    const videoType=page.getByRole('combobox',{name:/视频服务类型/})
    await videoType.selectOption('mock-video');await videoType.selectOption('seedance');await videoType.selectOption('mock-video')
    await page.getByRole('button',{name:'保存视频配置',exact:true}).click()
    await expect(page.locator('.production-settings').getByRole('status')).toContainText('视频配置已保存')
    await expect(videoType).toHaveValue('mock-video')
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})
