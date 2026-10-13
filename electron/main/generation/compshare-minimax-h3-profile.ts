import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { compshareProfileSchema, type CompShareProfile } from '../../../src/shared/compshare-minimax-h3.js'
import { DomainError } from '../database.js'
import type { CredentialStore } from '../video/credentials.js'
import { CompShareMiniMaxH3Adapter } from '../tools/adapters/compshare-minimax-h3.js'
import type { ImageHttpTransport } from '../tools/adapters/image-http.js'
import type { VideoApiGenerationService } from './video-api-service.js'

export const compshareProfileFileName = 'compshare-minimax-h3-profile.json'
export const legacyVideoProfileFileName = 'video-api-profiles.json'

type ProfileRegistration = Pick<VideoApiGenerationService, 'registry' | 'register'>
const importing = new WeakSet<ProfileRegistration>()
const legacyProfilesSchema = z.array(compshareProfileSchema).max(1)

async function profileFile(path: string): Promise<string | null> {
  try {
    const file = await stat(path)
    if (!file.isFile() || file.size > 64000) throw new DomainError('INVALID_INPUT', 'CompShare 配置文件无效')
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

export async function readCompShareProfile(path: string): Promise<CompShareProfile | null> {
  const raw = await profileFile(path)
  return raw === null ? null : compshareProfileSchema.parse(JSON.parse(raw))
}

/** Copy only the legacy credential reference; leave the old file and encrypted secret untouched. */
export async function loadCompShareProfile(path: string, legacyPath: string): Promise<CompShareProfile | null> {
  const current = await readCompShareProfile(path)
  if (current) return current
  const raw = await profileFile(legacyPath)
  if (raw === null) return null
  const [legacy] = legacyProfilesSchema.parse(JSON.parse(raw))
  if (!legacy) return null
  try {
    await writeFile(path, JSON.stringify(legacy), { flag: 'wx', mode: 0o600 })
    return legacy
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      const concurrent = await readCompShareProfile(path)
      if (concurrent && concurrent.credentialRef === legacy.credentialRef) return concurrent
    }
    throw new DomainError('CONFLICT', 'CompShare 旧配置迁移失败；原配置保留')
  }
}

export function createCompShareAdapter(profile: CompShareProfile, credentials: CredentialStore, transport?: ImageHttpTransport) {
  const validated = compshareProfileSchema.parse(profile)
  return new CompShareMiniMaxH3Adapter(validated, async () => {
    if (!validated.credentialRef) throw new Error('Credential missing')
    return credentials.get(validated.credentialRef)
  }, transport)
}

export async function importCompShareCredential(path: string, legacyPath: string, keyFile: string, credentials: CredentialStore, service: ProfileRegistration) {
  if (importing.has(service)) throw new DomainError('CONFLICT', '凭据导入正在进行')
  importing.add(service)
  try {
    if (service.registry.list().some(entry => entry.descriptor.id === 'compshare.minimax-h3') || await loadCompShareProfile(path, legacyPath))
      throw new DomainError('CONFLICT', 'CompShare 已配置；当前基线不提供凭据替换')
    if ((await stat(keyFile)).size > 8192) throw new DomainError('INVALID_INPUT', '密钥文件过大')
    const key = (await readFile(keyFile, 'utf8')).trim()
    if (!/^sk-ml-[a-zA-Z0-9_-]+$/.test(key) || key.length > 8192) throw new DomainError('INVALID_INPUT', '请使用 CompShare sk-ml- 模型密钥')
    const profile = compshareProfileSchema.parse({ adapter: 'compshare-minimax-h3', toolId: 'compshare.minimax-h3', modelId: 'MiniMax-H3', credentialRef: randomUUID() })
    const adapter = createCompShareAdapter(profile, credentials)
    adapter.describe()
    await credentials.set(profile.credentialRef!, key)
    await writeFile(path, JSON.stringify(profile), { flag: 'wx', mode: 0o600 })
    service.register(adapter)
    return null
  } finally {
    importing.delete(service)
  }
}
