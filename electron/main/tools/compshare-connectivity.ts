import { app, dialog, safeStorage } from 'electron'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { EncryptedCredentialStore } from '../video/credentials.js'
import { compshareProfileFileName, legacyVideoProfileFileName, loadCompShareProfile, importCompShareCredential, createCompShareAdapter } from '../generation/compshare-minimax-h3-profile.js'
import { ToolRegistry } from './registry.js'
import { ImageHttpTransport } from './adapters/image-http.js'
import { isolatedUserData } from '../release-validation.js'

// Standalone read-only probe. No project database, generation service or application window.
async function run() {
  await app.whenReady()
  const args = process.argv.slice(2)
  const keyIndex = args.indexOf('--import-key-file')
  const configure = args.includes('--configure')
  const valid = args.length === 0 || (args.length === 1 && args[0] === '--configure') ||
    (args.length === 2 && args[0] === '--import-key-file' && Boolean(args[1]) && !args[1].startsWith('--'))
  if (!valid) throw new Error('Invalid arguments')
  const testRoot = isolatedUserData(app.isPackaged, process.env)
  const root = testRoot ?? join(app.getPath('appData'), 'ai-shortdrama-director')
  const testOrigin = testRoot ? process.env.DIRECTOR_TEST_COMPSHARE_ORIGIN : undefined
  if (testOrigin) {
    const url = new URL(testOrigin)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== testOrigin) throw new Error('Invalid fixture origin')
  }
  const credentials = new EncryptedCredentialStore(join(root, 'credentials'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: value => safeStorage.encryptString(value),
    decrypt: value => safeStorage.decryptString(value),
  })
  const profilePath = join(root, compshareProfileFileName)
  const legacyPath = join(root, legacyVideoProfileFileName)
  let keyFile = keyIndex >= 0 ? args[keyIndex + 1] : null
  if (configure) {
    const selected = await dialog.showOpenDialog({
      title: 'CompShare MiniMax H3：选择 API Key 文件（加密保存，仅检测鉴权）',
      properties: ['openFile'], filters: [{ name: 'API Key 文本', extensions: ['txt', 'key'] }],
    })
    if (selected.canceled || !selected.filePaths[0]) {
      process.stdout.write('已取消；未保存凭据、未请求服务。\n')
      return 2
    }
    keyFile = selected.filePaths[0]
  }
  if (keyFile) {
    const registry = new ToolRegistry()
    await mkdir(root, { recursive: true })
    await importCompShareCredential(profilePath, legacyPath, keyFile, credentials, { registry, register: adapter => registry.register(adapter) })
    process.stdout.write('CompShare 凭据已加密保存。\n')
  }
  const profile = await loadCompShareProfile(profilePath, legacyPath)
  if (!profile?.credentialRef) {
    process.stdout.write('CompShare 尚未配置；请运行 npm run validate:compshare -- --configure。\n')
    return 2
  }
  const transport = new ImageHttpTransport(testOrigin ? { fixtureOrigin: testOrigin } : {})
  const adapter = createCompShareAdapter(profile, credentials, transport)
  const result = await adapter.probe(AbortSignal.timeout(15000))
  const report = {
    ...result, provider: 'CompShare', model: 'MiniMax-H3', baseEndpoint: 'https://cp.compshare.cn',
    method: 'GET', requestPath: '/minimax/v2/query/point_usage_summary',
    evidence: testOrigin ? 'local-fixture' : 'real-read-only-probe', generationSubmitCount: 0,
  }
  const reportPath = join(root, 'diagnostics', 'compshare-connectivity.json')
  await mkdir(join(root, 'diagnostics'), { recursive: true })
  await writeFile(reportPath + '.tmp', JSON.stringify(report, null, 2), { mode: 0o600 })
  await rename(reportPath + '.tmp', reportPath)
  process.stdout.write(JSON.stringify({ ...report, reportPath }) + '\n')
  return result.authenticated ? 0 : 1
}
void run().then(code => app.exit(code)).catch(() => {
  process.stdout.write('CompShare 配置或检测失败；请核对密钥文件、已有配置及系统加密能力。未提交生成任务。\n')
  app.exit(1)
})
