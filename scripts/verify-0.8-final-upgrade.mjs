// Installed-package acceptance only; all fixtures and reports stay in isolated OS temp data.
import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'

const [mode, exe, data, fixtures, report, expectedVersion] = process.argv.slice(2)
if (!['seed', 'check'].includes(mode) || !exe || !data || !fixtures || !report || !expectedVersion)
  throw new Error('Usage: node scripts/verify-0.8-final-upgrade.mjs <seed|check> <installed-exe> <isolated-userData> <fixture-root> <report> <expected-version>')
const root = resolve(tmpdir(), 'ai-shortdrama-director-release-tests')
const userData = resolve(data), fixtureRoot = resolve(fixtures), reportPath = resolve(report)
for (const target of [userData, fixtureRoot, reportPath]) {
  const scope = relative(root, target)
  if (!scope || scope.startsWith('..') || isAbsolute(scope)) throw new Error('Path outside dedicated release-test temp root')
}
const env = { ...process.env, DIRECTOR_TEXT_PROVIDER: 'mock', DIRECTOR_RELEASE_VALIDATION: '0.7.0-rc', DIRECTOR_TEST_USER_DATA: userData, DIRECTOR_TEST_VIDEO_ORIGIN: 'http://127.0.0.1:9' }
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'DIRECTOR_TEXT_API_KEY']) delete env[key]
const application = await electron.launch({ executablePath: resolve(exe), cwd: join(process.env.SystemRoot, 'System32'), env })
const result = { mode, success: false }
const request = async (page, input) => {
  const reply = await page.evaluate((value) => window.desktop.workspace.request(value), input)
  assert.equal(reply.ok, true, JSON.stringify(reply))
  return reply.data
}
try {
  const page = await application.firstWindow()
  await page.waitForLoadState('load')
  await page.setViewportSize({ width: 2560, height: 1440 })
  assert.equal(await application.evaluate(({ app }) => app.isPackaged), true)
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), userData)
  result.about = await request(page, { action: 'operations', command: { operation: 'about' } })
  assert.equal(result.about.version, expectedVersion)
  assert.equal(result.about.schema, expectedVersion === '0.7.0' ? 9 : 10)
  if (mode === 'seed') {
    const project = await request(page, { action: 'projects.create', input: { name: `${expectedVersion} 正式升级验收`, description: '保留原项目与 confirmed 视频', genre: '悬疑', aspectRatio: '9:16', language: 'zh-CN' } })
    const create = (kind, name, extras = {}) => request(page, { action: 'entities.createDraft', input: { projectId: project.id, kind, name, ...extras } })
    const script = await create('script', '剧本')
    const episode = await create('episode', '第一集', { parentId: script.id })
    const scene = await create('scene', '车站', { parentId: episode.id })
    const board = await create('storyboard', '分镜', { parentId: episode.id })
    const shot = await create('shot', '初遇', { parentId: board.id, sceneId: scene.id })
    const character = await create('character', '阿青')
    await create('location', '雨夜车站'); await create('prop', '旧信')
    const imagePath = join(fixtureRoot, 'reference.png')
    await writeFile(imagePath, await sharp({ create: { width: 256, height: 256, channels: 3, background: '#607e9b' } }).png().toBuffer())
    const pick = (path) => application.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, path)
    await pick(imagePath)
    await request(page, { action: 'visual', command: { operation: 'asset.import', projectId: project.id, assetId: null, targetId: character.id } })
    const videoPath = join(fixtureRoot, 'confirmed.mp4')
    execFileSync(process.env.DIRECTOR_FFMPEG || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=256x256:r=24', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { windowsHide: true, stdio: 'ignore' })
    await pick(videoPath)
    const version = await request(page, { action: 'production', command: { operation: 'video.import', projectId: project.id } })
    await request(page, { action: 'visual', command: { operation: 'version.review', projectId: project.id, id: version.id, expectedRevision: version.revision, status: 'approved', targetId: shot.id, targetRevision: shot.revision } })
    if (expectedVersion !== '0.7.0') {
      const current = await request(page, { action: 'projects.open', id: project.id })
      await request(page, { action: 'projects.update', input: { id: project.id, expectedRevision: current.revision, changes: { logline: 'RC 概念必须保留', style: '写实', worldview: '临海小城', creativeRequirements: '连续性' } } })
    }
    result.workspace = await request(page, { action: 'workspace.get', id: project.id })
    result.versions = (await request(page, { action: 'visual', command: { operation: 'snapshot', projectId: project.id } })).versions
    result.confirmedId = version.id
  } else {
    const baseline = JSON.parse(await readFile(join(fixtureRoot, 'seed.json'), 'utf8'))
    assert.equal(baseline.success, true)
    const id = baseline.workspace.project.id
    const workspace = await request(page, { action: 'workspace.get', id })
    for (const [key, value] of Object.entries(baseline.workspace.project)) assert.deepEqual(workspace.project[key], value, key)
    for (const entity of baseline.workspace.entities) {
      const current = workspace.entities.find((item) => item.id === entity.id)
      assert.ok(current, entity.id)
      for (const [key, value] of Object.entries(entity)) assert.deepEqual(current[key], value, `${entity.kind}.${key}`)
    }
    const snapshot = await request(page, { action: 'visual', command: { operation: 'snapshot', projectId: id } })
    for (const version of baseline.versions) assert.deepEqual(snapshot.versions.find((item) => item.id === version.id), version)
    assert.ok(workspace.entities.some((item) => item.kind === 'shot' && item.confirmedVideoAssetVersionId === baseline.confirmedId))
    result.videoProfiles = await request(page, { action: 'videoApi', command: { op: 'profiles' } })
    assert.deepEqual(result.videoProfiles, [])
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    // RC can restore its last opened project instead of showing the project list.
    if (await nav.count() === 0) await page.getByRole('button', { name: '打开项目' }).first().click()
    for (const name of ['故事', '剧本', '资产', '分镜', '生成', '分镜视频']) {
      await nav.getByRole('button', { name, exact: true }).click()
      await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    }
    const video = page.locator('.shot-video-player video')
    await expect(video).toHaveCount(1)
    await expect.poll(() => video.evaluate((element) => element.readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2)
    assert.ok(await video.evaluate((element) => element.duration > 0 && !element.error))
    await video.evaluate((element) => element.play())
    await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0)
    result.confirmedPlayback = true
    await request(page, { action: 'visual', command: { operation: 'settings.save', projectId: id, settings: { ...snapshot.settings, provider: 'comfyui', baseUrl: 'http://127.0.0.1:9' } } })
    result.comfyOffline = await request(page, { action: 'production', command: { operation: 'diagnostics', projectId: id } })
    assert.equal(result.comfyOffline.ready, false); assert.equal(result.comfyOffline.reachable, false)
    assert.ok(result.comfyOffline.errors.length > 0)
    await request(page, { action: 'visual', command: { operation: 'settings.save', projectId: id, settings: snapshot.settings } })
    result.preserved = true
  }
  result.success = true
} finally {
  await application.close()
  const db = new DatabaseSync(join(userData, 'workspace.sqlite'), { readOnly: true })
  try { result.schema = Number(db.prepare('PRAGMA user_version').get().user_version) } finally { db.close() }
  await writeFile(reportPath, JSON.stringify(result, null, 2))
}
console.log(JSON.stringify({ mode, success: result.success, schema: result.schema }))
