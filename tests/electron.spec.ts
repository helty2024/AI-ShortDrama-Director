import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Request } from '../src/shared/api.js'

async function launch(directory: string) {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) environment[key] = value
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  environment.DIRECTOR_TEST_USER_DATA = directory
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
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    const seedId = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
    await page.getByRole('button', { name: '项目', exact: true }).click()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill('空白项目')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await expect(page.getByRole('region', { name: '角色列表' }).getByRole('listitem')).toHaveCount(0)
    await page.getByRole('combobox', { name: '切换项目' }).selectOption(seedId)
    await expect(page.getByRole('region', { name: '角色列表' }).getByRole('listitem')).toHaveCount(4)
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
