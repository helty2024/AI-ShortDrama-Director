import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAlphaJourney, createAlphaStory, createAlphaShot, closeDetails, confirmAlpha } from './fixtures/alpha-journey.js'
import { videoServer } from './fixtures/video-http.js'
import { workspaceSchema } from '../src/shared/domain.js'

async function launch(root: string, mode: 'alpha' | 'unavailable' = 'alpha', videoOrigin?: string) {
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'DIRECTOR_TEST_IMAGE_ORIGIN', 'DIRECTOR_TEST_VIDEO_ORIGIN']) delete env[key]
  env.DIRECTOR_TEST_USER_DATA = root
  env.DIRECTOR_DISABLE_ALPHA_FIXTURE = mode === 'alpha' ? '0' : '1'
  env.DIRECTOR_TEXT_PROVIDER = 'mock'
  if (videoOrigin) env.DIRECTOR_TEST_VIDEO_ORIGIN = videoOrigin
  return electron.launch({ args: ['.'], env })
}

test('Alpha fresh project follows every visible stage to confirmed test video and retains lineage after restart', async () => {
  test.setTimeout(120000)
  const root = await mkdtemp(join(tmpdir(), 'director-alpha-journey-'))
  let app = await launch(root)
  try {
    const result = await runAlphaJourney(app, root, 'test-results/alpha-journey')
    await app.close()
    app = await launch(root)
    const page = await app.firstWindow()
    await expect(page.getByRole('navigation', { name: '创作阶段' })).toBeVisible()
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜视频', exact: true }).click()
    await closeDetails(page)
    await expect(page.getByRole('region', { name: '镜头视频播放器' })).toContainText('当前确认视频')
    const saved = await page.evaluate(id => window.desktop!.workspace.request({ action: 'workspace.get', id }), result.projectId)
    if (!saved.ok) throw new Error(saved.message)
    expect(workspaceSchema.parse(saved.data).entities.find(item => item.kind === 'shot')?.confirmedVideoAssetVersionId).toBe(result.versionId)
    expect(JSON.parse(await readFile(join(root, 'alpha-reference/reference-tasks.json'), 'utf8'))).toHaveLength(1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('Alpha empty project shows next steps and unavailable services offer readable recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-alpha-empty-'))
  const app = await launch(root, 'unavailable')
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill('空项目')
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: 'AI 整理' })).toBeDisabled()
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    await nav.getByRole('button', { name: '生成', exact: true }).click()
    await expect(page.getByRole('heading', { name: '还没有镜头，先做一张分镜' })).toBeVisible()
    await expect(page.getByRole('button', { name: '前往分镜' })).toBeVisible()
    await nav.getByRole('button', { name: '故事', exact: true }).click()
    await page.getByLabel('故事梗概', { exact: true }).fill('场景1 外景 车站 夜\n人物：阿青\n阿青捡起旧信。')
    await expect(page.locator('.save-state')).toHaveText('已保存到本地')
    await page.getByRole('button', { name: 'AI 整理' }).click()
    await page.getByRole('region', { name: '故事整理预览' }).getByRole('button', { name: '确认导入正式剧本' }).click()
    await createAlphaShot(page, '服务检测镜头')
    await page.getByRole('button', { name: '前往生成' }).click()
    await closeDetails(page)
    await page.getByRole('button', { name: '开始生成 1 个镜头' }).click()
    await expect(page.getByRole('alert').getByText(/服务不可用/)).toBeVisible({ timeout: 15000 })
    await page.getByRole('tab', { name: '镜头视频' }).click()
    await expect(page.getByText('尚未配置可用的视频生成工具')).toBeVisible()
    await expect(page.getByRole('button', { name: '前往项目设置' })).toBeVisible()
    await expect(page.getByText(/unknown-submission|configured-unverified|routing failed/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '开始生成 1 个镜头' })).toHaveCount(0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('Alpha generation failure remains a readable failure and cannot produce or adopt a video', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-alpha-failure-'))
  const server = await videoServer('failed')
  const app = await launch(root, 'unavailable', server.origin)
  try {
    const page = await app.firstWindow()
    await createAlphaStory(page, '失败路径')
    await createAlphaShot(page, '失败镜头')
    await page.getByRole('button', { name: '前往生成' }).click()
    await closeDetails(page)
    await page.getByRole('tab', { name: '镜头视频' }).click()
    await page.getByRole('radio', { name: '文生视频' }).check()
    await page.getByRole('button', { name: '开始生成 1 个镜头' }).click()
    const dialog = page.getByRole('dialog', { name: '确认生成' })
    await dialog.getByRole('textbox', { name: '单次费用上限' }).fill('0.01')
    await dialog.getByRole('checkbox', { name: /允许费用未知/ }).check()
    await dialog.getByRole('checkbox', { name: /我确认本次/ }).check()
    await dialog.getByRole('button', { name: '确认生成', exact: true }).click()
    await expect(page.locator('.generate-current-task')).toContainText('生成失败', { timeout: 30000 })
    await expect(page.locator('.generate-current-task')).toContainText('重试')
    await expect(page.locator('.generate-candidate-main')).toHaveCount(0)
    expect(server.counts.submit).toBe(1)
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜视频', exact: true }).click()
    await closeDetails(page)
    await expect(page.getByText('尚未确认当前镜头视频')).toBeVisible()
  } finally { await app.close(); await server.close(); await rm(root, { recursive: true, force: true }) }
})

