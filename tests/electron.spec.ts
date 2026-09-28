import { imageServer } from './fixtures/image-http.js'
import { videoServer } from './fixtures/video-http.js'
import { createV6 } from './fixtures/provenance.js'
import { lineageSchema } from '../src/shared/compatibility.js'
import { ProjectDatabase, metadata } from '../electron/main/database.js'
import { IntelligenceRepository } from '../electron/main/intelligence/repository.js'
import { VisualRepository } from '../electron/main/visual/repository.js'
import { MediaStorage } from '../electron/main/visual/storage.js'
import { buildSeed } from '../electron/main/seed.js'
import { aiTaskSchema } from '../src/shared/intelligence.js'
import { assetVersionSchema } from '../src/shared/visual.js'
import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises'
import sharp from 'sharp'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Request } from '../src/shared/api.js'
import { workspaceSchema } from '../src/shared/domain.js'

test('Creator closeout fresh project completes Story to Shot Video journey without Legacy detour', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-creator-fresh-'))
  const server = await imageServer()
  const application = await launch(directory, server.origin)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    await mkdir('test-results/creator-closeout', { recursive: true })
    const capture = async (name: string) => page.screenshot({ path: `test-results/creator-closeout/${name}.png` })
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('全链路新项目')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('region', { name: '故事编辑器' })).toBeVisible()
    await page.getByRole('textbox', { name: '一句话概念' }).fill('一场误会改变三个人的命运')
    await page.getByRole('textbox', { name: '故事梗概' }).fill('雨夜车站的一封信引发重逢。')
    await page.getByRole('textbox', { name: '风格' }).fill('悬疑写实')
    await page.getByRole('textbox', { name: '世界观' }).fill('临海小城')
    await page.getByRole('textbox', { name: '创作要求' }).fill('每集留下悬念')
    await expect(page.getByRole('status')).toHaveText('已保存到本地')
    await capture('Story-2560')
    await page.getByRole('button', { name: '进入剧本' }).click()
    const create = async (button: string, name: string, parent?: string) => {
      await page.getByRole('button', { name: button, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('名称').fill(name)
      if (parent) await dialog.getByLabel(parent).selectOption({ index: 1 })
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    await create('新建剧本', '第一季')
    await create('新建分集', '第一集', '所属剧本')
    await create('新建场次', '雨夜车站', '所属分集')
    await page.getByRole('textbox', { name: '场次编号' }).fill('03')
    await page.getByRole('textbox', { name: '场景标题' }).fill('车站重逢')
    await expect(page.getByRole('status')).toHaveText('已保存到本地')
    await capture('Script-2560')
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    await nav.getByRole('button', { name: '资产', exact: true }).click()
    await create('创建第一个角色', '阿青')
    await page.getByRole('tab', { name: /场景/ }).click()
    await create('创建第一个场景', '车站')
    await page.getByRole('tab', { name: /道具/ }).click()
    await create('创建第一个道具', '旧信')
    await page.getByRole('tab', { name: /角色/ }).click()
    await page.locator('.creator-asset-card').first().click()
    const imagePath = join(directory, 'portrait.png')
    await writeFile(imagePath, await sharp({ create: { width: 480, height: 640, channels: 3, background: '#69869c' } }).png().toBuffer())
    await application.evaluate((electron, filePath) => { electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, imagePath)
    const inspector = page.getByRole('complementary', { name: '上下文检查器' })
    await inspector.getByRole('button', { name: '导入参考图' }).click()
    await expect(inspector.locator('.creator-candidate-thumb')).toHaveCount(1)
    await inspector.getByRole('button', { name: '批准', exact: true }).click()
    await expect(inspector.getByRole('button', { name: '设为主参考' })).toBeVisible()
    await expect(inspector.getByText('尚未设置主参考。', { exact: false })).toBeVisible()
    await inspector.getByRole('button', { name: '设为主参考' }).click()
    await expect(inspector.getByRole('heading', { name: '当前主参考' })).toBeVisible()
    await expect(page.locator('.creator-asset-card').first()).toContainText('已设置主参考')
    await expect(inspector.locator('.creator-source-details').first()).toHaveJSProperty('open', false)
    await capture('Assets-2560')
    await nav.getByRole('button', { name: '分镜', exact: true }).click()
    await page.getByRole('button', { name: '新增第一个镜头' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('名称').fill('初遇')
    await expect(dialog.getByLabel('所属场次')).toBeVisible()
    await dialog.getByLabel('所属场次').selectOption({ index: 1 })
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.storyboard-shot-card')).toHaveCount(1)
    await page.locator('.storyboard-shot-card').first().click()
    await inspector.getByRole('button', { name: '编辑分镜描述' }).click()
    await inspector.getByLabel('画面描述').fill('阿青在雨夜车站拾起旧信')
    await inspector.getByRole('button', { name: '保存镜头' }).click()
    await expect(page.locator('.storyboard-shot-card').first()).toContainText('阿青在雨夜车站拾起旧信')
    await capture('Storyboard-2560')
    await inspector.getByRole('button', { name: '去生成' }).click()
    await expect(page.getByRole('heading', { name: '生成依据' })).toBeVisible()
    await capture('Generate-Keyframe-2560')
    await page.getByRole('button', { name: '预览生成关键帧' }).click()
    const confirm = page.getByRole('dialog', { name: '确认生成' })
    await expect(confirm).toBeVisible()
    await confirm.getByText('高级生成 · 实际编译 Prompt').click()
    await expect(confirm.getByText('Compiler Version')).toBeVisible()
    await confirm.getByRole('textbox', { name: '单次费用上限' }).fill('0.01')
    await confirm.getByRole('checkbox', { name: /允许费用未知/ }).check()
    await confirm.getByRole('checkbox', { name: /我确认本次/ }).check()
    await confirm.getByRole('button', { name: '确认生成' }).click()
    await expect(page.locator('.generate-candidate-main')).toBeVisible({ timeout: 30000 })
    await page.locator('.generate-candidate-main').getByRole('button', { name: '批准' }).click()
    const projectId = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
    const currentShot = async () => {
      const result = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workspace.get', id }), projectId)
      if (!result.ok) throw new Error(result.message)
      return workspaceSchema.parse(result.data).entities.find((entity) => entity.kind === 'shot')
    }
    expect((await currentShot())?.kind === 'shot' && (await currentShot() as { approvedKeyframeVersionId: string | null }).approvedKeyframeVersionId).toBeNull()
    await page.locator('.generate-candidate-main').getByRole('button', { name: '设为镜头关键帧' }).click()
    expect((await currentShot())?.kind === 'shot' && (await currentShot() as { approvedKeyframeVersionId: string | null }).approvedKeyframeVersionId).toBeTruthy()
    await page.getByRole('tab', { name: '镜头视频' }).click()
    await expect(page.getByText('尚未配置可用的视频生成工具')).toBeVisible()
    await capture('Generate-Video-Unavailable-2560')
    await nav.getByRole('button', { name: '分镜', exact: true }).click()
    await expect(inspector.getByText('已确认', { exact: true })).toBeVisible()
    await nav.getByRole('button', { name: '分镜视频', exact: true }).click()
    await expect(page.getByText('尚未确认当前镜头视频')).toBeVisible()
    await capture('ShotVideos-2560')
    await page.setViewportSize({ width: 1920, height: 1080 })
    await expect(page.locator('.creator-nav')).toHaveClass(/is-collapsed/)
    await page.getByRole('button', { name: '关闭检查器' }).click()
    const mainWidth = await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)
    for (const [stage, name] of [
      ['故事', 'Story'], ['剧本', 'Script'], ['资产', 'Assets'],
      ['分镜', 'Storyboard'], ['生成', 'Generate'], ['分镜视频', 'ShotVideos']
    ] as const) {
      await nav.getByRole('button', { name: stage, exact: true }).click()
      await expect(nav.getByRole('button', { name: stage, exact: true })).toHaveAttribute('aria-current', 'page')
      if (stage === '资产') await page.locator('.creator-asset-card').first().click()
      else await page.getByRole('button', { name: '切换检查器' }).click()
      await expect(page.getByRole('dialog', { name: '上下文检查器' })).toBeVisible()
      expect(await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)).toBe(mainWidth)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await capture(`${name}-1920`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: '上下文检查器' })).toHaveCount(0)
    }
  } finally { await application.close(); await server.close(); await rm(directory, { recursive: true, force: true }) }
})

test('Creator context is isolated across projects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-creator-isolation-'))
  const db = new ProjectDatabase(join(directory, 'workspace.sqlite'))
  const projectA = db.seed(buildSeed)
  db.close()
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: '打开项目' }).first().click()
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    await nav.getByRole('button', { name: '剧本', exact: true }).click()
    await page.locator('.scene-tree-list > li > button').last().click()
    await expect(page.locator('.scene-tree-list > li > button').last()).toHaveAttribute('aria-current', 'true')
    await nav.getByRole('button', { name: '资产', exact: true }).click()
    await page.locator('.creator-asset-card').first().click()
    await expect(page.locator('.creator-asset-card').first()).toHaveAttribute('aria-pressed', 'true')
    await nav.getByRole('button', { name: '分镜', exact: true }).click()
    await page.locator('.storyboard-shot-card').last().click()
    await expect(page.locator('.storyboard-shot-card').last()).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '返回项目列表' }).click()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('隔离项目 B')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const projectB = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
    expect(projectB).not.toBe(projectA.id)
    await nav.getByRole('button', { name: '分镜', exact: true }).click()
    await expect(page.getByRole('heading', { name: '还没有分镜' })).toBeVisible()
    await expect(page.locator('.storyboard-shot-card')).toHaveCount(0)
    await nav.getByRole('button', { name: '资产', exact: true }).click()
    await expect(page.locator('.creator-asset-card')).toHaveCount(0)
    await nav.getByRole('button', { name: '剧本', exact: true }).click()
    await expect(page.locator('.scene-tree-list > li > button')).toHaveCount(0)
    await page.getByRole('combobox', { name: '切换项目' }).selectOption(projectA.id)
    await expect(page.getByRole('combobox', { name: '切换项目' })).toHaveValue(projectA.id)
    await nav.getByRole('button', { name: '剧本', exact: true }).click()
    await expect(page.locator('.scene-tree-list > li > button')).not.toHaveCount(0)
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }) }
})

