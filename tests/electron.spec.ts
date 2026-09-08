import { ProjectDatabase, metadata } from '../electron/main/database.js'
import { buildSeed } from '../electron/main/seed.js'
import { aiTaskSchema } from '../src/shared/intelligence.js'
import { assetVersionSchema } from '../src/shared/visual.js'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import sharp from 'sharp'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Request } from '../src/shared/api.js'
import { workspaceSchema } from '../src/shared/domain.js'

async function launch(directory: string) {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) environment[key] = value
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  environment.DIRECTOR_TEST_USER_DATA = directory
  environment.DIRECTOR_TEXT_PROVIDER = 'mock'
  return electron.launch({ args: ['.'], env: environment })
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
    await page.getByRole('button', { name: '重命名', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('重命名短剧')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: '重命名短剧', exact: true }),
    ).toBeVisible()
    await application.close()
    application = await launch(directory)
    page = await application.firstWindow()
    await expect(
      page.getByRole('heading', { name: '重命名短剧', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.topbar strong')).toHaveText('重命名短剧')
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByLabel('确认项目名').fill('重命名短剧')
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(page.locator('.topbar strong')).toHaveText('尚未打开项目')
    await page.getByRole('button', { name: '载入开发示例' }).click()
    await expect(page.locator('.topbar strong')).toHaveText(
      '雨夜来信 · 示例短剧',
    )
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await expect(
      page.getByRole('region', { name: '角色列表' }).getByRole('listitem'),
    ).toHaveCount(3)
    await page.getByRole('button', { name: '新增角色', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('新角色')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(
      page.getByRole('region', { name: '角色列表' }).getByRole('listitem'),
    ).toHaveCount(4)
    await page.getByRole('button', { name: '分镜', exact: true }).click()
    await expect(
      page.getByRole('region', { name: '镜头列表' }).getByRole('listitem'),
    ).toHaveCount(6)
    await page.screenshot({
      path: 'test-results/workspace.png',
      fullPage: true,
    })
    for (const name of ['剧本', '场景', '道具', '生成', '素材库']) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(
        page.getByRole('heading', { name, exact: true }),
      ).toBeVisible()
    }
    const seedId = await page
      .getByRole('combobox', { name: '切换项目' })
      .inputValue()
    await page.getByRole('button', { name: '项目', exact: true }).click()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('空白项目')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await expect(
      page.getByRole('region', { name: '角色列表' }).getByRole('listitem'),
    ).toHaveCount(0)
    await page.getByRole('combobox', { name: '切换项目' }).selectOption(seedId)
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
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await expect(page.getByLabel('动作', { exact: true })).toHaveValue(
      '冲突时保留的本地修改',
    )
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: '放弃本地修改并重新载入' }).click()
    await expect(page.getByRole('status')).toHaveText('已保存到本地')
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
    await page.getByRole('button', { name: '角色', exact: true }).click()
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
    await page.getByRole('button', { name: '角色', exact: true }).click()
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
    await page.getByRole('button', { name: '分镜', exact: true }).click()
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
    await page.getByRole('button', { name: '素材库', exact: true }).click()
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
    await page.getByRole('button', { name: '分镜', exact: true }).click()
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
    await page.getByRole('button', { name: 'Advanced', exact: true }).click()
    await page.getByRole('button', { name: '生产看板', exact: true }).click()
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
    await page.getByRole('button', { name: '生产看板', exact: true }).click()
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
    await page.getByRole('button', { name: '生产看板', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Advanced', exact: true }),
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
    await page.getByRole('button', { name: '生成', exact: true }).click()
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
    await page
      .getByRole('button', { name: '5. 进入工作台 / 暂时跳过设置' })
      .click()
    await page.getByRole('button', { name: '生产看板', exact: true }).click()
    await expect(page.getByRole('article', { name: /生产镜头/ })).toHaveCount(
      20,
    )
    await page.getByRole('button', { name: '下一页镜头' }).click()
    await expect(page.getByRole('article', { name: /生产镜头/ })).toHaveCount(
      20,
    )
    await page.getByRole('button', { name: '素材库', exact: true }).click()
    await expect(page.locator('.asset-tile')).toHaveCount(2)
    await page.getByRole('button', { name: '生成', exact: true }).click()
    await expect(page.getByText('共 500 个任务 · 第 1 页')).toBeVisible()
    await page.getByRole('button', { name: '下一页任务' }).click()
    await expect(page.getByText('共 500 个任务 · 第 2 页')).toBeVisible()
    await page.getByLabel('切换项目', { exact: true }).selectOption(other.id)
    await expect(page.locator('.topbar strong')).toHaveText('切换目标')
    await page.getByLabel('切换项目', { exact: true }).selectOption(p.id)
    await expect(page.getByText('共 500 个任务 · 第 1 页')).toBeVisible()
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
