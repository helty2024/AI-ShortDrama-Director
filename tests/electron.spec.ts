import { test, expect, _electron as electron } from '@playwright/test'

test('desktop starts with an isolated preload bridge', async () => {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value
  }
  delete environment.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({ args: ['.'], env: environment })
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: '让故事，从这里开始。' })).toBeVisible()
    await expect(page.getByText('桌面环境已连接', { exact: false })).toBeVisible()
    const isolated = await page.evaluate(() => ({
      bridge: Boolean(window.desktop?.versions.electron),
      require: typeof Reflect.get(window, 'require'),
    }))
    expect(isolated).toEqual({ bridge: true, require: 'undefined' })
  } finally {
    await application.close()
  }
})
