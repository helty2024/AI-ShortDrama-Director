import { _electron as electron, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAlphaJourney, closeDetails } from '../tests/fixtures/alpha-journey.js'
import { aboutSchema } from '../src/shared/operations.js'

const [executable, dataArg, reportArg] = process.argv.slice(2)
if (!executable || !dataArg || !reportArg) throw new Error('Usage: tsx scripts/verify-alpha.ts <installed-exe> <isolated-data> <report>')
const root = resolve(tmpdir(), 'ai-shortdrama-director-release-tests')
const data = resolve(dataArg), report = resolve(reportArg)
for (const target of [data, report]) {
  const scope = relative(root, target)
  if (!scope || scope.startsWith('..') || isAbsolute(scope)) throw new Error('Acceptance output must stay within release test temp root')
}
await mkdir(data, { recursive: true })
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), DIRECTOR_TEST_USER_DATA: data, DIRECTOR_RELEASE_VALIDATION: '0.7.0-rc' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let app = await electron.launch({ executablePath: resolve(executable), env })
try {
  let page = await app.firstWindow()
  const about = await page.evaluate(() => window.desktop!.workspace.request({ action: 'operations', command: { operation: 'about' } }))
  if (!about.ok) throw new Error(about.message)
  const details = aboutSchema.parse(about.data)
  expect(details.version).toBe('0.9.0-alpha.1')
  expect(details.ffmpeg).not.toMatch(/^Not available/)
  expect(details.ffprobe).not.toMatch(/^Not available/)
  const journey = await runAlphaJourney(app, data, join(resolve(report, '..'), 'screenshots'))
  await app.close()
  app = await electron.launch({ executablePath: resolve(executable), env })
  page = await app.firstWindow()
  await expect(page.getByRole('navigation', { name: '创作阶段' })).toBeVisible()
  await page.getByRole('navigation', { name: '创作阶段' }).getByRole('button', { name: '分镜视频', exact: true }).click()
  await closeDetails(page)
  await expect(page.getByRole('region', { name: '镜头视频播放器' })).toContainText('当前确认视频')
  await expect.poll(() => page.locator('.shot-videos-screen video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  await writeFile(report, JSON.stringify({ version: details.version, schema: details.schema, installedJourney: 'PASS', restart: 'PASS', fixtureVideo: 'PASS', realVideoSubmit: 'disabled', ...journey }, null, 2) + '\n')
  console.log('Installed Alpha journey and restart: PASS')
} finally { await app.close() }