test('Shot Videos Creator handles empty project and broken confirmed binding without candidate substitution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-shot-videos-empty-'))
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('空镜头项目')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜视频', exact: true }).click()
    await expect(page.getByRole('heading', { name: '还没有分镜视频' })).toBeVisible()
    await page.getByRole('button', { name: '前往分镜' }).click()
    await expect(page.getByRole('heading', { name: '还没有分镜' })).toBeVisible()
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }) }
  const brokenDirectory = await mkdtemp(join(tmpdir(), 'director-shot-videos-broken-'))
  const db = new ProjectDatabase(join(brokenDirectory, 'workspace.sqlite'))
  const project = db.seed(buildSeed)
  db.open(project.id)
  const fixture = await videoServer('ok')
  const repo = new IntelligenceRepository(db)
  const visual = new VisualRepository(repo, new MediaStorage(join(brokenDirectory, 'media')))
  const shot = db.workspace(project.id).entities.find((entity) => entity.kind === 'shot')!
  if (shot.kind !== 'shot') throw new Error('fixture')
  const asset = db.createDraft({ projectId: project.id, kind: 'asset', name: '已丢失的片段' })
  if (asset.kind !== 'asset') throw new Error('fixture')
  repo.updateEntity(project.id, asset.id, asset.revision, { mediaType: 'video' })
  const stored = await visual.storage.storeVideo(project.id, asset.id, fixture.valid)
  const version = visual.commitVersion(project.id, asset.id, stored, { sourceType: 'imported', provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: { targetId: shot.id } })
  visual.review(project.id, version.id, version.revision, 'approved', shot.id, shot.revision)
  db.connection.prepare('DELETE FROM asset_versions WHERE id = ?').run(version.id)
  const other = db.workspace(project.id).entities.find((entity) => entity.kind === 'shot' && entity.id !== shot.id)!
  if (other.kind !== 'shot') throw new Error('fixture')
  const missingAsset = db.createDraft({ projectId: project.id, kind: 'asset', name: '媒体已丢失' })
  if (missingAsset.kind !== 'asset') throw new Error('fixture')
  repo.updateEntity(project.id, missingAsset.id, missingAsset.revision, { mediaType: 'video' })
  const missingStored = await visual.storage.storeVideo(project.id, missingAsset.id, fixture.valid)
  const missingVersion = visual.commitVersion(project.id, missingAsset.id, missingStored, { sourceType: 'imported', provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: { targetId: other.id } })
  visual.review(project.id, missingVersion.id, missingVersion.revision, 'approved', other.id, other.revision)
  db.close()
  await rm(join(brokenDirectory, 'media', missingStored.storageKey))
  await fixture.close()
  const brokenApp = await launch(brokenDirectory)
  try {
    const page = await brokenApp.firstWindow()
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜视频', exact: true }).click()
    await expect(page.getByText('当前确认视频不可用')).toBeVisible()
    await expect(page.locator('.shot-video-player video')).toHaveCount(0)
    await page.locator('.shot-videos-list-item').nth(1).click()
    await expect(page.getByRole('alert').filter({ hasText: '视频暂时无法播放' })).toBeVisible()
    await page.getByRole('button', { name: '重试加载' }).click()
    await expect(page.getByRole('alert').filter({ hasText: '视频暂时无法播放' })).toBeVisible()
    await page.getByRole('button', { name: '查看来源' }).click()
    await expect(page.locator('.shot-videos-source')).toBeVisible()
  } finally { await brokenApp.close(); await rm(brokenDirectory, { recursive: true, force: true }) }
})

test('Shot Videos Creator reviews pinned media, preserves context and opens 1920 overlay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-shot-videos-'))
  const fixture = await videoServer('ok')
  const db = new ProjectDatabase(join(directory, 'workspace.sqlite'))
  const project = db.seed(buildSeed)
  db.open(project.id)
  const repo = new IntelligenceRepository(db)
  const visual = new VisualRepository(repo, new MediaStorage(join(directory, 'media')))
  const initial = db.workspace(project.id).entities
  const board = initial.find((entity) => entity.kind === 'storyboard')!
  const scene = initial.find((entity) => entity.kind === 'scene')!
  for (let index = initial.filter((entity) => entity.kind === 'shot').length; index < 8; index++)
    db.createDraft({ projectId: project.id, kind: 'shot', name: `审看片段 ${index + 1}`, parentId: board.id, sceneId: scene.id })
  const shot = db.workspace(project.id).entities.find((entity) => entity.kind === 'shot')!
  if (shot.kind !== 'shot') throw new Error('fixture')
  const makeVersion = async (name: string) => {
    const asset = db.createDraft({ projectId: project.id, kind: 'asset', name })
    if (asset.kind !== 'asset') throw new Error('fixture')
    repo.updateEntity(project.id, asset.id, asset.revision, { mediaType: 'video' })
    const stored = await visual.storage.storeVideo(project.id, asset.id, fixture.valid)
    return visual.commitVersion(project.id, asset.id, stored, { sourceType: 'imported', provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: { targetId: shot.id } })
  }
  const confirmed = await makeVersion('正式片段')
  visual.review(project.id, confirmed.id, confirmed.revision, 'approved', shot.id, shot.revision)
  const candidateA = await makeVersion('候选 A')
  const candidateB = await makeVersion('候选 B')
  db.close()
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    await nav.getByRole('button', { name: '分镜', exact: true }).click()
    await page.locator('.storyboard-shot-card').first().click()
    await nav.getByRole('button', { name: '分镜视频', exact: true }).click()
    await expect(page.locator('.shot-videos-list-item')).toHaveCount(8)
    await expect(page.locator('.shot-videos-sequence-scroll > button')).toHaveCount(8)
    await expect(page.locator('.shot-videos-list-item').first()).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.shot-videos-candidate')).toHaveCount(2)
    await expect(page.locator('.shot-video-player video')).toHaveCount(1)
    await expect.poll(() => page.locator('.shot-video-player video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1)
    const pinnedUrl = await page.locator('.shot-video-player video').getAttribute('src')
    expect(pinnedUrl).toMatch(/^director-media:\/\/asset\//)
    await expect(page.getByRole('complementary', { name: '上下文检查器' })).toBeVisible()
    await page.screenshot({ path: 'test-results/ShotVideos-2560.png' })
    const pickedId = await page.locator('.shot-videos-candidate').first().getAttribute('data-version-id')
    expect([candidateA.id, candidateB.id]).toContain(pickedId)
    await page.locator('.shot-videos-candidate-pick').first().click()
    const candidateUrl = await page.locator('.shot-video-player video').getAttribute('src')
    expect(candidateUrl).toMatch(/^director-media:\/\/asset\//)
    expect(candidateUrl).not.toBe(pinnedUrl)
    await expect(page.getByText('候选预览 · 尚未采用')).toBeVisible()
    await page.locator('.shot-videos-candidate').first().getByRole('button', { name: '批准' }).click()
    const readShot = async () => {
      const result = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workspace.get', id }), project.id)
      if (!result.ok) throw new Error(result.message)
      return workspaceSchema.parse(result.data).entities.find((entity) => entity.id === shot.id)
    }
    expect((await readShot())?.kind === 'shot' && (await readShot() as typeof shot).confirmedVideoAssetVersionId).toBe(confirmed.id)
    await page.locator('.shot-videos-candidate').first().getByRole('button', { name: '设为当前镜头视频' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已设为当前镜头视频' })).toBeVisible()
    expect((await readShot())?.kind === 'shot' && (await readShot() as typeof shot).confirmedVideoAssetVersionId).toBe(pickedId)
    await expect(page.locator('.shot-video-player video')).toHaveCount(1)
    await page.locator('.shot-videos-candidate').first().getByRole('button', { name: '拒绝' }).click()
    await expect(page.locator('.shot-videos-history')).toContainText('已拒绝')
    await page.locator('.shot-videos-sequence-scroll > button').nth(1).click()
    await expect(page.locator('.shot-videos-list-item').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('尚未确认当前镜头视频')).toBeVisible()
    await page.getByRole('button', { name: '去生成' }).first().click()
    await expect(page.getByRole('tab', { name: '镜头视频' })).toHaveAttribute('aria-selected', 'true')
    await nav.getByRole('button', { name: '分镜视频', exact: true }).click()
    await expect(page.locator('.shot-videos-list-item').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '查看分镜' }).first().click()
    await expect(page.locator('.storyboard-shot-card').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await nav.getByRole('button', { name: '分镜视频', exact: true }).click()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.getByRole('button', { name: '关闭检查器' }).click()
    const mainWidth = await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)
    await page.getByRole('button', { name: '切换检查器' }).click()
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toBeVisible()
    expect(await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)).toBe(mainWidth)
    await page.screenshot({ path: 'test-results/ShotVideos-1920.png' })
    expect(await page.locator('.shot-videos-creator').getByText(/Timeline|音频轨|时间刻度/).count()).toBe(0)
    expect(candidateB.id).toBeTruthy()
  } finally { await application.close(); await fixture.close(); await rm(directory, { recursive: true, force: true }) }
})

test('Storyboard and Generate Creator keep Shot context and block unconfigured Video Workflow', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-storyboard-generate-'))
  const db = new ProjectDatabase(join(directory, 'workspace.sqlite'))
  const project = db.seed(buildSeed)
  db.open(project.id)
  const entities = db.workspace(project.id).entities
  const board = entities.find((entity) => entity.kind === 'storyboard')!
  const scenes = entities.filter((entity) => entity.kind === 'scene')
  const shot = entities.find((entity) => entity.kind === 'shot')!
  if (shot.kind !== 'shot') throw new Error('fixture')
  const repo = new IntelligenceRepository(db)
  repo.updateEntity(project.id, shot.id, shot.revision, { imagePrompt: 'LEGACY_NOT_AUTHORITATIVE', videoPrompt: 'VIDEO_PROMPT_SOURCE' })
  for (let index = entities.filter((entity) => entity.kind === 'shot').length; index < 10; index++) db.createDraft({ projectId: project.id, kind: 'shot', name: `镜头 ${index + 1}`, parentId: board.id, sceneId: scenes[index % scenes.length]!.id })
  db.close()
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜', exact: true }).click()
    await page.getByRole('combobox', { name: '筛选场次' }).selectOption('')
    await expect(page.locator('.storyboard-shot-card')).toHaveCount(10)
    await page.locator('.storyboard-shot-card').first().click()
    await expect(page.getByRole('complementary', { name: '上下文检查器' }).getByRole('button', { name: '编辑分镜描述' })).toBeVisible()
    await page.screenshot({ path: 'test-results/Storyboard-2560.png' })
    await page.getByRole('complementary', { name: '上下文检查器' }).getByRole('button', { name: '去生成' }).click()
    await expect(page.locator('.generate-queue-shot').first()).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: '生成依据' })).toBeVisible()
    await expect(page.getByText('LEGACY_NOT_AUTHORITATIVE')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/Generate-Keyframe-2560.png' })
    await page.getByRole('tab', { name: '镜头视频' }).click()
    await expect(page.getByText('尚未配置可用的视频生成工具')).toBeVisible()
    await expect(page.getByText('VIDEO_PROMPT_SOURCE')).toBeVisible()
    await expect(page.getByRole('button', { name: '预览生成镜头视频' })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/Generate-Video-2560.png' })
    const runs = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workflow', command: { op: 'listWorkflowRuns', projectId: id } }), project.id)
    expect(runs).toMatchObject({ ok: true, data: [] })
    await page.getByRole('button', { name: '前往项目设置' }).click()
    await expect(page.getByRole('heading', { name: 'Provider 设置' })).toBeVisible()
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜', exact: true }).click()
    await page.getByRole('combobox', { name: '筛选场次' }).selectOption('')
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.screenshot({ path: 'test-results/Storyboard-1920.png' })
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '生成', exact: true }).click()
    await page.screenshot({ path: 'test-results/Generate-1920.png' })
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }) }
})

