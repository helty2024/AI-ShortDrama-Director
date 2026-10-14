import { readFile, writeFile, rename } from 'node:fs/promises'
import { providerSettingsSchema, defaultProviderSettings, type ProviderSettings } from '../../../src/shared/visual.js'
import { builtinComfyProfile } from '../tools/adapters/comfyui-template.js'
import { validateLocalComfyUrl } from '../tools/adapters/comfyui-runtime.js'

export async function loadComfySettings(path: string, fallback?: ProviderSettings): Promise<ProviderSettings> {
  try { return providerSettingsSchema.parse(JSON.parse(await readFile(path, 'utf8'))) }
  catch { return { ...defaultProviderSettings, ...fallback, provider: 'comfyui' } }
}
export function validateComfySettings(raw: ProviderSettings) {
  const settings = providerSettingsSchema.parse({ ...raw, provider: 'comfyui' })
  validateLocalComfyUrl(settings.baseUrl)
  builtinComfyProfile(settings)
  return settings
}
export async function saveComfySettings(path: string, raw: ProviderSettings) {
  const settings = validateComfySettings(raw)
  await writeFile(`${path}.tmp`, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
  await rename(`${path}.tmp`, path)
  return settings
}