test('Alpha multi-shot queue prepares separate decisions and never auto-submits or auto-adopts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-alpha-queue-'))
  const app = await launch(root)
  try {
    const page = await app.firstWindow()
    await createAlphaStory(page, '双镜头队列')
    await createAlphaShot(page, '镜头一')
    await createAlphaShot(page, '镜头二')
    await page.getByRole('button', { name: '前往生成' }).click()
    await closeDetails(page)
    for (const name of ['镜头一', '镜头二']) await page.getByRole('checkbox', { name: `选择镜头 ${name}` }).check()
    await page.getByRole('button', { name: '开始生成 2 个镜头' }).click()
    await confirmAlpha(page)
    await expect(page.locator('.generate-candidate-main')).toBeVisible({ timeout: 30000 })
    await page.locator('.generate-candidate-main').getByRole('button', { name: '批准', exact: true }).click()
    await page.locator('.generate-candidate-main').getByRole('button', { name: '设为镜头关键帧' }).click()
    await page.locator('.generate-queue-shot').filter({ hasText: '镜头二' }).click()
    await closeDetails(page)
    await expect(page.getByRole('dialog', { name: '确认生成' })).toBeVisible()
    const id = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
    const runs = await page.evaluate(projectId => window.desktop!.workspace.request({ action: 'workflow', command: { op: 'listWorkflowRuns', projectId } }), id)
    expect(runs.ok && Array.isArray(runs.data) && runs.data.length).toBe(2)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('Alpha pending video prevents project deletion until the active submission is settled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-alpha-pending-'))
  const server = await videoServer('always-running')
  const app = await launch(root, 'unavailable', server.origin)
  try {
    const page = await app.firstWindow()
    await createAlphaStory(page, '删除保护')
    await createAlphaShot(page, '进行中镜头')
    await page.getByRole('button', { name: '前往生成' }).click()
    await closeDetails(page)
    await page.getByRole('tab', { name: '镜头视频' }).click()
    await page.getByRole('radio', { name: '文生视频' }).check()
    await page.getByRole('button', { name: '开始生成 1 个镜头' }).click()
    const dialog = page.getByRole('dialog', { name: '确认生成' })
    await dialog.getByRole('textbox', { name: '单次费用上限' }).fill('0.01')
    await dialog.getByRole('checkbox', { name: /允许费用未知/ }).check()
    await dialog.getByRole('checkbox', { name: /我确认本次/ }).check()
    await dialog.getByRole('button', { name: '确认生成', exact: true }).click()
    const id = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
    const result = await page.evaluate(projectId => window.desktop!.workspace.request({ action: 'projects.delete', id: projectId }), id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('等待')
    expect(server.counts.submit).toBe(1)
  } finally { await app.close(); await server.close(); await rm(root, { recursive: true, force: true }) }
})