test('test-only Reference Video Tool drives Creator preview, approval and explicit adoption', async () => {
  const server = await videoServer('ok')
  const directory = await mkdtemp(join(tmpdir(), 'director-video-creator-'))
  const db = new ProjectDatabase(join(directory, 'workspace.sqlite'))
  const project = db.seed(buildSeed)
  db.open(project.id)
  const entities = db.workspace(project.id).entities
  const shot = entities.find((entity) => entity.kind === 'shot')!
  const character = entities.find((entity) => entity.kind === 'character')!
  if (shot.kind !== 'shot' || character.kind !== 'character') throw new Error('fixture')
  const visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(directory, 'media')))
  const picture = join(directory, 'production-reference.png')
  await writeFile(picture, await sharp({ create: { width: 480, height: 640, channels: 3, background: '#637d98' } }).png().toBuffer())
  const reference = await visual.importFile(project.id, picture, '主参考', null)
  visual.review(project.id, reference.id, reference.revision, 'approved', null, null)
  visual.saveReferences(project.id, character.id, character.revision, [{ assetId: reference.assetId, role: 'faceReference', primary: true }])
  const keyframe = await visual.importFile(project.id, picture, '正式关键帧', null)
  visual.review(project.id, keyframe.id, keyframe.revision, 'approved', shot.id, shot.revision)
  db.close()
  let application = await launch(directory, undefined, server.origin)
  try {
    let page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜', exact: true }).click()
    await page.locator('.storyboard-shot-card').first().click()
    await page.getByRole('complementary', { name: '上下文检查器' }).getByRole('button', { name: '去生成' }).click()
    await page.getByRole('tab', { name: '镜头视频' }).click()
    await page.getByRole('radio', { name: '文生视频' }).check()
    await page.getByRole('button', { name: '预览生成镜头视频' }).click()
    const dialog = page.getByRole('dialog', { name: '确认生成' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Local Reference Video Fixture (test only)')).toBeVisible()
    await dialog.getByRole('button', { name: '取消' }).click()
    expect(server.counts.submit).toBe(0)
    await page.getByRole('button', { name: '继续确认' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: '单次费用上限' }).fill('0.01')
    await dialog.getByRole('checkbox', { name: /允许费用未知/ }).check()
    await dialog.getByRole('checkbox', { name: /我确认本次/ }).check()
    await dialog.getByRole('button', { name: '确认生成' }).click()
    await expect(page.locator('.generate-candidate-main')).toBeVisible({ timeout: 30000 })
    await page.locator('.generate-candidate-main').getByRole('button', { name: '批准' }).click()
    const current = async () => {
      const result = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workspace.get', id }), project.id)
      if (!result.ok) throw new Error(result.message)
      return workspaceSchema.parse(result.data).entities.find((entity) => entity.id === shot.id)
    }
    const beforeAdopt = await current()
    expect(beforeAdopt?.kind === 'shot' && beforeAdopt.confirmedVideoAssetVersionId).toBeFalsy()
    await page.locator('.generate-candidate-main').getByRole('button', { name: '设为当前镜头视频' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已设为当前镜头视频' })).toBeVisible()
    const afterAdopt = await current()
    expect(afterAdopt?.kind === 'shot' && afterAdopt.confirmedVideoAssetVersionId).toBeTruthy()
    expect(server.counts.submit).toBe(1)
    const nav = page.getByRole('navigation', { name: '创作阶段' })
    await nav.getByRole('button', { name: '资产', exact: true }).click()
    await page.locator('.creator-asset-card').first().click()
    await expect(page.getByRole('complementary', { name: '上下文检查器' }).getByRole('heading', { name: '当前主参考' })).toBeVisible()
    await nav.getByRole('button', { name: '分镜', exact: true }).click()
    await page.locator('.storyboard-shot-card').first().click()
    await expect(page.getByRole('complementary', { name: '上下文检查器' }).getByRole('img', { name: '正式镜头关键帧' })).toBeVisible()
    await nav.getByRole('button', { name: '分镜视频', exact: true }).click()
    await expect(page.locator('.shot-video-player video')).toHaveCount(1)
    await application.close()
    const recorded = new ProjectDatabase(join(directory, 'workspace.sqlite'))
    recorded.open(project.id)
    expect(recorded.connection.prepare('SELECT count(*) AS n FROM generation_records WHERE project_id = ?').get(project.id)!.n).toBeGreaterThan(0)
    expect(recorded.connection.prepare('SELECT count(*) AS n FROM workflow_runs WHERE project_id = ?').get(project.id)!.n).toBeGreaterThan(0)
    recorded.close()
    application = await launch(directory)
    page = await application.firstWindow()
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜视频', exact: true }).click()
    await expect(page.locator('.shot-video-player video')).toHaveCount(1)
    await expect.poll(() => page.locator('.shot-video-player video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1)
    await expect(page.locator('.shot-video-player video')).toHaveAttribute('src', /^director-media:\/\/asset\//)
  } finally { await application.close(); await server.close(); await rm(directory, { recursive: true, force: true }) }
})

test('Creator unknown video submission offers query-only recovery and never resubmits', async () => {
  const server = await videoServer('unknown-submit')
  const directory = await mkdtemp(join(tmpdir(), 'director-video-unknown-'))
  const db = new ProjectDatabase(join(directory, 'workspace.sqlite'))
  const project = db.seed(buildSeed)
  db.open(project.id)
  db.close()
  const application = await launch(directory, undefined, server.origin)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜', exact: true }).click()
    await page.locator('.storyboard-shot-card').first().click()
    await page.getByRole('complementary', { name: '上下文检查器' }).getByRole('button', { name: '去生成' }).click()
    await page.getByRole('tab', { name: '镜头视频' }).click()
    await page.getByRole('radio', { name: '文生视频' }).check()
    await page.getByRole('button', { name: '预览生成镜头视频' }).click()
    const dialog = page.getByRole('dialog', { name: '确认生成' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: '单次费用上限' }).fill('0.01')
    await dialog.getByRole('checkbox', { name: /允许费用未知/ }).check()
    await dialog.getByRole('checkbox', { name: /我确认本次/ }).check()
    await dialog.getByRole('button', { name: '确认生成' }).click()
    await expect(page.getByRole('alert').filter({ hasText: '系统不会自动重试' })).toBeVisible({ timeout: 30000 })
    expect(server.counts.submit).toBe(1)
    await page.getByRole('alert').filter({ hasText: '系统不会自动重试' }).getByRole('button', { name: '刷新状态' }).click()
    expect(server.counts.submit).toBe(1)
  } finally { await application.close(); await server.close(); await rm(directory, { recursive: true, force: true }) }
})

test('Creator Keyframe preview shows compiled prompt and keeps candidate separate from official pin', async () => {
  const server = await imageServer()
  const directory = await mkdtemp(join(tmpdir(), 'director-keyframe-creator-'))
  const db = new ProjectDatabase(join(directory, 'workspace.sqlite'))
  const project = db.seed(buildSeed)
  db.open(project.id)
  const shot = db.workspace(project.id).entities.find((entity) => entity.kind === 'shot')!
  if (shot.kind !== 'shot') throw new Error('fixture')
  new IntelligenceRepository(db).updateEntity(project.id, shot.id, shot.revision, { imagePrompt: 'LEGACY_ONLY' })
  db.close()
  const application = await launch(directory, server.origin)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜', exact: true }).click()
    await page.locator('.storyboard-shot-card').first().click()
    await page.getByRole('complementary', { name: '上下文检查器' }).getByRole('button', { name: '去生成' }).click()
    await expect(page.getByRole('heading', { name: '生成依据' })).toBeVisible()
    await expect(page.getByText('LEGACY_ONLY')).toHaveCount(0)
    await page.getByRole('button', { name: '预览生成关键帧' }).click()
    const dialog = page.getByRole('dialog', { name: '确认生成' })
    await expect(dialog).toBeVisible()
    await dialog.getByText('高级生成 · 实际编译 Prompt').click()
    await expect(dialog.getByText('Compiler Version')).toBeVisible()
    await expect(dialog.getByText('当前预览未返回')).toHaveCount(0)
    await dialog.getByRole('textbox', { name: '单次费用上限' }).fill('0.01')
    await dialog.getByRole('checkbox', { name: /允许费用未知/ }).check()
    await dialog.getByRole('checkbox', { name: /我确认本次/ }).check()
    await dialog.getByRole('button', { name: '确认生成' }).click()
    await expect(page.locator('.generate-candidate-main')).toBeVisible({ timeout: 30000 })
    await page.screenshot({ path: 'test-results/Generate-Keyframe-2560.png' })
    const read = async () => {
      const response = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workspace.get', id }), project.id)
      if (!response.ok) throw new Error(response.message)
      return workspaceSchema.parse(response.data).entities.find((entity) => entity.id === shot.id)
    }
    await page.locator('.generate-candidate-main').getByRole('button', { name: '批准' }).click()
    const before = await read()
    expect(before?.kind === 'shot' && before.approvedKeyframeVersionId).toBeFalsy()
    await page.locator('.generate-candidate-main').getByRole('button', { name: '设为镜头关键帧' }).click()
    const after = await read()
    expect(after?.kind === 'shot' && after.approvedKeyframeVersionId).toBeTruthy()
    expect(server.counts.submit).toBe(1)
  } finally { await application.close(); await server.close(); await rm(directory, { recursive: true, force: true }) }
})

test('Assets creator reviews a separate candidate before explicit primary adoption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-assets-creator-'))
  const db = new ProjectDatabase(join(directory, 'workspace.sqlite'))
  const project = db.seed(buildSeed)
  db.open(project.id)
  const visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(directory, 'media')))
  const character = db.workspace(project.id).entities.find((entity) => entity.kind === 'character')!
  if (character.kind !== 'character') throw new Error('fixture')
  const path = join(directory, 'portrait.png')
  await writeFile(path, await sharp({ create: { width: 480, height: 640, channels: 3, background: '#587680' } }).png().toBuffer())
  const a = await visual.importFile(project.id, path, '当前参考', null)
  visual.review(project.id, a.id, a.revision, 'approved', null, null)
  const withPrimary = visual.saveReferences(project.id, character.id, character.revision, [{ assetId: a.assetId, role: 'faceReference', primary: true }])
  if (withPrimary.kind !== 'character') throw new Error('fixture')
  const b = await visual.importFile(project.id, path, '候选参考', null)
  visual.saveReferences(project.id, character.id, withPrimary.revision, [...withPrimary.visualReferences, { assetId: b.assetId, role: 'costumeReference', primary: false }])
  for (const [index, name] of ['阿青', '白露', '许岚', '老徐', '赵叔'].entries()) {
    const extra = db.createDraft({ projectId: project.id, kind: 'character', name })
    if (extra.kind !== 'character' || index >= 3) continue
    const extraPath = join(directory, `portrait-${index}.png`)
    await writeFile(extraPath, await sharp({ create: { width: 480, height: 640, channels: 3, background: ['#a47762', '#82759a', '#779076'][index]! } }).png().toBuffer())
    const version = await visual.importFile(project.id, extraPath, name, null)
    visual.review(project.id, version.id, version.revision, 'approved', null, null)
    visual.saveReferences(project.id, extra.id, extra.revision, [{ assetId: version.assetId, role: 'faceReference', primary: true }])
  }
  db.close()
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '资产', exact: true }).click()
    await expect(page.getByRole('tablist', { name: '资产类型' }).getByRole('tab')).toHaveCount(3)
    await expect(page.locator('.creator-asset-card')).toHaveCount(8)
    await page.locator('.creator-asset-card').first().click()
    const inspector = page.getByRole('complementary', { name: '上下文检查器' })
    await expect(inspector.getByRole('heading', { name: '当前主参考' })).toBeVisible()
    await expect(inspector.getByRole('heading', { name: /候选版本/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/Assets-2560.png' })
    await inspector.getByRole('button', { name: '生成参考图' }).click()
    await expect(page.locator('.generate-target-head').getByRole('heading', { name: character.name })).toBeVisible()
    await page.getByRole('button', { name: '返回资产' }).click()
    await expect(page.locator('.creator-asset-card').first()).toHaveAttribute('aria-pressed', 'true')
    await inspector.getByRole('button', { name: '批准', exact: true }).click()
    await expect(inspector.getByRole('button', { name: '设为主参考' })).toBeVisible()
    const read = async () => {
      const result = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workspace.get', id }), project.id)
      if (!result.ok) throw new Error(result.message)
      return workspaceSchema.parse(result.data)
    }
    const approved = await read()
    const approvedCharacter = approved.entities.find((entity) => entity.id === character.id)
    expect(approvedCharacter?.kind === 'character' && approvedCharacter.visualReferences.find((ref) => ref.primary)?.assetId).toBe(a.assetId)
    await inspector.getByRole('button', { name: '设为主参考' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已设为主参考' })).toBeVisible()
    const adopted = await read()
    const adoptedCharacter = adopted.entities.find((entity) => entity.id === character.id)
    expect(adoptedCharacter?.kind === 'character' && adoptedCharacter.visualReferences.find((ref) => ref.primary)?.assetId).toBe(b.assetId)
    expect(adoptedCharacter?.kind === 'character' && adoptedCharacter.visualReferences.find((ref) => ref.assetId === b.assetId)?.role).toBe('costumeReference')
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '剧本', exact: true }).click()
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '资产', exact: true }).click()
    await expect(page.locator('.creator-asset-card').first()).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('textbox', { name: '搜索创作资产' }).fill(character.name)
    await expect(page.locator('.creator-asset-card')).toHaveCount(1)
    await page.getByRole('textbox', { name: '搜索创作资产' }).fill('')
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.getByRole('button', { name: '关闭检查器' }).click()
    const gridWidth = await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)
    await page.locator('.creator-asset-card').first().click()
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toBeVisible()
    expect(await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)).toBe(gridWidth)
    await page.screenshot({ path: 'test-results/Assets-1920.png' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toHaveCount(0)
    await page.getByRole('tab', { name: /场景/ }).click()
    await expect(page.locator('.creator-asset-card')).toHaveCount(2)
    await expect(page.getByRole('button', { name: '新增场景' })).toBeVisible()
    await page.getByRole('tab', { name: /道具/ }).click()
    await expect(page.locator('.creator-asset-card')).toHaveCount(2)
    await expect(page.getByRole('button', { name: '新增道具' })).toBeVisible()
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Story and Script creator pages keep scene context and render both target widths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-story-script-'))
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await expect(page.getByRole('region', { name: '故事编辑器' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: '上下文检查器' }).getByText('故事属性')).toBeVisible()
    await page.screenshot({ path: 'test-results/Story-2560.png' })
    await page.getByRole('textbox', { name: '一句话概念' }).fill('一封信改变三个人的命运')
    await page.getByRole('textbox', { name: '故事梗概' }).fill('雨夜车站的重逢。')
    await page.getByRole('textbox', { name: '风格' }).fill('悬疑写实')
    await page.getByRole('textbox', { name: '世界观' }).fill('临海小城')
    await page.getByRole('textbox', { name: '创作要求' }).fill('每集结尾留下悬念')
    await expect(page.getByRole('status')).toHaveText('尚未保存')
    await expect(page.getByRole('status')).toHaveText('已保存到本地')
    const projectId = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
    const persisted = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'projects.get', id }), projectId)
    expect(persisted).toMatchObject({ ok: true, data: { logline: '一封信改变三个人的命运', description: '雨夜车站的重逢。', style: '悬疑写实', worldview: '临海小城', creativeRequirements: '每集结尾留下悬念' } })
    await page.getByRole('button', { name: '进入剧本' }).click()
    await expect(page.getByRole('region', { name: '分集场次树' })).toBeVisible()
    const sceneButtons = page.locator('.scene-tree-list > li > button')
    await expect(sceneButtons).toHaveCount(2)
    await sceneButtons.nth(1).click()
    await expect(sceneButtons.nth(1)).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('complementary', { name: '上下文检查器' }).getByText('场次编号')).toBeVisible()
    await page.screenshot({ path: 'test-results/Script-2560.png' })
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '故事', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '一句话概念' })).toHaveValue('一封信改变三个人的命运')
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '剧本', exact: true }).click()
    await expect(page.locator('.scene-tree-list > li > button').nth(1)).toHaveAttribute('aria-current', 'true')
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.getByRole('button', { name: '关闭检查器' }).click()
    const mainWidth = await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)
    await page.screenshot({ path: 'test-results/Script-1920.png' })
    await page.getByRole('button', { name: '切换检查器' }).click()
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toBeVisible()
    expect(await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)).toBe(mainWidth)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toHaveCount(0)
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '故事', exact: true }).click()
    await page.screenshot({ path: 'test-results/Story-1920.png' })
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '剧本', exact: true }).click()
    page.once('dialog', (dialog) => void dialog.accept())
    await page.locator('.scene-tree-list > li').nth(1).getByRole('button', { name: /删除场次/ }).click()
    await expect(page.locator('.scene-tree-list > li')).toHaveCount(1)
    await expect(page.locator('.scene-tree-list > li > button').first()).toHaveAttribute('aria-current', 'true')
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('creator shell starts in compact 1920 layout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-creator-compact-'))
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await expect(page.locator('.creator-nav')).toHaveClass(/is-collapsed/)
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toHaveCount(0)
    const mainBefore = await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)
    await page.getByRole('button', { name: '切换检查器' }).click()
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toBeVisible()
    expect(await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)).toBe(mainBefore)
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('creator shell navigation, context, overlays and project round trip', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-creator-shell-'))
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await expect(page.locator('.creator-shell')).toBeVisible()
    const primary = page.getByRole('navigation', { name: '创作阶段' }).getByRole('button')
    await expect(primary).toHaveCount(6)
    for (const [index, name] of ['故事', '剧本', '资产', '分镜', '生成', '分镜视频'].entries()) await expect(primary.nth(index)).toHaveAccessibleName(name)
    for (const [index, name] of ['项目设置', '验收与维护'].entries()) await expect(page.getByRole('navigation', { name: '次级导航' }).getByRole('button').nth(index)).toHaveAccessibleName(name)
    for (const name of ['故事', '剧本', '资产', '分镜', '生成', '分镜视频']) {
      await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name, exact: true }).click()
      await expect(page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    }
    await page.getByRole('navigation', { name: '次级导航' }).getByRole('button', { name: '项目设置' }).click()
    await expect(page.getByRole('heading', { name: 'Provider 设置' })).toBeVisible()
    await page.getByRole('navigation', { name: '次级导航' }).getByRole('button', { name: '验收与维护' }).click()
    await expect(page.getByRole('heading', { name: '生产验收与维护' })).toBeVisible()
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜', exact: true }).click()
    const shot = await page.locator('.storyboard-shot-card').first().getAttribute('aria-pressed')
    expect(shot).toBe('true')
    await page.locator('.storyboard-shot-card').first().click()
    await page.getByRole('complementary', { name: '上下文检查器' }).getByRole('button', { name: '去生成' }).click()
    await expect(page.locator('.generate-queue-shot').first()).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('main', { name: '主工作区' }).getByRole('button', { name: '查看分镜' }).click()
    await expect(page.locator('.storyboard-shot-card').first()).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: 'test-results/CreatorShell-2560.png' })
    const mainWidth = await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.getByRole('button', { name: '关闭检查器' }).click()
    const mainScroll = await page.locator('.creator-main').evaluate((element) => element.scrollTop)
    await page.getByRole('button', { name: '切换检查器' }).click()
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toBeVisible()
    await expect(page.getByRole('button', { name: '关闭检查器' })).toBeFocused()
    const overlayWidth = await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().width)
    expect(overlayWidth).toBeGreaterThan(1400)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '上下文检查器' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '切换检查器' })).toBeFocused()
    expect(await page.locator('.creator-main').evaluate((element) => element.scrollTop)).toBe(mainScroll)
    const mainHeight = await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().height)
    await page.getByRole('button', { name: '制作任务', exact: true }).first().click()
    await expect(page.getByRole('button', { name: /制作任务.*个任务进行中/ })).toHaveAttribute('aria-expanded', 'true')
    expect(await page.locator('.creator-main').evaluate((element) => element.getBoundingClientRect().height)).toBe(mainHeight)
    await page.getByRole('button', { name: '高级模式', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已切换到高级模式' })).toBeVisible()
    await page.getByRole('button', { name: '关闭提示' }).click()
    await expect(page.getByText('已切换到高级模式')).toHaveCount(0)
    await page.evaluate(() => localStorage.setItem('director-test-render-error', '1'))
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '剧本', exact: true }).click()
    await expect(page.getByRole('heading', { name: '当前工作区加载失败' })).toBeVisible()
    await page.evaluate(() => localStorage.removeItem('director-test-render-error'))
    await page.getByRole('button', { name: '重新加载当前工作区' }).click()
    await expect(page.getByRole('heading', { name: '当前工作区加载失败' })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/CreatorShell-1920.png' })
    expect(mainWidth).toBeGreaterThan(1400)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '返回项目列表' }).click()
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '打开项目' }).first().click()
    await expect(page.locator('.creator-shell')).toBeVisible()
    await expect(page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '剧本', exact: true })).toHaveAttribute('aria-current', 'page')
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

