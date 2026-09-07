import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
