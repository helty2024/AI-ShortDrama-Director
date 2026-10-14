import { _electron as electron, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAlphaJourney, closeDetails } from '../tests/fixtures/alpha-journey.js'
import { runSettingsAudit } from '../tests/fixtures/settings-audit.js'
import { workspaceSchema, projectSchema } from '../src/shared/domain.js'
import { z } from 'zod'
import { aboutSchema } from '../src/shared/operations.js'

const [executable, dataArg, reportArg] = process.argv.slice(2)
if (!executable || !dataArg || !reportArg) throw new Error('Usage: tsx scripts/verify-alpha.ts <installed-exe> <isolated-data> <report>')
const root = resolve(tmpdir(), 'ai-shortdrama-director-release-tests')
const data = resolve(dataArg), report = resolve(reportArg)
for (const target of [data, report]) {
  const scope = relative(root, target)
  if (!scope || scope.startsWith('..') || isAbsolute(scope)) throw new Error('Acceptance output must stay within release test temp root')
}
await mkdir(data, { recursive: true })
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), DIRECTOR_TEST_USER_DATA: data, DIRECTOR_RELEASE_VALIDATION: '0.7.0-rc' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let app = await electron.launch({ executablePath: resolve(executable), env })
try {
  const pageErrors:string[] = []
  let page = await app.firstWindow()
  page.on('pageerror',error=>pageErrors.push(error.message))
  const about = await page.evaluate(() => window.desktop!.workspace.request({ action: 'operations', command: { operation: 'about' } }))
  if (!about.ok) throw new Error(about.message)
  const details = aboutSchema.parse(about.data)
  expect(details.version).toBe('0.9.0-alpha.2')
  expect(details.ffmpeg).not.toMatch(/^Not available/)
  expect(details.ffprobe).not.toMatch(/^Not available/)
  const before = await page.evaluate(() => window.desktop!.workspace.request({ action:'projects.list' }))
  if (!before.ok) throw new Error(before.message)
  const existing = z.array(projectSchema).parse(before.data)
  const snapshots = await Promise.all(existing.map(async project => {
    const result = await page.evaluate(id=>window.desktop!.workspace.request({action:'workspace.get',id}),project.id)
    if(!result.ok)throw new Error(result.message)
    return workspaceSchema.parse(result.data)
  }))
  const settingsAudit = await runSettingsAudit(app, join(resolve(report, '..'), 'screenshots'))
  const journey = await runAlphaJourney(app, data, join(resolve(report, '..'), 'screenshots'))
  await page.getByRole('navigation',{name:'次级导航'}).getByRole('button',{name:'设置',exact:true}).click()
  await page.getByRole('tab',{name:'基本设置',exact:true}).click()
  await page.getByLabel('画面风格',{exact:true}).fill('Alpha 验收：自然光')
  await page.getByRole('button',{name:'保存项目偏好'}).click()
  await expect(page.getByRole('tabpanel').getByRole('status')).toHaveText('项目偏好已保存')
  await page.screenshot({path:join(resolve(report,'..'),'screenshots','settings-basic-project.png')})
  await page.getByRole('tab',{name:'高级与诊断',exact:true}).click()
  await page.getByRole('button',{name:'测试工具',exact:true}).click()
  await page.getByText('旧版模拟与项目图像参数',{exact:true}).click()
  await page.getByRole('button',{name:'新增兼容视频配置',exact:true}).click()
  await page.getByLabel('配置名称',{exact:true}).fill('安装版模拟测试')
  await page.getByRole('combobox',{name:/视频服务类型/}).selectOption('mock-video')
  await page.getByRole('button',{name:'保存视频配置',exact:true}).click()
  await expect(page.locator('.production-settings').getByRole('status')).toContainText('视频配置已保存')
  await page.getByRole('button',{name:'检测视频连接',exact:true}).click()
  await expect(page.locator('.production-settings').getByRole('status')).toContainText('Mock Video Ready')
  await page.screenshot({path:join(resolve(report,'..'),'screenshots','settings-project-test-tools.png'),fullPage:true})
  await app.close()
  app = await electron.launch({ executablePath: resolve(executable), env })
  page = await app.firstWindow()
  page.on('pageerror',error=>pageErrors.push(error.message))
  await expect(page.getByRole('navigation', { name: '创作阶段' })).toBeVisible()
  await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜视频', exact: true }).click()
  await closeDetails(page)
  await expect(page.getByRole('region', { name: '镜头视频播放器' })).toContainText('当前确认视频')
  await expect.poll(() => page.locator('.shot-videos-screen video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  for (const previous of snapshots) {
    const current = await page.evaluate(id=>window.desktop!.workspace.request({action:'workspace.get',id}),previous.project.id)
    if(!current.ok)throw new Error(current.message)
    expect(workspaceSchema.parse(current.data)).toEqual(previous)
  }
  await page.getByRole('navigation',{name:'次级导航'}).getByRole('button',{name:'设置',exact:true}).click()
  await page.getByRole('button',{name:'配置 ComfyUI'}).click()
  await expect(page.getByLabel('本地服务地址',{exact:true})).toHaveValue('http://127.0.0.1:1')
  await expect(page.getByLabel('图像模型',{exact:true})).toHaveValue('acceptance.safetensors')
  await page.getByRole('tab',{name:'基本设置',exact:true}).click()
  await expect(page.getByLabel('画面风格',{exact:true})).toHaveValue('Alpha 验收：自然光')
  expect(pageErrors).toEqual([])
  await writeFile(report, JSON.stringify({ settingsAudit, existingProjectsPreserved:snapshots.length, existingAlphaData:'PASS', version: details.version, schema: details.schema, installedJourney: 'PASS', restart: 'PASS', fixtureVideo: 'PASS', realVideoSubmit: 'disabled', ...journey }, null, 2) + '\n')
  console.log('Installed Alpha journey and restart: PASS')
} finally { await app.close() }