async function launch(directory: string, imageFixtureOrigin?: string, videoFixtureOrigin?: string) {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) environment[key] = value
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  delete environment.DIRECTOR_TEST_IMAGE_ORIGIN
  delete environment.DIRECTOR_TEST_VIDEO_ORIGIN
  if(imageFixtureOrigin)environment.DIRECTOR_TEST_IMAGE_ORIGIN=imageFixtureOrigin
  if(videoFixtureOrigin)environment.DIRECTOR_TEST_VIDEO_ORIGIN=videoFixtureOrigin
  environment.DIRECTOR_TEST_USER_DATA = directory
  environment.DIRECTOR_TEXT_PROVIDER = 'mock'
  return electron.launch({ args: ['.'], env: environment })
}

async function openAssetTab(page: Page, name: '角色' | '场景' | '道具') {
  await page.getByRole('navigation', { name: '次级导航' }).getByRole('button', { name: '项目设置' }).click()
  await page.getByRole('region', { name: '旧版兼容入口' }).getByRole('button', { name, exact: true }).click()
}
async function openLegacy(page: Page, name: '生产看板' | '素材库') {
  await page.getByRole('navigation', { name: '次级导航' }).getByRole('button', { name: '项目设置' }).click()
  await page.getByRole('region', { name: '旧版兼容入口' }).getByRole('button', { name, exact: true }).click()
}
async function openLegacyGeneration(page: Page) {
  await page.getByRole('navigation', { name: '次级导航' }).getByRole('button', { name: '项目设置' }).click()
  await page.getByRole('region', { name: '旧版兼容入口' }).getByRole('button', { name: '旧版生成' }).click()
}
async function openLegacyStoryboard(page: Page) {
  await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜', exact: true }).click()
  await page.getByRole('button', { name: '更多操作' }).click()
}

