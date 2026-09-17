import { readFile, writeFile, stat, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { imageApiProfileSchema } from '../../../src/shared/image-api.js'
import type { CredentialStore } from '../video/credentials.js'
import {
  PackyImage25Adapter,
  packyImage25ProfileSchema,
} from '../tools/adapters/packy-image-25.js'
import { ImageApiAdapter } from '../tools/adapters/image-api.js'
import type { ImageGenerationService } from './image-service.js'
const storedProfileSchema = z.union([
  imageApiProfileSchema,
  packyImage25ProfileSchema,
])
type StoredProfile = z.infer<typeof storedProfileSchema>
export async function loadImageProfiles(
  path: string,
): Promise<StoredProfile[]> {
  try {
    return z
      .array(storedProfileSchema)
      .max(20)
      .parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return []
  }
}
export function imageAdapters(
  profiles: StoredProfile[],
  credentials: CredentialStore,
) {
  return profiles.map((p) => {
    const credential = async () => {
      if (!p.credentialRef) throw new Error('credential missing')
      return credentials.get(p.credentialRef)
    }
    return 'adapter' in p
      ? new PackyImage25Adapter(p, credential)
      : new ImageApiAdapter(p, credential)
  })
}
export async function importImageProfile(
  path: string,
  profileFile: string,
  keyFile: string,
  credentials: CredentialStore,
  service: ImageGenerationService,
) {
  if (
    (await stat(profileFile)).size > 64000 ||
    (await stat(keyFile)).size > 8192
  )
    throw new Error('File too large')
  const raw = await readFile(profileFile, 'utf8')
  if (raw.length > 64000) throw new Error('Profile too large')
  const p = storedProfileSchema.parse(JSON.parse(raw)),
    u = new URL('endpoint' in p ? p.endpoint : 'https://cf.api.fan/v1')
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
    throw new Error('HTTPS endpoint required')
  const key = await readFile(keyFile, 'utf8')
  if (key.length > 8192) throw new Error('Key too large')
  const profiles = await loadImageProfiles(path)
  if (profiles.length >= 20) throw new Error('Too many profiles')
  if (
    profiles.some((v) => v.toolId === p.toolId) ||
    service.registry.list().some((v) => v.descriptor.id === p.toolId)
  )
    throw new Error(
      'Tool ID already configured; use a new ID for changed routing identity',
    )
  const profile = { ...p, credentialRef: randomUUID() }
  const adapter = imageAdapters([profile], credentials)[0]
  adapter.describe()
  await credentials.set(profile.credentialRef, key)
  await writeFile(path + '.tmp', JSON.stringify([...profiles, profile]), {
    mode: 0o600,
  })
  await rename(path + '.tmp', path)
  service.register(adapter)
  return null
}
