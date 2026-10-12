import { readFile, writeFile, stat, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { compshareProfileSchema, CompShareMiniMaxH3Adapter, type CompShareProfile } from '../tools/adapters/compshare-minimax-h3.js'
import type { CredentialStore } from '../video/credentials.js'
import type { VideoApiGenerationService } from './video-api-service.js'
import { DomainError } from '../database.js'

const profilesSchema = z.array(compshareProfileSchema).max(1)
const importing = new WeakSet<VideoApiGenerationService>()
export async function loadVideoProfiles(path: string): Promise<CompShareProfile[]> {
  try {
    if ((await stat(path)).size > 64000) return []
    return profilesSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch { return [] }
}
export function videoAdapters(profiles: CompShareProfile[], credentials: CredentialStore) {
  return profilesSchema.parse(profiles).map(profile => new CompShareMiniMaxH3Adapter(profile, async () => {
    if (!profile.credentialRef) throw new Error('Credential missing')
    return credentials.get(profile.credentialRef)
  }))
}
export async function importCompShareCredential(path: string, keyFile: string, credentials: CredentialStore, service: VideoApiGenerationService) {
  if (importing.has(service)) throw new DomainError('CONFLICT', '凭据导入正在进行')
  importing.add(service)
  try {
    return await saveCredential(path, keyFile, credentials, service)
  } finally { importing.delete(service) }
}

async function saveCredential(path: string, keyFile: string, credentials: CredentialStore, service: VideoApiGenerationService) {
  if ((await stat(keyFile)).size > 8192) throw new DomainError('INVALID_INPUT', '密钥文件过大')
  const key = (await readFile(keyFile, 'utf8')).trim()
  if (!/^sk-ml-[a-zA-Z0-9_-]+$/.test(key) || key.length > 8192) throw new DomainError('INVALID_INPUT', '请使用 CompShare sk-ml- 模型密钥')
  if (service.registry.list().some(entry => entry.descriptor.id === 'compshare.minimax-h3')) throw new DomainError('CONFLICT', 'CompShare 已配置；当前基线不提供凭据替换')
  // Preserve an existing malformed or unsupported user configuration.
  try {
    const existing = await stat(path)
    if (existing.size > 64000 || !existing.isFile()) throw new DomainError('CONFLICT', '已有视频配置无法读取，请先核对配置')
    profilesSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    throw new DomainError('CONFLICT', '已有视频配置，请重启并核对配置')
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw new DomainError('CONFLICT', '保留已有视频配置，请先核对文件')
  }
  const profile = compshareProfileSchema.parse({ adapter: 'compshare-minimax-h3', toolId: 'compshare.minimax-h3', modelId: 'MiniMax-H3', credentialRef: randomUUID() })
  const adapter = videoAdapters([profile], credentials)[0]!
  adapter.describe()
  await credentials.set(profile.credentialRef!, key)
  await writeFile(path + '.tmp', JSON.stringify([profile]), { mode: 0o600 })
  await rename(path + '.tmp', path)
  service.register(adapter)
  return null
}