test('project workspace persists CRUD, seed relations and safe IPC', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-smoke-'))
  let application = await launch(directory)
  try {
    let page = await application.firstWindow()
    await expect(
      page.getByRole('heading', { name: '项目', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '新建项目', exact: true }),
    ).toBeEnabled()
    const about = await page.evaluate(() =>
      window.desktop!.workspace.request({
        action: 'operations',
        command: { operation: 'about' },
      }),
    )
    expect(about).toMatchObject({ ok: true, data: { version: '0.7.0', schema: 10 } })
    const isolation = await page.evaluate(() => ({
      bridge: Boolean(window.desktop?.workspace),
      require: typeof Reflect.get(window, 'require'),
      ipc: typeof Reflect.get(window, 'ipcRenderer'),
    }))
    expect(isolation).toEqual({
      bridge: true,
      require: 'undefined',
      ipc: 'undefined',
    })
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('测试短剧')
    await page.getByLabel('简介', { exact: true }).fill('持久化验证')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('combobox', { name: '切换项目' })).toHaveValue(
      /.+/,
    )
    await page.getByRole('button', { name: '返回项目列表' }).click()
    await page.getByRole('button', { name: '重命名', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('重命名短剧')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '故事名称' })).toHaveValue('重命名短剧')
    await application.close()
    application = await launch(directory)
    page = await application.firstWindow()
    await expect(page.getByRole('textbox', { name: '故事名称' })).toHaveValue('重命名短剧')
    await expect(page.locator('.topbar strong')).toHaveText('重命名短剧')
    await page.getByRole('button', { name: '返回项目列表' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByLabel('确认项目名').fill('重命名短剧')
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(page.locator('.topbar strong')).toHaveText('尚未打开项目')
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await expect(page.locator('.topbar strong')).toHaveText(
      '雨夜来信 · 示例短剧',
    )
    await openAssetTab(page, '角色')
    await expect(
      page.getByRole('region', { name: '角色列表' }).getByRole('listitem'),
    ).toHaveCount(3)
    await page.getByRole('button', { name: '新增角色', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('新角色')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(
      page.getByRole('region', { name: '角色列表' }).getByRole('listitem'),
    ).toHaveCount(4)
    await openLegacyStoryboard(page)
    await expect(
      page.getByRole('region', { name: '镜头列表' }).getByRole('listitem'),
    ).toHaveCount(6)
    await page.screenshot({
      path: 'test-results/workspace.png',
      fullPage: true,
    })
    for (const name of ['剧本', '场景', '道具', '生成', '素材库']) {
      if (name === '场景' || name === '道具') await openAssetTab(page, name)
      else if (name === '素材库') await openLegacy(page, '素材库')
      else await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name, exact: true }).click()
      await expect(
        page.getByRole('heading', { name, exact: true }),
      ).toBeVisible()
    }
    const seedId = await page
      .getByRole('combobox', { name: '切换项目' })
      .inputValue()
    await page.getByRole('button', { name: '返回项目列表' }).click()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('空白项目')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await openAssetTab(page, '角色')
    await expect(
      page.getByRole('region', { name: '角色列表' }).getByRole('listitem'),
    ).toHaveCount(0)
    await page.getByRole('combobox', { name: '切换项目' }).selectOption(seedId)
    await openAssetTab(page, '角色')
    await expect(
      page.getByRole('region', { name: '角色列表' }).getByRole('listitem'),
    ).toHaveCount(4)
    const invalid = await page.evaluate(() =>
      window.desktop!.workspace.request({
        action: 'projects.delete',
        id: '../../other.db',
      } as Request),
    )
    expect(invalid).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    const denied = await application.evaluate(
      async ({ BrowserWindow, app }) => {
        const other = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: app.getAppPath() + '/out/preload/index.cjs',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        })
        try {
          await other.loadFile(app.getAppPath() + '/out/renderer/index.html')
          return (await other.webContents.executeJavaScript(
            'window.desktop.workspace.request({ action: "projects.list" })',
          )) as unknown
        } finally {
          other.destroy()
        }
      },
    )
    expect(denied).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('script editing, import preview, breakdown review, Bible merge and Shot confirmation work end to end', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'director-intelligence-smoke-'),
  )
  let application = await launch(directory)
  try {
    let page = await application.firstWindow()
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await expect(page.locator('.topbar strong')).toHaveText(
      '雨夜来信 · 示例短剧',
    )
    await page.getByRole('button', { name: '剧本', exact: true }).click()
    const original = await page.getByLabel('动作', { exact: true }).inputValue()
    await page
      .getByLabel('动作', { exact: true })
      .fill('林夏拿着旧信，黑伞滴水。自动保存验证。')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByLabel('动作', { exact: true })).toHaveValue(original)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect(page.getByLabel('动作', { exact: true })).toHaveValue(
      /自动保存验证/,
    )
    await expect(page.getByRole('status')).toHaveText('已保存到本地')
    const projectId = await page
      .getByRole('combobox', { name: '切换项目' })
      .inputValue()
    const readWorkspace = async () => {
      const result = await page.evaluate(
        (id) =>
          window.desktop!.workspace.request({ action: 'workspace.get', id }),
        projectId,
      )
      if (!result.ok) throw new Error(result.message)
      return workspaceSchema.parse(result.data)
    }
    const saved = await readWorkspace()
    const scene = saved.entities.find((e) => e.kind === 'scene')!
    if (scene.kind !== 'scene') throw new Error('Missing scene')
    expect(scene.content.action).toContain('自动保存验证')
    // Simulate a concurrent edit to prove that the editor keeps unsaved input on a revision conflict.
    await page.evaluate(
      ({ projectId, scene }) =>
        window.desktop!.workspace.request({
          action: 'intelligence',
          command: {
            operation: 'scene.save',
            projectId,
            id: scene.id,
            expectedRevision: scene.revision,
            content: { ...scene.content, notes: '另一窗口的编辑' },
          },
        }),
      { projectId, scene },
    )
    await page.getByLabel('动作', { exact: true }).fill('冲突时保留的本地修改')
    await expect(page.getByRole('alert')).toContainText('数据已更新')
    page.once('dialog', (dialog) => void dialog.dismiss())
    await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '资产', exact: true }).click()
    await expect(page.getByLabel('动作', { exact: true })).toHaveValue(
      '冲突时保留的本地修改',
    )
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: '放弃本地修改并重新载入' }).click()
    await expect(page.getByRole('status')).toHaveText('已保存到本地')
    await page.getByText('导入与智能拆解', { exact: true }).click()
    await page
      .getByRole('button', { name: '剧本解析 / 导入', exact: true })
      .click()
    await page.getByLabel('剧本名称', { exact: true }).fill('导入验证')
    await page
      .getByLabel('剧本原文')
      .fill(
        '第1集 码头\n第1场 外景 码头 夜\n人物：阿青\n动作：阿青拿着钥匙走近汽车。\n阿青（低声）：你在哪里？\n第2场 内景 仓库 日\n人物：阿青\n阿青：我到了。',
      )
    const beforeImport = (await readWorkspace()).entities.length
    await page.getByRole('button', { name: '解析为预览' }).click()
    await expect(
      page.getByRole('heading', { name: '解析预览', exact: true }),
    ).toBeVisible()
    expect((await readWorkspace()).entities.length).toBe(beforeImport)
    await page.getByRole('button', { name: '确认导入正式剧本' }).click()
    await expect(
      page.getByRole('button', { name: '已确认导入' }),
    ).toBeDisabled()
    await page
      .getByLabel('当前剧本', { exact: true })
      .selectOption({ label: '导入验证' })
    await expect(page.getByLabel('地点', { exact: true })).toHaveValue('码头')
    await page.getByRole('button', { name: '制作拆解', exact: true }).click()
    await page
      .getByRole('button', { name: '分析当前场次', exact: true })
      .click()
    const characterCard = page.getByRole('article', {
      name: '草稿 阿青',
      exact: true,
    })
    await expect(characterCard).toBeVisible()
    expect(
      (await readWorkspace()).entities.filter((e) => e.kind === 'character'),
    ).toHaveLength(3)
    await characterCard
      .getByRole('button', { name: '编辑', exact: true })
      .click()
    await characterCard
      .getByLabel('说明', { exact: true })
      .fill('人工审核：码头的目击者')
    await characterCard.getByRole('button', { name: '保存草稿修改' }).click()
    await expect(
      characterCard.getByRole('button', { name: '确认创建' }),
    ).toBeEnabled()
    await characterCard.getByRole('button', { name: '确认创建' }).click()
    await expect(characterCard).not.toBeVisible()
    for (const name of ['码头', '钥匙']) {
      const card = page.getByRole('article', {
        name: '草稿 ' + name,
        exact: true,
      })
      await card.getByRole('button', { name: '确认创建' }).click()
      await expect(card).not.toBeVisible()
    }
    const data = await readWorkspace()
    const character = data.entities.find(
      (e) => e.kind === 'character' && e.name === '阿青',
    )!
    expect(character.description).toContain('人工审核')
    await page.getByRole('button', { name: /2 · 第2场 内景 仓库 日/ }).click()
    await page
      .getByRole('button', { name: '分析当前场次', exact: true })
      .click()
    await expect(characterCard).toBeVisible()
    await characterCard.getByLabel('合并目标').selectOption(character.id)
    await characterCard.getByRole('button', { name: '确认合并' }).click()
    await expect(characterCard).not.toBeVisible()
    expect(
      (await readWorkspace()).entities.filter((e) => e.kind === 'character'),
    ).toHaveLength(4)
    await page.getByRole('button', { name: '导演拆镜', exact: true }).click()
    const shotCard = page.getByRole('article', {
      name: '草稿 镜头 1 · 建立空间',
      exact: true,
    })
    await expect(shotCard).toBeVisible()
    expect(
      (await readWorkspace()).entities.filter((e) => e.kind === 'shot'),
    ).toHaveLength(6)
    await shotCard
      .getByRole('button', { name: '确认创建', exact: true })
      .click()
    await expect(shotCard).not.toBeVisible()
    expect(
      (await readWorkspace()).entities.filter((e) => e.kind === 'shot'),
    ).toHaveLength(7)
    await page.screenshot({
      path: 'test-results/script-intelligence.png',
      fullPage: true,
    })
    await openAssetTab(page, '角色')
    const bible = page
      .getByRole('listitem')
      .filter({ has: page.getByText('阿青', { exact: true }) })
    await bible.getByRole('button', { name: '编辑 Bible', exact: true }).click()
    await bible.getByLabel('声音描述').fill('温和、略带沙哑')
    await bible.getByRole('button', { name: '保存 Bible' }).click()
    await expect(
      bible.getByRole('button', { name: '编辑 Bible' }),
    ).toBeVisible()
    const finalCharacter = (await readWorkspace()).entities.find(
      (e) => e.id === character.id,
    )
    expect(
      finalCharacter?.kind === 'character' &&
        finalCharacter.bible.voiceDescription,
    ).toBe('温和、略带沙哑')
    await application.close()
    application = await launch(directory)
    page = await application.firstWindow()
    await expect(page.locator('.topbar strong')).toHaveText(
      '雨夜来信 · 示例短剧',
    )
    expect(
      (await readWorkspace()).entities.filter((e) => e.kind === 'shot'),
    ).toHaveLength(7)
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('visual production imports, generates, reviews versions and pins Shot keyframes across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-visual-smoke-'))
  let application = await launch(directory)
  try {
    let page = await application.firstWindow()
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await openAssetTab(page, '角色')
    const character = page
      .getByRole('region', { name: '角色列表', exact: true })
      .getByRole('listitem')
      .first()
    await character.getByText('视觉生产', { exact: true }).click()
    const visual = character.locator('.visual-panel')
    await visual.getByRole('button', { name: '编译并编辑 Prompt' }).click()
    await expect(visual.getByLabel('正向 Prompt')).not.toHaveValue('')
    await visual
      .getByRole('button', { name: '生成视觉资产', exact: true })
      .click()
    const firstVersion = visual.getByRole('article', {
      name: '版本 1',
      exact: true,
    })
    await expect(firstVersion).toBeVisible()
    await expect(firstVersion.getByRole('img').first()).toBeVisible()
    await firstVersion.getByRole('button', { name: '批准 / Promote' }).click()
    await expect(visual.getByText(/★ 主参考/)).toBeAttached()
    await openLegacyStoryboard(page)
    const shot = page
      .getByRole('region', { name: '镜头列表', exact: true })
      .getByRole('listitem')
      .first()
    await shot.getByText('视觉生产', { exact: true }).click()
    const production = shot.locator('.visual-panel')
    await production
      .getByRole('button', { name: '生成关键帧', exact: true })
      .click()
    const v1 = production.getByRole('article', { name: '版本 1', exact: true })
    await expect(v1).toBeVisible()
    await v1.getByRole('button', { name: '批准 / Promote' }).click()
    await expect(
      production.getByRole('img', { name: '已确认关键帧', exact: true }),
    ).toBeVisible()
    const read = () =>
      page
        .evaluate(async () => {
          if (!window.desktop) throw new Error('desktop missing')
          const projects = await window.desktop.workspace.request({
            action: 'projects.list',
          })
          if (!projects.ok || !Array.isArray(projects.data))
            throw new Error('projects')
          const project = projects.data[0]
          if (!project || typeof project !== 'object' || !('id' in project))
            throw new Error('project')
          const result = await window.desktop.workspace.request({
            action: 'workspace.get',
            id: String(project.id),
          })
          if (!result.ok) throw new Error('workspace')
          return result.data
        })
        .then((value) => workspaceSchema.parse(value))
    const pinned = (await read()).entities.find(
      (e) => e.kind === 'shot' && e.approvedKeyframeVersionId,
    )
    expect(pinned?.kind).toBe('shot')
    await v1.getByRole('button', { name: 'Regenerate / 编辑后重生' }).click()
    await production
      .getByLabel('正向 Prompt')
      .fill('same character, same costume, cinematic night, revised framing')
    await production
      .getByRole('button', { name: '生成关键帧', exact: true })
      .click()
    const v2 = production.getByRole('article', { name: '版本 2', exact: true })
    await expect(v2).toBeVisible()
    await production.getByLabel('批准后绑定到').selectOption('')
    await v2.getByRole('button', { name: '批准 / Promote' }).click()
    const after = (await read()).entities.find((e) => e.id === pinned?.id)
    expect(after?.kind === 'shot' && after.approvedKeyframeVersionId).toBe(
      pinned?.kind === 'shot' && pinned.approvedKeyframeVersionId,
    )
    await v1.getByLabel('对比此版本').check()
    await v2.getByLabel('对比此版本').check()
    await expect(production.locator('.version-compare img')).toHaveCount(2)
    await page.screenshot({
      path: 'test-results/visual-production.png',
      fullPage: true,
    })
    const file = join(directory, 'reference.png')
    await writeFile(
      file,
      await sharp({
        create: { width: 96, height: 128, channels: 3, background: '#336699' },
      })
        .png()
        .toBuffer(),
    )
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, file)
    await openLegacy(page, '素材库')
    await page.getByRole('button', { name: '导入图片', exact: true }).click()
    const tile = page
      .locator('.asset-tile')
      .filter({ hasText: 'reference.png' })
    await expect(tile).toHaveCount(1)
    await page.getByRole('button', { name: '导入图片', exact: true }).click()
    await expect(tile).toHaveCount(1)
    await tile.click()
    await expect(
      page.getByRole('article', { name: '版本 1', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '保存并测试连接' }).click()
    await expect(page.getByText('Mock 图像服务可用，无网络调用')).toBeVisible()
    await application.close()
    application = await launch(directory)
    page = await application.firstWindow()
    await expect(page.locator('.topbar strong')).toHaveText(
      '雨夜来信 · 示例短剧',
    )
    const restored = (await read()).entities.find((e) => e.id === pinned?.id)
    expect(
      restored?.kind === 'shot' && restored.approvedKeyframeVersionId,
    ).toBe(pinned?.kind === 'shot' && pinned.approvedKeyframeVersionId)
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
test('batch keyframes and playable video versions require explicit Shot confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-video-smoke-'))
  let application = await launch(directory)
  try {
    let page = await application.firstWindow()
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await expect(page.locator('.topbar strong')).toHaveText(
      '雨夜来信 · 示例短剧',
    )
    const projectId = await page.getByLabel('切换项目').inputValue()
    const read = async () => {
      const response = await page.evaluate(
        (id) =>
          window.desktop!.workspace.request({ action: 'workspace.get', id }),
        projectId,
      )
      if (!response.ok) throw Error(response.message)
      return workspaceSchema.parse(response.data)
    }
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '运行 ComfyUI Diagnostics' }).click()
    await expect(
      page.getByText('Provider Ready', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: '测试视频 Provider', exact: true })
      .click()
    await expect(
      page.getByText('Mock Video Ready：FFmpeg / FFprobe 可用', {
        exact: true,
      }),
    ).toBeVisible()
    await openLegacyStoryboard(page)
    await page.getByText('批量关键帧生产', { exact: true }).click()
    const batch = page.locator('.batch-panel')
    await batch.locator('input[type=checkbox]').nth(0).check()
    await batch.locator('input[type=checkbox]').nth(1).check()
    await batch
      .getByRole('button', { name: '批量编译 Prompt', exact: true })
      .click()
    await expect(
      batch.locator('summary').filter({ hasText: '· Prompt' }),
    ).toHaveCount(2)
    await batch
      .getByRole('button', { name: '批量生成关键帧', exact: true })
      .click()
    await expect(
      batch.getByText('2/2 成功 · 0 失败', { exact: true }),
    ).toBeVisible()
    const shot = page
      .getByRole('region', { name: '镜头列表', exact: true })
      .getByRole('listitem')
      .first()
    await shot.getByText('视觉生产', { exact: true }).click()
    const image = shot.locator('.visual-panel')
    await image.getByRole('button', { name: '批准 / Promote' }).first().click()
    await expect(
      image.getByRole('img', { name: '已确认关键帧', exact: true }),
    ).toBeVisible()
    await shot
      .locator(':scope > div > details > summary')
      .filter({ hasText: '视频生产' })
      .click()
    const video = shot.locator('.video-panel')
    await video.getByLabel('视频时长', { exact: true }).selectOption('1')
    await video
      .getByRole('button', { name: '编译视频 Prompt', exact: true })
      .click()
    await expect(video.getByLabel('视频动作 Prompt')).not.toHaveValue('')
    await video.getByRole('button', { name: '生成视频', exact: true }).click()
    const first = video.getByRole('article', { name: '版本 1', exact: true })
    await expect(first).toBeVisible({ timeout: 20000 })
    await first.getByText('生成信息与预览', { exact: true }).click()
    await expect
      .poll(() =>
        first
          .locator('video')
          .evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(1)
    await first
      .locator('video')
      .evaluate((element: HTMLVideoElement) => element.play())
    await expect
      .poll(() =>
        first
          .locator('video')
          .evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0)
    const initial = (await read()).entities.find(
      (e) => e.kind === 'shot' && e.approvedKeyframeVersionId,
    )
    if (initial?.kind !== 'shot') throw Error('shot missing')
    expect(initial.confirmedVideoAssetVersionId).toBeNull()
    await first.getByRole('button', { name: 'Approve 视频版本' }).click()
    expect(
      (await read()).entities.find((e) => e.id === initial.id),
    ).toMatchObject({ confirmedVideoAssetVersionId: null })
    await first.getByRole('button', { name: 'Confirm for Shot' }).click()
    await expect(video.getByText('已确认视频（固定版本）')).toBeVisible()
    const pinned = (await read()).entities.find((e) => e.id === initial.id)
    await first.getByRole('button', { name: 'Regenerate / 编辑后重生' }).click()
    await video
      .getByLabel('视频动作 Prompt')
      .fill('开始：静止。过程：抬头看向门口。结束：保持凝视。')
    await video.getByRole('button', { name: '生成视频', exact: true }).click()
    const second = video.getByRole('article', { name: '版本 2', exact: true })
    await expect(second).toBeVisible({ timeout: 20000 })
    await first.getByLabel('对比此版本').check()
    await second.getByLabel('对比此版本').check()
    await expect(video.locator('.version-compare video')).toHaveCount(2)
    expect(
      (await read()).entities.find((e) => e.id === initial.id),
    ).toMatchObject({
      confirmedVideoAssetVersionId:
        pinned?.kind === 'shot' ? pinned.confirmedVideoAssetVersionId : null,
    })
    await page.screenshot({
      path: 'test-results/video-production.png',
      fullPage: true,
    })
    await application.close()
    application = await launch(directory)
    page = await application.firstWindow()
    await expect(page.locator('.topbar strong')).toHaveText(
      '雨夜来信 · 示例短剧',
    )
    expect(
      (await read()).entities.find((e) => e.id === initial.id),
    ).toMatchObject({
      confirmedVideoAssetVersionId:
        pinned?.kind === 'shot' ? pinned.confirmedVideoAssetVersionId : null,
    })
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
test('production board runs continuity, batch video, version-bound QC, strict completion and manifest export', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-production-smoke-'))
  let application = await launch(directory)
  try {
    let page = await application.firstWindow()
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await page.getByRole('button', { name: '高级模式', exact: true }).click()
    await openLegacy(page, '生产看板')
    await expect(
      page.getByRole('heading', { name: '生产看板', exact: true }),
    ).toBeVisible()
    await page
      .getByText('项目生产设置与 Provider 能力', { exact: true })
      .click()
    await page.getByLabel('QC 完成标准').selectOption('strict')
    await page
      .getByRole('button', { name: '保存生产设置', exact: true })
      .click()
    const card = page.getByRole('article', {
      name: '生产镜头 雨中车站全景',
      exact: true,
    })
    await card
      .getByRole('button', { name: '读取 / 编辑连续性', exact: true })
      .click()
    const editor = card.getByRole('form', { name: '连续性编辑' })
    await editor
      .getByLabel('服装', { exact: true })
      .first()
      .fill('雨后湿红外套')
    await editor.getByLabel('修改来源').selectOption('plot')
    await editor
      .getByRole('button', { name: '保存连续性', exact: true })
      .click()
    await expect(editor.getByText('连续性已保存，后续镜头将继承')).toBeVisible()
    await card.getByText('关键帧生产与审核', { exact: true }).click()
    const image = card.locator('.visual-panel')
    await image.getByRole('button', { name: '编译并编辑 Prompt' }).click()
    await expect(image.getByLabel('正向 Prompt')).toHaveValue(/雨后湿红外套/)
    await image.getByRole('button', { name: '生成关键帧', exact: true }).click()
    await image.getByRole('button', { name: '批准 / Promote' }).click()
    await card.getByText('Visual / Video QC', { exact: true }).click()
    await card
      .getByRole('button', { name: '运行 Mock QC', exact: true })
      .click()
    await card
      .getByRole('button', { name: 'Accept QC', exact: true })
      .first()
      .click()
    await page
      .getByRole('button', { name: '仅选可生产视频', exact: true })
      .click()
    await page
      .getByRole('button', { name: '预览批量视频生产', exact: true })
      .click()
    const preview = page.getByRole('article', {
      name: '批量视频预览',
      exact: true,
    })
    await expect(
      preview.getByRole('button', { name: '确认开始批量视频生产' }),
    ).toBeDisabled()
    await preview.getByRole('checkbox').check()
    await preview.getByRole('button', { name: '确认开始批量视频生产' }).click()
    await card.getByText('视频生产与审核', { exact: true }).click()
    const video = card.locator('.video-panel')
    const version = video.getByRole('article', { name: '版本 1', exact: true })
    await expect(version).toBeVisible({ timeout: 20000 })
    await expect(card.getByLabel('QC 素材版本').locator('option')).toHaveCount(
      2,
    )
    const videoId = await card
      .getByLabel('QC 素材版本')
      .locator('option')
      .filter({ hasText: 'video/mp4' })
      .getAttribute('value')
    await card.getByLabel('QC 素材版本').selectOption(videoId!)
    await card
      .getByRole('button', { name: '运行 Mock QC', exact: true })
      .click()
    await card
      .getByRole('button', { name: 'Accept QC', exact: true })
      .first()
      .click()
    await version
      .getByRole('button', { name: 'Approve 视频版本', exact: true })
      .click()
    await version
      .getByRole('button', { name: 'Confirm for Shot', exact: true })
      .click()
    await expect(
      card.getByText(
        /Keyframe: confirmed · Video: confirmed · QC: passed · Production Complete/,
      ),
    ).toBeVisible()
    const path = join(directory, 'production.json')
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, path)
    await page.getByRole('button', { name: /导出.*Manifest/ }).click()
    await expect(page.getByRole('alert')).toContainText(
      'Production Manifest 已导出',
    )
    const fs = await import('node:fs/promises')
    const manifest = JSON.parse(await fs.readFile(path, 'utf8')) as {
      shots: { confirmedVideoAssetVersionId: string | null }[]
    }
    expect(
      manifest.shots.filter((s) => s.confirmedVideoAssetVersionId),
    ).toHaveLength(1)
    await page.screenshot({
      path: 'test-results/production-board.png',
      fullPage: true,
    })
    await application.close()
    application = await launch(directory)
    page = await application.firstWindow()
    await openLegacy(page, '生产看板')
    await expect(
      page
        .getByRole('article', { name: '生产镜头 雨中车站全景', exact: true })
        .getByText(/Production Complete/),
    ).toBeVisible()
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('simple production validation, task center, backup restore and diagnostics work through safe IPC', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-validation-smoke-'))
  const application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('region', { name: '首次设置' })).toBeVisible()
    await page
      .getByRole('button', { name: '5. 进入工作台 / 暂时跳过设置' })
      .click()
    await page.getByRole('button', { name: '验收与维护', exact: true }).click()
    await page.getByRole('button', { name: '创建 3 Shot 验收项目' }).click()
    await openLegacy(page, '生产看板')
    await expect(
      page.getByRole('button', { name: '高级模式', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('article', { name: /生产镜头/ })).toHaveCount(3)
    const card = page.getByRole('article', {
      name: '生产镜头 雨中车站全景',
      exact: true,
    })
    await expect(card.getByRole('status')).toContainText('下一步：生成关键帧')
    await card.getByRole('button', { name: '生成关键帧', exact: true }).click()
    await expect(card.getByRole('status')).toContainText('下一步：审核关键帧')
    await card.getByText('关键帧 / 视频审核', { exact: true }).click()
    await card
      .getByRole('button', { name: '批准 / Promote', exact: true })
      .click()
    await expect(card.getByRole('status')).toContainText('下一步：生成视频')
    await card.getByText('生成视频（单镜头确认）', { exact: true }).click()
    await card
      .getByRole('button', { name: '预览单镜头最小测试', exact: true })
      .click()
    await expect(
      card.getByRole('button', { name: 'Test Submit · 确认提交' }),
    ).toBeDisabled()
    await card.getByRole('checkbox', { name: /允许提交这一镜头/ }).check()
    await card.getByRole('button', { name: 'Test Submit · 确认提交' }).click()
    await expect(card.getByRole('status')).toContainText('下一步：审核视频')
    const media = card.locator('video').first()
    await expect(media).toBeVisible()
    await expect
      .poll(() => media.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThan(0)
    expect(await media.getAttribute('src')).toMatch(
      /^director-media:\/\/asset\//,
    )
    await openLegacyGeneration(page)
    await expect(
      page.getByRole('heading', { name: '任务中心', exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/mock-video · succeeded/)).toBeVisible()
    await page.getByRole('button', { name: '验收与维护', exact: true }).click()
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      })
    }, directory)
    await page
      .getByRole('button', { name: 'Backup Project', exact: true })
      .click()
    await expect(page.locator('main').getByRole('status')).toContainText(
      'director-backup-',
    )
    const folder = (await readdir(directory)).find((n) =>
      n.startsWith('director-backup-'),
    )!
    await application.evaluate(
      ({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [folder],
        })
      },
      join(directory, folder),
    )
    await page
      .getByRole('button', { name: 'Restore Project', exact: true })
      .click()
    await expect(page.locator('.topbar strong')).toContainText('恢复')
    await page.getByRole('button', { name: '验收与维护', exact: true }).click()
    await application.evaluate(
      ({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: path,
        })
      },
      join(directory, 'diagnostics.json'),
    )
    await page
      .getByRole('button', { name: 'Export Diagnostics', exact: true })
      .click()
    await expect(page.locator('main').getByRole('status')).toContainText(
      'diagnostics.json',
    )
    await page.screenshot({
      path: 'test-results/production-validation.png',
      fullPage: true,
    })
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('large project startup, switching and paged workspaces handle the production fixture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-performance-smoke-'))
  const db = new ProjectDatabase(join(directory, 'workspace.sqlite'))
  const p = db.seed(buildSeed),
    all = db.workspace(p.id).entities,
    scene = all.find((e) => e.kind === 'scene')!,
    shot = all.find((e) => e.kind === 'shot')!,
    asset = all.find((e) => e.kind === 'asset')!
  if (scene.kind !== 'scene' || shot.kind !== 'shot' || asset.kind !== 'asset')
    throw Error('fixture')
  const scenes = Array.from({ length: 18 }, (_, i) => ({
    ...scene,
    ...metadata(),
    order: i + 2,
    name: '规模场次 ' + i,
  }))
  db.insertEntities(p.id, scenes)
  const sceneIds = [
    ...all.filter((e) => e.kind === 'scene').map((e) => e.id),
    ...scenes.map((e) => e.id),
  ]
  db.insertEntities(
    p.id,
    Array.from({ length: 94 }, (_, i) => ({
      ...shot,
      ...metadata(),
      sceneId: sceneIds[i % 20],
      order: i + 6,
      name: '规模镜头 ' + i,
    })),
  )
  db.transaction(() => {
    for (let i = 0; i < 500; i++) {
      const v = assetVersionSchema.parse({
        ...metadata(),
        projectId: p.id,
        assetId: asset.id,
        versionNumber: i + 1,
        status: 'draft',
        sourceType: 'generated',
        mimeType: 'image/png',
        width: 512,
        height: 768,
        fileSize: 1,
        hash: 'a'.repeat(64),
        storageKey: `${p.id}/${asset.id}/${metadata().id}.png`,
        thumbnailPath: `${p.id}/${asset.id}/${metadata().id}-thumb.webp`,
        provider: 'mock-image',
        model: 'test',
        prompt: 'fixture',
        negativePrompt: '',
        generationTaskId: null,
        sourceAssetIds: [],
        metadata: {},
      })
      db.connection
        .prepare('INSERT INTO asset_versions VALUES (?,?,?,?,?,?)')
        .run(v.id, p.id, asset.id, i + 1, v.hash, JSON.stringify(v))
      const t = aiTaskSchema.parse({
        ...metadata(),
        projectId: p.id,
        input: { type: 'breakdown', targetId: scene.id },
        status: 'succeeded',
        attempt: 1,
        error: null,
        resultIds: [],
        sourceRevisions: {},
      })
      db.connection
        .prepare('INSERT INTO ai_tasks VALUES (?,?,?)')
        .run(t.id, p.id, JSON.stringify(t))
    }
  })
  const other = db.create({
    name: '切换目标',
    description: '',
    genre: '剧情',
    aspectRatio: '9:16',
    language: 'zh-CN',
  })
  db.open(p.id)
  db.close()
  const started = Date.now(),
    application = await launch(directory)
  try {
    const page = await application.firstWindow()
    await expect(page.locator('.topbar strong')).toHaveText(p.name)
    expect(Date.now() - started).toBeLessThan(15000)
    await openLegacy(page, '生产看板')
    await expect(page.getByRole('article', { name: /生产镜头/ })).toHaveCount(
      20,
    )
    await page.getByRole('button', { name: '下一页镜头' }).click()
    await expect(page.getByRole('article', { name: /生产镜头/ })).toHaveCount(
      20,
    )
    await openLegacy(page, '素材库')
    await expect(page.locator('.asset-tile')).toHaveCount(2)
    await openLegacyGeneration(page)
    await expect(page.getByText('共 500 个任务 · 第 1 页')).toBeVisible()
    await page.getByRole('button', { name: '下一页任务' }).click()
    await expect(page.getByText('共 500 个任务 · 第 2 页')).toBeVisible()
    await page.getByLabel('切换项目', { exact: true }).selectOption(other.id)
    await expect(page.locator('.topbar strong')).toHaveText('切换目标')
    await page.getByLabel('切换项目', { exact: true }).selectOption(p.id)
    await openLegacyGeneration(page)
    await expect(page.getByText('共 500 个任务 · 第 1 页')).toBeVisible()
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Image API desktop preview requires explicit confirmation and review before adoption',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'director-image-api-ui-')),server=await imageServer()
  let application=await launch(directory,server.origin)
  try{
    let page=await application.firstWindow()
    await page.getByRole('button',{name:'载入开发示例'}).click()
    await openLegacyGeneration(page)
    const panel=page.getByRole('region',{name:'图像 API 生成'})
    await panel.getByLabel('API 生成目标').selectOption({index:1})
    await panel.getByLabel('图片数量').selectOption('4')
    await panel.getByLabel('宽',{exact:true}).fill('32');await panel.getByLabel('高',{exact:true}).fill('32')
    await panel.getByLabel('允许所选参考图上传云端').check()
    expect(server.counts.submit).toBe(0)
    await panel.getByRole('button',{name:'预览图像生成'}).click()
    await expect(panel.getByRole('region',{name:'图像生成确认'})).toBeVisible()
    expect(server.counts.submit).toBe(0)
    const confirm=panel.getByRole('button',{name:'确认生成（可能收费）'})
    await expect(confirm).toBeDisabled()
    await panel.getByLabel('最大授权微金额').fill('20')
    await panel.getByLabel('我明确允许未知估价，并授权上述费用上限').check()
    await confirm.click()
    await expect.poll(()=>server.counts.submit).toBe(1)
    await expect.poll(async()=>{await panel.getByRole('button',{name:'刷新生成结果'}).click();return panel.locator('article').count()}).toBe(4)
    await panel.getByRole('button',{name:'审核并采用到目标'}).first().click()
    await expect(panel.getByText('v1 · approved',{exact:true})).toBeVisible()
    const denied=await page.evaluate(()=>window.desktop!.workspace.request({action:'imageApi',command:{op:'preview',endpoint:'file:///secret',input:{}}} as never))
    expect(denied.ok).toBe(false)
    await application.close();application=await launch(directory,server.origin);page=await application.firstWindow()
    await openLegacyGeneration(page)
    await expect(page.getByRole('region',{name:'图像 API 生成'}).getByText('v1 · approved',{exact:true})).toBeVisible()
    expect(server.counts.submit).toBe(1)
  }finally{await application.close();await server.close();await rm(directory,{recursive:true,force:true})}
})


