import { expect, type ElectronApplication } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function runSettingsAudit(app: ElectronApplication, captures: string) {
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(captures, { recursive: true })
  await expect(page.getByRole('button', {name:'设置',exact:true})).toBeVisible()
  const back = page.getByRole('button', { name:'返回项目列表' })
  if(await back.count()) await back.click()
  await page.getByRole('button', { name:'设置',exact:true }).click()
  for (const name of ['基本设置','AI 服务','高级与诊断']) await expect(page.getByRole('tab',{name,exact:true})).toBeVisible()
  await expect(page.getByRole('tab',{name:'AI 服务',exact:true})).toHaveAttribute('aria-selected','true')
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page.getByText(/Validation Status|Runtime Status|Capabilities|Mock|Reference|GenerationRecord/)).toHaveCount(0)
  await expect(page.getByRole('region',{name:'CompShare H3 非付费接入'})).toContainText('暂不可用于真实生成')
  await expect(page.getByRole('region',{name:'Packy Image 服务'})).toContainText('暂不可用于普通真实生成')
  await expect(page.getByRole('region',{name:'ComfyUI 服务'}).locator('.service-state')).not.toHaveText('检测中…')
  for(const size of [{width:1920,height:1080},{width:2560,height:1440}]) {
    await page.setViewportSize(size)
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const cards=await page.locator('.service-card').first().boundingBox()
    expect(cards?.width).toBeGreaterThan(350)
    const cardBottom = await page.locator('.service-card').last().boundingBox()
    expect(cardBottom!.y + cardBottom!.height).toBeLessThan(size.height)
    await page.screenshot({path:join(captures,`settings-${size.width}.png`),fullPage:true})
  }
  await page.getByRole('region',{name:'ComfyUI 服务'}).getByRole('button',{name:'配置 ComfyUI'}).click()
  await expect(page.getByLabel('本地服务地址',{exact:true})).toBeVisible()
  await expect(page.getByLabel('图像模型',{exact:true})).toBeVisible()
  await page.getByLabel('本地服务地址',{exact:true}).fill('http://127.0.0.1:1')
  await page.getByLabel('图像模型',{exact:true}).fill('acceptance.safetensors')
  await page.getByRole('button',{name:'保存并检测连接',exact:true}).click()
  await expect(page.getByRole('region',{name:'ComfyUI 服务'}).getByRole('status')).toContainText('服务配置已保存并生效')
  await expect(page.getByRole('region',{name:'ComfyUI 服务'})).toContainText('未连接本地服务')
  await page.screenshot({path:join(captures,'settings-comfy-offline.png'),fullPage:true})
  await page.getByRole('button',{name:'收起配置',exact:true}).click()
  const h3=page.getByRole('region',{name:'CompShare H3 非付费接入'})
  await h3.getByRole('button',{name:'配置视频连接'}).click()
  await expect(h3.getByRole('button',{name:'导入 CompShare API Key（加密保存）'})).toBeVisible()
  await expect(h3.getByRole('button',{name:/生成/})).toHaveCount(0)
  if(await h3.getByRole('button',{name:'检测视频连接（只读）'}).isEnabled()) {
    await h3.getByRole('button',{name:'检测视频连接（只读）'}).click()
    await expect(h3.getByRole('status')).toContainText(/连接检测通过|连接检测未通过|操作未完成/,{timeout:20000})
    await page.screenshot({path:join(captures,'settings-h3-readonly.png'),fullPage:true})
  }
  const packy = page.getByRole('region',{name:'Packy Image 服务'})
  if(await packy.getByRole('button',{name:'检测图像连接'}).isEnabled()) {
    await packy.getByRole('button',{name:'检测图像连接'}).click()
    await expect(packy.getByRole('status')).toContainText(/连接检测通过|连接检测未通过|操作未完成/,{timeout:25000})
    await page.screenshot({path:join(captures,'settings-packy-readonly.png'),fullPage:true})
  }
  const h3State = await h3.locator('.service-state').innerText()
  await page.getByRole('tab',{name:'基本设置',exact:true}).click()
  if(await page.getByLabel('画面风格',{exact:true}).count()) await expect(page.getByLabel('画面风格',{exact:true})).toBeVisible()
  else await expect(page.getByText(/请先返回项目列表/)).toBeVisible()
  await page.getByRole('tab',{name:'高级与诊断',exact:true}).click()
  await page.getByRole('button',{name:'测试工具',exact:true}).click()
  await expect(page.getByRole('region',{name:'测试工具'})).toContainText('用于模拟流程测试')
  await page.screenshot({path:join(captures,'settings-test-tools.png'),fullPage:true})
  await page.getByRole('button',{name:'连接诊断',exact:true}).click()
  await expect(page.getByRole('table')).toBeVisible()
  await page.screenshot({path:join(captures,'settings-advanced.png'),fullPage:true})
  const projectBack=page.getByRole('button',{name:'返回项目列表',exact:true})
  if(await projectBack.count()) await projectBack.click()
  else await page.getByRole('button',{name:'返回项目',exact:true}).click()
  expect(errors).toEqual([])
  return {h3ReadOnlyState:h3State,settings:'PASS',resolutions:['1920x1080','2560x1440'],comfyOffline:'PASS',noProject:'PASS',advanced:'PASS'}
}
