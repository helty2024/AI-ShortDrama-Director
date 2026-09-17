import { connect } from 'node:net'
// Read-only remote probe; never imports generation-service or opens a project database.
import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EncryptedCredentialStore } from '../video/credentials.js'
import {
  PackyImage25Adapter,
  packyImage25ProfileSchema,
} from './adapters/packy-image-25.js'
import { loadImageProfiles } from '../generation/image-profiles.js'

let phase = 'electron-ready'
async function probe() {
  process.stdout.write('Probe: waiting for Electron ready\n')
  await app.whenReady()
  process.stdout.write('Probe: Electron ready\n')
  phase = 'profile-loading'
  const root = join(app.getPath('appData'), 'ai-shortdrama-director')
  const credentials = new EncryptedCredentialStore(join(root, 'credentials'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  })
  const path = join(root, 'image-api-profiles.json')
  const profiles = await loadImageProfiles(path)
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!Array.isArray(raw) || raw.length !== profiles.length)
      throw new Error('Invalid profile file')
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e
  }
  let profile = profiles.find(
    (p) => 'adapter' in p && p.adapter === 'packy-image-25',
  )
  if (process.argv.includes('--import-key-stdin')) {
    phase = 'secret-input'
    process.stdout.write('Probe: waiting for secure input\n')
    const pipe = process.argv
      .find((a) => a.startsWith('--secret-pipe='))
      ?.slice(14)
    if (!pipe || !/^director-packy-[a-f0-9-]+$/.test(pipe))
      throw new Error('Invalid input channel')
    const channel = connect(
      ['', '', '.', 'pipe', pipe].join(String.fromCharCode(92)),
    )
    const secret = await new Promise<string>((resolve, reject) => {
      let buffer = ''
      const timer = setTimeout(() => reject(new Error('Input timeout')), 120000)
      channel.setEncoding('utf8')
      channel.on('error', reject)
      channel.on('data', (data: string) => {
        buffer += data
        if (buffer.length > 8192) {
          clearTimeout(timer)
          reject(new Error('Input too long'))
          return
        }
        if (buffer.includes('\n')) {
          clearTimeout(timer)
          channel.destroy()
          resolve(buffer.trim())
          buffer = ''
        }
      })
    })
    profile = packyImage25ProfileSchema.parse(
      profile ?? {
        adapter: 'packy-image-25',
        toolId: 'packy.image-25',
        displayName: 'PackyAPI · GPT Image 2.5 Sunburst',
        modelId: 'gpt-image-2.5-sunburst',
        tokenGroup: 'Image',
        credentialRef: randomUUID(),
        currency: 'USD',
      },
    )
    profile = {
      ...profile,
      credentialRef: profile.credentialRef ?? randomUUID(),
    }
    phase = 'secure-storage'
    await credentials.set(profile.credentialRef!, secret)
    await mkdir(root, { recursive: true })
    await writeFile(
      path + '.tmp',
      JSON.stringify([
        ...profiles.filter((p) => p.toolId !== profile!.toolId),
        profile,
      ]),
    )
    await rename(path + '.tmp', path)
  }
  if (!profile || !profile.credentialRef)
    throw new Error('Packy not configured')
  const ref = profile.credentialRef
  phase = 'models-request'
  const adapter = new PackyImage25Adapter(
    packyImage25ProfileSchema.parse(profile),
    () => credentials.get(ref),
  )
  const report = await adapter.probeConnectivity(AbortSignal.timeout(15000))
  const reportPath = join(root, 'diagnostics', 'packy-connectivity.json')
  await mkdir(join(root, 'diagnostics'), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  process.stdout.write(JSON.stringify({ ...report, reportPath }) + '\n')
}
void probe()
  .then(() => app.exit(0))
  .catch(() => {
    process.stdout.write(
      'Packy connectivity probe failed at ' +
        phase +
        '; no generation requested.\n',
    )
    app.exit(1)
  })
