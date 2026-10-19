import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aiServicesSnapshotSchema } from '../src/shared/ai-services.js'
import { createAlphaStory, createAlphaShot } from './fixtures/alpha-journey.js'

async function launch(root:string) {
  const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((v):v is [string,string]=>v[1]!==undefined))
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  Object.assign(env,{DIRECTOR_TEST_USER_DATA:root,DIRECTOR_TEXT_PROVIDER:'mock',DIRECTOR_DISABLE_ALPHA_FIXTURE:'0'})
  return electron.launch({args:['.'],env})
}
test('Production settings manage shared encrypted text config, default, key replacement and restart without Mock fallback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-production-settings-'));let app=await launch(root)
  try{
    let page=await app.firstWindow()
    expect((await page.evaluate(()=>window.desktop!.workspace.request({action:'serviceSettings',command:{op:'ai.mode',mode:'production',confirmed:true}}))).ok).toBe(true)
    await page.getByRole('button',{name:'设置',exact:true}).click()
    for(const name of ['文本 AI','图像 AI','视频 AI','本地生成服务'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible()
    await expect(page.locator('table')).toHaveCount(0)
    await page.getByRole('button',{name:'添加文本 AI服务'}).click()
    const dialog=page.getByRole('dialog',{name:'AI 服务配置'})
    await dialog.getByLabel('服务名称',{exact:true}).fill('公司文本服务')
    await dialog.getByLabel('API 地址',{exact:true}).fill('https://fixture.example/v1')
    await dialog.getByLabel('模型名称',{exact:true}).fill('fixture-model')
    await dialog.getByLabel('API Key',{exact:true}).fill('sk-ml-FIXTURE_ONLY')
    await dialog.getByRole('button',{name:'保存服务',exact:true}).click();await expect(dialog).toHaveCount(0)
    const card=page.getByRole('region',{name:'公司文本服务',exact:true})
    await expect(card).toContainText('密钥已加密保存');await expect(card).toContainText('尚未通过真实生成验收')
    await card.getByRole('button',{name:'设为默认',exact:true}).click();await expect(card).toContainText('默认服务')
    const catalog=await readFile(join(root,'ai-services.json'),'utf8');expect(catalog).not.toContain('sk-ml-')
    const encrypted=await readdir(join(root,'credentials'));expect(encrypted).toHaveLength(1)
    expect((await readFile(join(root,'credentials',encrypted[0]!))).includes(Buffer.from('sk-ml-FIXTURE_ONLY'))).toBe(false)
    await app.close();app=await launch(root);page=await app.firstWindow();await page.getByRole('button',{name:'设置',exact:true}).click()
    await expect(page.getByRole('region',{name:'公司文本服务',exact:true})).toContainText('默认服务')
    const response=await page.evaluate(()=>window.desktop!.workspace.request({action:'serviceSettings',command:{op:'ai.list'}}))
    if(!response.ok)throw new Error(response.message)
    expect(aiServicesSnapshotSchema.parse(response.data).mode).toBe('production')
    const images=await page.evaluate(()=>window.desktop!.workspace.request({action:'imageApi',command:{op:'profiles'}}));expect(JSON.stringify(images)).not.toContain('alpha.reference')
    await page.getByRole('region',{name:'公司文本服务',exact:true}).getByRole('button',{name:'设置',exact:true}).click()
    await page.getByRole('dialog').getByLabel('API Key',{exact:true}).fill('sk-ml-FIXTURE_ONLY')
    await page.getByRole('dialog').getByRole('button',{name:'保存服务',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await readdir(join(root,'credentials'))).length).toBe(2)
  }finally{await app.close();await rm(root,{recursive:true,force:true})}
})
test('Production mode with no configured services refuses Story AI without creating a simulated import',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-production-unconfigured-'));const app=await launch(root)
  try{
    const page=await app.firstWindow()
    await page.evaluate(()=>window.desktop!.workspace.request({action:'serviceSettings',command:{op:'ai.mode',mode:'production',confirmed:true}}))
    await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('dialog').getByLabel('名称',{exact:true}).fill('真实制作未配置');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click()
    await page.getByLabel('故事梗概',{exact:true}).fill('雨夜，阿青在车站拾起旧信。')
    page.on('dialog',dialog=>void dialog.accept())
    await page.getByRole('button',{name:'AI 整理',exact:true}).click()
    await expect(page.getByRole('alert')).toContainText('请先连接 AI 服务')
    const id=await page.getByRole('combobox',{name:'切换项目'}).inputValue()
    const result=await page.evaluate(projectId=>window.desktop!.workspace.request({action:'intelligence',command:{operation:'snapshot',projectId}}),id)
    expect(JSON.stringify(result)).toContain('text-unconfigured');expect(JSON.stringify(result)).toContain('"imports":[]')
  }finally{await app.close();await rm(root,{recursive:true,force:true})}
})
test('Project context inspector cannot cover production settings after viewport changes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'director-production-overlay-'));const app=await launch(root)
  try{
    const page=await app.firstWindow();await page.evaluate(()=>window.desktop!.workspace.request({action:'serviceSettings',command:{op:'ai.mode',mode:'production',confirmed:true}}))
    await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('dialog').getByLabel('名称',{exact:true}).fill('设置布局验证');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click()
    await page.setViewportSize({width:2560,height:1440})
    await page.getByRole('button',{name:'切换检查器'}).click();await expect(page.locator('.creator-inspector')).toBeVisible()
    await page.getByRole('navigation',{name:'次级导航'}).getByRole('button',{name:'设置',exact:true}).click()
    for(const size of [{width:2560,height:1440},{width:1920,height:1080}]){
      await page.setViewportSize(size);await expect(page.locator('.creator-inspector')).toHaveCount(0)
      await page.getByRole('button',{name:'添加图像 AI服务'}).click();await expect(page.getByRole('dialog',{name:'AI 服务配置'})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
    }
  }finally{await app.close();await rm(root,{recursive:true,force:true})}
})

