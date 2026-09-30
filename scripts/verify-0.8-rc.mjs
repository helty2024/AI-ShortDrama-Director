import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

const [mode, executableArg, userDataArg, fixtureRootArg, reportArg] = process.argv.slice(2)
if (!mode || !executableArg || !userDataArg || !fixtureRootArg || !reportArg)
  throw new Error('Usage: node scripts/verify-0.8-rc.mjs <seed07|fresh08|upgrade08|restore08|retained08> <installed-exe> <isolated-userData> <fixture-root> <report>')
const root = resolve(tmpdir(), 'ai-shortdrama-director-release-tests')
const userData = resolve(userDataArg)
const fixtureRoot = resolve(fixtureRootArg)
for (const target of [userData, fixtureRoot]) {
  const scope = relative(root, target)
  if (!scope || scope.startsWith('..') || isAbsolute(scope)) throw new Error('Path must be within dedicated release-test temp root')
}
const executablePath = resolve(executableArg)
const reportPath = resolve(reportArg)
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.ELECTRON_RENDERER_URL
delete environment.DIRECTOR_TEXT_API_KEY
environment.DIRECTOR_TEXT_PROVIDER = 'mock'
environment.DIRECTOR_RELEASE_VALIDATION = '0.7.0-rc' // Existing packaged isolation guard; never used by a normal launch.
environment.DIRECTOR_TEST_USER_DATA = userData
environment.DIRECTOR_TEST_VIDEO_ORIGIN = 'http://127.0.0.1:9' // Packaged guard must ignore this.
environment.DIRECTOR_TEST_IMAGE_ORIGIN = 'http://127.0.0.1:9'
const launch = () => electron.launch({ executablePath, cwd: join(process.env.SystemRoot, 'System32'), env: environment })
const request = async (page, value) => {
  const result = await page.evaluate((input) => window.desktop.workspace.request(input), value)
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.data
}
const about = (page) => request(page, { action: 'operations', command: { operation: 'about' } })
const databaseFacts = () => {
  const db = new DatabaseSync(join(userData, 'workspace.sqlite'), { readOnly: true, allowExtension: false })
  try {
    return { schema: Number(db.prepare('PRAGMA user_version').get()?.user_version), projects: Number(db.prepare('SELECT count(*) AS n FROM projects').get()?.n), assets: Number(db.prepare('SELECT count(*) AS n FROM asset_versions').get()?.n) }
  } finally { db.close() }
}
const result = { mode, executablePath, userData, success: false }
let application
try {
  application = await launch()
  let page = await application.firstWindow()
  await page.waitForLoadState('load')
  assert.equal(await application.evaluate(({ app }) => app.isPackaged), true)
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), userData)
  const info = await about(page)
  result.about = info
  assert.equal(info.version, mode === 'seed07' ? '0.7.0' : '0.8.0-rc.1')
  assert.equal(info.schema, mode === 'seed07' ? 9 : 10)

  if (mode === 'seed07') {
    const project = await request(page, { action: 'projects.create', input: { name: '0.7 升级验收', description: 'RC 保留原故事梗概', genre: '悬疑', aspectRatio: '9:16', language: 'zh-CN' } })
    const create = (kind, name, extras = {}) => request(page, { action: 'entities.createDraft', input: { projectId: project.id, kind, name, ...extras } })
    const script = await create('script', '第一季')
    const episode = await create('episode', '第一集', { parentId: script.id })
    const scene = await create('scene', '车站重逢', { parentId: episode.id })
    const character = await create('character', '阿青')
    await create('location', '雨夜车站')
    await create('prop', '旧信')
    const board = await create('storyboard', '分镜表', { parentId: episode.id })
    await create('shot', '初遇', { parentId: board.id, sceneId: scene.id })
    const imagePath = join(fixtureRoot, 'upgrade-reference.png')
    await writeFile(imagePath, await sharp({ create: { width: 256, height: 256, channels: 3, background: '#607e9b' } }).png().toBuffer())
    await application.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, imagePath)
    const imported = await request(page, { action: 'visual', command: { operation: 'asset.import', projectId: project.id, assetId: null, targetId: character.id } })
    assert.ok(imported.length > 0)
    const workspace = await request(page, { action: 'workspace.get', id: project.id })
    result.project = workspace.project
    result.counts = Object.fromEntries(['script', 'episode', 'scene', 'character', 'location', 'prop', 'storyboard', 'shot', 'asset'].map((kind) => [kind, workspace.entities.filter((e) => e.kind === kind).length]))
    result.versionIds = (await request(page, { action: 'visual', command: { operation: 'snapshot', projectId: project.id } })).versions.map((v) => v.id)
    await application.close(); application = undefined
    result.database = databaseFacts()
    assert.equal(result.database.schema, 9)
  } else if (mode === 'fresh08') {
    await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('RC 全新安装项目')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const project = await request(page, { action: 'projects.list' })
    result.project = project.find((item) => item.name === 'RC 全新安装项目')
    assert.ok(result.project)
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    await expect(page.getByRole('region', { name: '故事编辑器' })).toBeVisible()
    await page.getByRole('textbox', { name: '一句话概念' }).fill('雨夜车站的一封旧信')
    await expect(page.getByRole('status')).toHaveText('已保存到本地')
    await nav.getByRole('button', { name: '剧本', exact: true }).click()
    const create = async (button, name, parent) => {
      await page.getByRole('button', { name: button, exact: true }).click()
      const form = page.getByRole('dialog')
      await form.getByLabel('名称').fill(name)
      if (parent) await form.getByLabel(parent).selectOption({ index: 1 })
      await form.getByRole('button', { name: '保存', exact: true }).click()
      await expect(form.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
    }
    await create('新建剧本', 'RC 剧本')
    await create('新建分集', '第一集', '所属剧本')
    await create('新建场次', '车站', '所属分集')
    await nav.getByRole('button', { name: '资产', exact: true }).click()
    await create('创建第一个角色', '阿青')
    await page.locator('.creator-asset-card').first().click()
    const imagePath = join(fixtureRoot, 'fresh-reference.png')
    await writeFile(imagePath, await sharp({ create: { width: 256, height: 256, channels: 3, background: '#758a9f' } }).png().toBuffer())
    await application.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, imagePath)
    const workspace = await request(page, { action: 'workspace.get', id: result.project.id })
    const character = workspace.entities.find((item) => item.kind === 'character')
    assert.ok(character)
    const imported = await request(page, { action: 'visual', command: { operation: 'asset.import', projectId: result.project.id, assetId: null, targetId: character.id } })
    assert.equal(imported.length, 1)
    await nav.getByRole('button', { name: '分镜', exact: true }).click()
    await create('新增第一个镜头', '初遇', '所属场次')
    await expect(page.locator('.storyboard-shot-card')).toHaveCount(1)
    for (const name of ['生成', '分镜视频']) {
      await nav.getByRole('button', { name, exact: true }).click()
      await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    }
    result.creatorJourney = true
    result.videoProfiles = await request(page, { action: 'videoApi', command: { op: 'profiles' } })
    assert.deepEqual(result.videoProfiles, [])
    await application.close(); application = undefined
    result.database = databaseFacts(); assert.equal(result.database.schema, 10)
    application = await launch(); page = await application.firstWindow(); await page.waitForLoadState('load')
    assert.equal((await request(page, { action: 'projects.open', id: result.project.id })).id, result.project.id)
    result.restart = true
  } else if (mode === 'upgrade08') {
    const baseline = JSON.parse(await readFile(join(fixtureRoot, 'seed07.json'), 'utf8'))
    const workspace = await request(page, { action: 'workspace.get', id: baseline.project.id })
    assert.equal(workspace.project.id, baseline.project.id)
    for (const field of ['name', 'description', 'genre', 'aspectRatio', 'language', 'revision', 'createdAt', 'updatedAt']) assert.equal(workspace.project[field], baseline.project[field], field)
    for (const field of ['logline', 'style', 'worldview', 'creativeRequirements']) assert.equal(workspace.project[field], '', field)
    result.counts = Object.fromEntries(Object.keys(baseline.counts).map((kind) => [kind, workspace.entities.filter((e) => e.kind === kind).length]))
    assert.deepEqual(result.counts, baseline.counts)
    const versions = (await request(page, { action: 'visual', command: { operation: 'snapshot', projectId: workspace.project.id } })).versions
    assert.ok(baseline.versionIds.every((id) => versions.some((version) => version.id === id)))
    result.project = workspace.project
    result.videoProfiles = await request(page, { action: 'videoApi', command: { op: 'profiles' } })
    assert.deepEqual(result.videoProfiles, [])
    await page.getByRole('button', { name: '打开项目' }).first().click()
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    await mkdir(join(fixtureRoot, 'visual'), { recursive: true })
    for (const width of [2560, 1920]) {
      await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1080 })
      for (const [name, slug] of [['分镜', 'Storyboard'], ['生成', 'Generate'], ['分镜视频', 'ShotVideos']]) {
        await nav.getByRole('button', { name, exact: true }).click()
        await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
        await page.screenshot({ path: join(fixtureRoot, 'visual', `${slug}-${width}.png`) })
      }
    }
    for (const name of ['故事', '剧本', '资产']) await nav.getByRole('button', { name, exact: true }).click()
    await application.close(); application = undefined
    result.database = databaseFacts(); assert.equal(result.database.schema, 10)
    application = await launch(); page = await application.firstWindow(); await page.waitForLoadState('load')
    const again = await request(page, { action: 'workspace.get', id: baseline.project.id })
    for (const field of ['revision', 'updatedAt']) assert.equal(again.project[field], baseline.project[field], field)
    result.idempotent = true
  } else if (mode === 'restore08') {
    const fixtures = JSON.parse(await readFile(join(fixtureRoot, 'fixtures.json'), 'utf8'))
    const projects = await request(page, { action: 'projects.list' })
    assert.ok(projects.length > 0)
    const storyFields = { logline: 'RC 备份一句话概念', style: '悬疑写实', worldview: '临海小城', creativeRequirements: '保持角色连续性' }
    const backupSource = await request(page, { action: 'projects.update', input: { id: projects[0].id, expectedRevision: projects[0].revision, changes: storyFields } })
    const sourceWorkspace = await request(page, { action: 'workspace.get', id: backupSource.id })
    const sourceCharacter = sourceWorkspace.entities.find((entity) => entity.kind === 'character')
    assert.ok(sourceCharacter)
    assert.equal(sourceCharacter.visualReferences.length, 1)
    const sourceShot = sourceWorkspace.entities.find((entity) => entity.kind === 'shot')
    assert.ok(sourceShot)
    const imagePath = join(fixtureRoot, 'restore-keyframe.png')
    await writeFile(imagePath, await sharp({ create: { width: 256, height: 256, channels: 3, background: '#516477' } }).png().toBuffer())
    await application.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, imagePath)
    const [keyframeAssetId] = await request(page, { action: 'visual', command: { operation: 'asset.import', projectId: backupSource.id, assetId: null, targetId: sourceShot.id } })
    const keyframe = (await request(page, { action: 'visual', command: { operation: 'snapshot', projectId: backupSource.id } })).versions.find((version) => version.assetId === keyframeAssetId)
    assert.ok(keyframe)
    await request(page, { action: 'visual', command: { operation: 'version.review', projectId: backupSource.id, id: keyframe.id, expectedRevision: keyframe.revision, status: 'approved', targetId: sourceShot.id, targetRevision: sourceShot.revision } })
    const backupBase = join(fixtureRoot, 'backups')
    await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, backupBase)
    const format5 = await request(page, { action: 'operations', command: { operation: 'backup', projectId: backupSource.id } })
    const manifest5 = JSON.parse(await readFile(join(format5, 'manifest.json'), 'utf8'))
    assert.equal(manifest5.format, 5); assert.equal(manifest5.schema, 10)
    result.restores = []
    for (const entry of [...fixtures.backups, { format: 5, schema: 10, folder: format5 }]) {
      await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, entry.folder)
      const restored = await request(page, { action: 'operations', command: { operation: 'restore' } })
      if (entry.format === 5) {
        for (const [field, value] of Object.entries(storyFields)) assert.equal(restored[field], value)
        const restoredWorkspace = await request(page, { action: 'workspace.get', id: restored.id })
        const restoredCharacter = restoredWorkspace.entities.find((entity) => entity.kind === 'character')
        assert.ok(restoredCharacter)
        assert.deepEqual(restoredCharacter.visualReferences.map((ref) => ({ role: ref.role, primary: ref.primary })), sourceCharacter.visualReferences.map((ref) => ({ role: ref.role, primary: ref.primary })))
        const restoredShot = restoredWorkspace.entities.find((entity) => entity.kind === 'shot')
        assert.ok(restoredShot?.approvedKeyframeVersionId)
        const restoredVersions = (await request(page, { action: 'visual', command: { operation: 'snapshot', projectId: restored.id } })).versions
        assert.ok(restoredVersions.some((version) => version.id === restoredShot.approvedKeyframeVersionId && version.status === 'approved'))
      }
      const snapshot = await request(page, { action: 'visual', command: { operation: 'snapshot', projectId: restored.id } })
      const workflows = await request(page, { action: 'workflow', command: { op: 'listWorkflowRuns', projectId: restored.id } })
      assert.ok(snapshot.versions.length > 0 || entry.format === 5)
      assert.ok(workflows.every((run) => run.executionAllowed === false))
      result.restores.push({ format: entry.format, schema: entry.schema, projectId: restored.id, versions: snapshot.versions.length, workflows: workflows.length })
    }
    await application.close(); application = undefined
    result.database = databaseFacts(); assert.equal(result.database.schema, 10)
  } else if (mode === 'retained08') {
    const prior = JSON.parse(await readFile(join(fixtureRoot, 'fresh08.json'), 'utf8'))
    assert.equal((await request(page, { action: 'projects.open', id: prior.project.id })).id, prior.project.id)
    result.database = databaseFacts(); assert.equal(result.database.schema, 10)
    result.retained = true
  } else throw new Error(`Unknown mode ${mode}`)
  result.success = true
} finally {
  if (application) await application.close()
  await writeFile(reportPath, JSON.stringify(result, null, 2))
}
console.log(JSON.stringify({ mode, success: result.success }))