test('workflow desktop creates, confirms once, resumes review after restart and explicitly adopts Shot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-workflow-ui-')), server = await imageServer()
  let application = await launch(directory, server.origin)
  try {
    let page = await application.firstWindow()
    await page.getByRole('button', { name: '载入开发示例' }).click()
    const projectResult = await page.evaluate(() => window.desktop!.workspace.request({ action: 'projects.list' }))
    if (!projectResult.ok || !Array.isArray(projectResult.data)) throw new Error('missing project')
    const projectId = String((projectResult.data[0] as { id: string }).id)
    const workspace = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workspace.get', id }), projectId)
    if (!workspace.ok) throw new Error('missing workspace')
    const shot = workspaceSchema.parse(workspace.data).entities.find(e => e.kind === 'shot')!
    await openLegacyGeneration(page)
    const image = page.getByRole('region', { name: '图像 API 生成' })
    await image.getByLabel('API 生成目标').selectOption(shot.id)
    await image.getByLabel('宽', { exact: true }).fill('32')
    await image.getByLabel('高', { exact: true }).fill('32')
    await image.getByLabel('允许所选参考图上传云端').check()
    await image.getByRole('button', { name: '创建 Shot 关键帧工作流（单图）' }).click()
    let workflow = page.getByRole('region', { name: '制作工作流' })
    await expect(workflow.getByRole('button', { name: '确认工作流生成' })).toBeVisible()
    expect(server.counts.submit).toBe(0)
    await expect(workflow.getByRole('button', { name: '确认工作流生成' })).toBeDisabled()
    await workflow.getByLabel('工作流费用上限', { exact: false }).fill('20')
    await workflow.getByLabel('允许未知估价', { exact: false }).check()
    await workflow.getByLabel('我确认本次执行及费用授权').check()
    await workflow.getByRole('button', { name: '确认工作流生成' }).click()
    await expect(workflow.getByRole('button', { name: '批准候选（尚不绑定）' })).toBeVisible()
    expect(server.counts.submit).toBe(1)
    await application.close()
    application = await launch(directory, server.origin)
    page = await application.firstWindow()
    await openLegacyGeneration(page)
    workflow = page.getByRole('region', { name: '制作工作流' })
    await workflow.getByRole('button', { name: '批准候选（尚不绑定）' }).click()
    await workflow.getByRole('button', { name: '采用到 Shot', exact: true }).click()
    await expect(workflow.getByRole('status')).toContainText('已完成')
    const after = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workspace.get', id }), projectId)
    if (!after.ok) throw new Error(after.message)
    const bound = workspaceSchema.parse(after.data).entities.find(e => e.id === shot.id)
    expect(bound?.kind === 'shot' && bound.approvedKeyframeVersionId).toBeTruthy()
    if (bound?.kind !== 'shot' || !bound.approvedKeyframeVersionId) throw new Error('missing adopted version')
    const lineage = await page.evaluate(({ projectId, versionId }) => window.desktop!.workspace.request({ action: 'compatibility', command: { op: 'lineage', projectId, versionId } }), { projectId, versionId: bound.approvedKeyframeVersionId })
    if (!lineage.ok) throw new Error(lineage.message)
    expect(lineageSchema.parse(lineage.data).status).toBe('Adopted')
    expect(lineageSchema.parse(lineage.data).links.workflowRunId).toBeTruthy()
    await workflow.getByText('来源 / 费用 / 工作流', { exact: true }).first().click()
    await expect(workflow.getByText('Generated · succeeded', { exact: true })).toBeVisible()
    await page.reload()
    await openLegacyGeneration(page)
    await expect(page.getByRole('region', { name: '制作工作流' }).getByRole('status')).toContainText('已完成')
    expect(server.counts.submit).toBe(1)
    const denied = await page.evaluate((id) => window.desktop!.workspace.request({ action: 'workflow', command: { op: 'resumeWorkflowRun', projectId: id, runId: id, status: 'succeeded' } } as never), projectId)
    expect(denied.ok).toBe(false)
  } finally { await application.close(); await server.close(); await rm(directory, { recursive: true, force: true }) }
})

