// Explicit opt-in: creates two validation projects in the real Windows userData.
// Run after installation; shortcut and uninstall checks are separate OS checks.
import { _electron as electron, expect } from '@playwright/test'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const executablePath = process.argv[2]
if (!executablePath)
  throw new Error('Usage: node scripts/verify-packaged.mjs <installed exe>')
const output = resolve('release')
await mkdir(output, { recursive: true })
const env = { ...process.env, DIRECTOR_TEXT_PROVIDER: 'mock' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
delete env.DIRECTOR_TEST_USER_DATA
const report = { date: new Date().toISOString(), executablePath, checks: [] }
const launch = () =>
  electron.launch({
    executablePath,
    cwd: join(process.env.SystemRoot, 'System32'),
    env,
  })
const request = async (page, value) => {
  const result = await page.evaluate(
    (input) => window.desktop.workspace.request(input),
    value,
  )
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.data
}
let application
try {
  application = await launch()
  let page = await application.firstWindow()
  await expect(
    page.getByRole('button', { name: '新建项目', exact: true }),
  ).toBeEnabled()
  const name = `Windows 安装验证 ${Date.now()}`
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('名称', { exact: true }).fill(name)
  await page
    .getByLabel('简介', { exact: true })
    .fill('安装后的真实数据持久化验证，可手动删除此测试项目。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  report.project = (await request(page, { action: 'projects.list' })).find(
    (p) => p.name === name,
  )
  assert.ok(report.project)
  report.checks.push('Project created through UI')
  report.about = await request(page, {
    action: 'operations',
    command: { operation: 'about' },
  })
  assert.equal(report.about.version, '0.6.0')
  await page.getByRole('button', { name: '验收与维护', exact: true }).click()
  await page
    .getByRole('button', { name: 'About / 检查环境', exact: true })
    .click()
  await expect(page.getByText('0.6.0', { exact: true })).toBeVisible()
  await page.screenshot({
    path: join(output, 'installed-about.png'),
    fullPage: true,
  })
  report.checks.push('About UI shows 0.6.0')
  await application.close()
  application = undefined
  application = await launch()
  page = await application.firstWindow()
  assert.ok(
    (await request(page, { action: 'projects.list' })).some(
      (p) => p.id === report.project.id,
    ),
  )
  report.runtime = await application.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
    versions: process.versions,
    preferences: Object.fromEntries(
      ['sandbox', 'contextIsolation', 'nodeIntegration'].map((k) => [
        k,
        BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()[k],
      ]),
    ),
  }))
  assert.equal(report.runtime.packaged, true)
  assert.deepEqual(report.runtime.preferences, {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  })
  report.checks.push(
    'Restart from System32 preserves project; sandbox and isolation enabled',
  )
  const project = await request(page, {
    action: 'operations',
    command: { operation: 'validation.create' },
  })
  report.mockProjectId = project.id
  const workspace = await request(page, {
    action: 'workspace.get',
    id: project.id,
  })
  const shot = workspace.entities.find((e) => e.kind === 'shot')
  const visual = (command) =>
    request(page, {
      action: 'visual',
      command: { projectId: project.id, ...command },
    })
  report.visualConfiguration = await visual({ operation: 'snapshot' })
  report.productionConfiguration = await request(page, {
    action: 'production',
    command: { operation: 'snapshot', projectId: project.id },
  })
  await visual({ operation: 'compile', targetId: shot.id, previousShot: false })
  await visual({
    operation: 'generate',
    targetId: shot.id,
    assetId: null,
    provider: 'mock-image',
    positivePrompt: null,
    negativePrompt: null,
    previousShot: false,
  })
  await expect
    .poll(
      async () => (await visual({ operation: 'snapshot' })).versions.length,
      { timeout: 30000 },
    )
    .toBeGreaterThan(0)
  const snapshot = await visual({ operation: 'snapshot' })
  report.mockVersion = snapshot.versions[0]
  report.checks.push(
    'Bundled workflow and Prompt Compiler read; Mock image generated using packaged Sharp',
  )
  await application.close()
  application = undefined
  const noMediaEnv = { ...env, PATH: join(process.env.SystemRoot, 'System32') }
  delete noMediaEnv.DIRECTOR_FFMPEG
  delete noMediaEnv.DIRECTOR_FFPROBE
  application = await electron.launch({
    executablePath,
    cwd: join(process.env.SystemRoot, 'System32'),
    env: noMediaEnv,
  })
  page = await application.firstWindow()
  await expect(
    page.getByRole('alert').filter({ hasText: '未检测到 ffmpeg、ffprobe' }),
  ).toBeVisible({ timeout: 15000 })
  assert.ok(
    (await request(page, { action: 'projects.list' })).some(
      (p) => p.id === report.project.id,
    ),
  )
  await page.screenshot({
    path: join(output, 'missing-ffmpeg.png'),
    fullPage: true,
  })
  report.checks.push(
    'Without FFmpeg/FFprobe application remains usable and shows startup guidance',
  )
  report.success = true
} finally {
  if (application) await application.close()
  await writeFile(
    join(output, 'windows-validation.json'),
    JSON.stringify(report, null, 2),
  )
}
console.log(
  JSON.stringify({ success: report.success, checks: report.checks }, null, 2),
)
