import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { workspaceSchema } from '../../src/shared/domain.js'
import { alphaVideoTool } from '../../src/shared/alpha.js'

export async function closeDetails(page: Page) {
  const close = page.getByRole('button', { name: '关闭检查器' })
  if (await close.count()) await close.click()
}

export async function createAlphaStory(page: Page, name: string) {
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill(name)
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今天，想讲一个什么故事？' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 整理', exact: true })).toBeDisabled()
  await page.getByLabel('故事梗概', { exact: true }).fill('第1集\n场景1 外景 车站 夜\n人物：阿青\n阿青捡起一封旧信。\n阿青：这是谁留下的？')
  await expect(page.locator('.save-state')).toHaveText('已保存到本地')
  await page.getByRole('button', { name: 'AI 整理', exact: true }).click()
  await expect(page.getByRole('region', { name: '故事整理预览' })).toBeVisible()
  await page.getByRole('region', { name: '故事整理预览' }).getByRole('button', { name: '确认导入正式剧本' }).click()
  await expect(page.getByRole('textbox', { name: '场次编号' })).toBeVisible()
}

export async function createAlphaShot(page: Page, name: string) {
  const nav = page.getByRole('navigation', { name: '创作阶段' })
  await nav.getByRole('button', { name: '分镜', exact: true }).click()
  await closeDetails(page)
  await page.getByRole('button', { name: '新增镜头', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByLabel('所属场次').selectOption({ index: 1 })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

export async function confirmAlpha(page: Page) {
  const dialog = page.getByRole('dialog', { name: '确认生成' })
  await expect(dialog.getByText(/测试视频 \/ 模拟生成/)).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: '单次费用上限' })).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: /我确认本次/ }).check()
  await dialog.getByRole('button', { name: '确认生成', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

export async function runAlphaJourney(application: ElectronApplication, data: string, captures: string) {
  const page = await application.firstWindow()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mkdir(captures, { recursive: true })
  await createAlphaStory(page, '公司 Alpha 全新项目')
  const nav = page.getByRole('navigation', { name: '创作阶段' })
  await nav.getByRole('button', { name: '故事', exact: true }).click()
  await page.screenshot({ path: join(captures, '01-story.png') })
  await nav.getByRole('button', { name: '剧本', exact: true }).click()
  await page.screenshot({ path: join(captures, '02-script.png') })
  await page.getByRole('button', { name: '查看角色与场景资产' }).click()
  for (const [tab, name] of [['角色', '阿青'], ['场景', '车站'], ['道具', '旧信']] as const) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click()
    await page.getByRole('button', { name: `创建第一个${tab}`, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('名称', { exact: true }).fill(name)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  await page.screenshot({ path: join(captures, '03-assets.png') })
  await page.getByRole('button', { name: '前往分镜' }).click()
  await createAlphaShot(page, '拾起旧信')
  await page.screenshot({ path: join(captures, '04-storyboard.png') })
  await page.getByRole('button', { name: '前往生成' }).click()
  await closeDetails(page)
  await expect(page.getByText('自动推荐 · 模拟生成')).toBeVisible()
  await page.screenshot({ path: join(captures, '05-generate.png') })
  await page.getByRole('button', { name: '开始生成 1 个镜头', exact: true }).click()
  await closeDetails(page)
  await confirmAlpha(page)
  await expect(page.locator('.generate-candidate-main')).toBeVisible({ timeout: 30000 })
  const projectId = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
  const workspace = async () => {
    const result = await page.evaluate(id => window.desktop!.workspace.request({ action: 'workspace.get', id }), projectId)
    if (!result.ok) throw new Error(result.message)
    return workspaceSchema.parse(result.data)
  }
  await page.locator('.generate-candidate-main').getByRole('button', { name: '批准', exact: true }).click()
  await expect(page.locator('.generate-candidate-main').getByRole('button', { name: '设为镜头关键帧' })).toBeVisible()
  expect((await workspace()).entities.find(item => item.kind === 'shot')?.approvedKeyframeVersionId).toBeNull()
  await page.locator('.generate-candidate-main').getByRole('button', { name: '设为镜头关键帧' }).click()
  await expect.poll(async () => (await workspace()).entities.find(item => item.kind === 'shot')?.approvedKeyframeVersionId).toBeTruthy()
  await page.getByRole('tab', { name: '镜头视频' }).click()
  await page.getByRole('button', { name: '开始生成 1 个镜头', exact: true }).click()
  await closeDetails(page)
  await confirmAlpha(page)
  await expect(page.locator('.generate-candidate-main').getByRole('button', { name: '批准', exact: true })).toBeVisible({ timeout: 30000 })
  await page.locator('.generate-candidate-main').getByRole('button', { name: '批准', exact: true }).click()
  await expect(page.locator('.generate-candidate-main').getByRole('button', { name: '设为当前镜头视频' })).toBeVisible()
  expect((await workspace()).entities.find(item => item.kind === 'shot')?.confirmedVideoAssetVersionId).toBeNull()
  await page.locator('.generate-candidate-main').getByRole('button', { name: '设为当前镜头视频' }).click()
  await expect.poll(async () => (await workspace()).entities.find(item => item.kind === 'shot')?.confirmedVideoAssetVersionId).toBeTruthy()
  await nav.getByRole('button', { name: '分镜视频', exact: true }).click()
  await closeDetails(page)
  await expect(page.getByRole('region', { name: '镜头视频播放器' })).toContainText('当前确认视频')
  await expect.poll(() => page.locator('.shot-videos-screen video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  await page.screenshot({ path: join(captures, '06-confirmed-video.png') })
  const result = await page.evaluate(id => window.desktop!.workspace.request({ action: 'visual', command: { operation: 'snapshot', projectId: id } }), projectId)
  if (!result.ok) throw new Error(result.message)
  const receipt = JSON.parse(await readFile(join(data, 'alpha-reference/reference-tasks.json'), 'utf8')) as unknown[]
  expect(receipt).toHaveLength(1)
  const saved = await workspace()
  const shot = saved.entities.find(item => item.kind === 'shot')!
  const provenance = await page.evaluate(({ id, versionId }) => window.desktop!.workspace.request({ action: 'compatibility', command: { op: 'lineage', projectId: id, versionId } }), { id: projectId, versionId: shot.confirmedVideoAssetVersionId! })
  expect(provenance.ok).toBe(true)
  expect(JSON.stringify(result.data)).toContain(alphaVideoTool)
  return { projectId, versionId: shot.confirmedVideoAssetVersionId!, receiptCount: receipt.length, lineageVerified: provenance.ok }
}