test('pre-v7 project opens legacy Bible, storyboard, generation, tasks and missing provenance without new metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-legacy-ui-'))
  const legacy = createV6(join(directory, 'workspace.sqlite'))
  const application = await launch(directory)
  try {
    const page = await application.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    for (const name of ['角色','场景','道具','分镜','生成','素材库']) {
      if (name === '角色' || name === '场景' || name === '道具') await openAssetTab(page, name)
      else if (name === '素材库') await openLegacy(page, name)
      else await page.getByRole('button', { name, exact: true }).click()
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    await page.locator('.asset-tile').first().click()
    const summary = page.getByText('来源 / 费用 / 工作流', { exact: true }).first()
    await summary.click()
    await expect(page.getByText('Legacy / provenance unavailable · approved', { exact: true })).toBeVisible()
    const result = await page.evaluate(({ projectId, versionId }) => window.desktop!.workspace.request({ action: 'compatibility', command: { op: 'lineage', projectId, versionId } }), { projectId: legacy.project.id, versionId: legacy.version.id })
    if (!result.ok) throw new Error(result.message)
    expect(lineageSchema.parse(result.data).links.recordId).toBeNull()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const readiness = page.getByRole('region', { name: 'Tool readiness' })
    await expect(readiness.getByText('real-local-validated', { exact: true })).toBeVisible()
    await expect(readiness.getByText('real-generation-partially-validated', { exact: true })).toBeVisible()
    await expect(readiness.getByText('not-validated', { exact: true })).toBeVisible()
    await expect(readiness.getByText('development-test-only', { exact: true }).first()).toBeVisible()
    await openLegacyGeneration(page)
    await expect(page.getByText(/Legacy Task ·/)).toBeVisible()
    expect(errors).toEqual([])
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }) }
})