test('Text templates configure an explicit output mode and preserve it across restart without claiming a connection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-text-template-'))
  let app = await launch(root)
  try {
    let page = await app.firstWindow()
    expect((await page.evaluate(() => window.desktop!.workspace.request({ action: 'serviceSettings', command: { op: 'ai.mode', mode: 'production', confirmed: true } }))).ok).toBe(true)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '添加文本 AI服务' }).click()
    let dialog = page.getByRole('dialog', { name: 'AI 服务配置' })
    await dialog.getByLabel('模型名称', { exact: true }).fill('old-model')
    await dialog.getByLabel('选择服务模板').selectOption('deepseek')
    await expect(dialog.getByLabel('API 地址', { exact: true })).toHaveValue('https://api.deepseek.com/v1')
    await expect(dialog.getByLabel('模型名称', { exact: true })).toHaveValue('')
    await dialog.getByLabel('模型名称', { exact: true }).fill('fixture-model')
    await dialog.getByText('模型兼容设置', { exact: true }).click()
    await expect(dialog.getByLabel('输出兼容方式')).toHaveValue('json-object')
    await mkdir('test-results/localminidrama-study', { recursive: true })
    for (const size of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
      await page.setViewportSize(size)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `test-results/localminidrama-study/text-template-${size.width}.png` })
    }
    await dialog.getByRole('button', { name: '保存服务', exact: true }).click()
    const card = page.getByRole('region', { name: 'DeepSeek', exact: true })
    await expect(card).toContainText('尚未检测')
    await expect(card).toContainText('下一步：在设置中保存密钥')
    await expect(card.getByRole('button', { name: '检测连接', exact: true })).toBeDisabled()
    await app.close()
    app = await launch(root)
    page = await app.firstWindow()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('region', { name: 'DeepSeek', exact: true }).getByRole('button', { name: '设置', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'AI 服务配置' })
    await dialog.getByText('模型兼容设置', { exact: true }).click()
    await expect(dialog.getByLabel('输出兼容方式')).toHaveValue('json-object')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('Storyboard export writes an offline handoff sheet through the system save picker and preserves data on cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-storyboard-export-'))
  const app = await launch(root)
  try {
    const page = await app.firstWindow()
    await createAlphaStory(page, '分镜交付验证')
    await createAlphaShot(page, '车站拾信')
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    await nav.getByRole('button', { name: '分镜', exact: true }).click()
    const external: string[] = []
    page.on('request', r => { if (r.url().startsWith('https://')) external.push(r.url()) })
    const file = join(root, 'storyboard.html')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, file)
    await page.getByRole('button', { name: '导出分镜表', exact: true }).click()
    await expect(page.getByRole('region', { name: '分镜工作区', exact: true }).getByRole('status')).toContainText('分镜表已导出，共 1 个镜头')
    const html = await readFile(file, 'utf8')
    expect(html).toContain('车站拾信')
    expect(html).toContain('当前导出范围：1 个镜头')
    expect(html).toContain('待确认')
    expect(html).not.toContain('<script')
    expect(external).toEqual([])
    await mkdir('test-results/localminidrama-study', { recursive: true })
    await import('node:fs/promises').then(fs => fs.copyFile(file, 'test-results/localminidrama-study/example-storyboard.html'))
    await page.screenshot({ path: 'test-results/localminidrama-study/storyboard-export.png' })
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
    await page.getByRole('button', { name: '导出分镜表', exact: true }).click()
    await expect(page.getByRole('region', { name: '分镜工作区', exact: true }).getByRole('status')).toContainText('已取消导出')
    expect(await readFile(file, 'utf8')).toBe(html)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
