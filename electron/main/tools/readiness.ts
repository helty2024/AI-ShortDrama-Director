import { randomUUID } from 'node:crypto'
import { readinessSchema, type Readiness } from '../../../src/shared/compatibility.js'
import { ComfyUIToolAdapter } from './adapters/comfyui.js'
import { PackyImage25Adapter } from './adapters/packy-image-25.js'
import { ImageApiAdapter } from './adapters/image-api.js'
import { VideoApiAdapter } from './adapters/video-api.js'
import type { ToolRegistry } from './registry.js'
import { requestFingerprint } from './fingerprint.js'

/** Static evidence is separate from live runtime. Only Comfy's read-only APIs are probed. */
export async function toolReadiness(registries: ToolRegistry[], hasCredential: (toolId: string) => Promise<boolean>): Promise<Readiness> {
  const checkedAt = new Date().toISOString()
  const rows: Readiness = []
  for (const { adapter, descriptor } of registries.flatMap(r => [...r.list()])) {
    const row: Readiness[number] = { toolId: descriptor.id, name: descriptor.name, capabilities: descriptor.capabilities.map(c => c.capability),
      validation: 'implemented', runtime: 'unavailable', detail: '尚未验证', checkedAt }
    if (adapter instanceof ComfyUIToolAdapter) {
      row.validation = adapter.profile.template.capability === 'image.generate' ? 'real-local-validated' : 'simulated-validated'
      row.detail = '07-08.5：本地图像、审核采用、重启恢复已验证；证据仅覆盖内置文生图模板。当前模板另行检查。'
      const signal = AbortSignal.timeout(5000)
      const health = await adapter.health(signal)
      row.runtime = 'offline'
      if (health.availability === 'available') {
        const t = adapter.profile.template, cap = t.capability
        const input = { prompt: 'read-only readiness check', negativePrompt: '', count: 1, seed: 42, outputMime: 'image/png' as const,
          resolution: t.supportedResolutions[0], aspectRatio: t.supportedAspectRatios[0],
          ...(cap === 'image.referenceGenerate' ? { references: [{ assetVersionId: randomUUID(), role: 'identity' as const, weight: 1 }] } : {}) }
        const fingerprint = requestFingerprint({ fingerprintVersion: '1', snapshot: { capability: cap, contractVersion: '1.0.0', input },
          toolId: descriptor.id, toolVersion: descriptor.version, model: adapter.profile.modelId, sourceRevisions: {}, routing: null })
        const result = await adapter.validate(cap, input, { projectId: randomUUID(), model: adapter.profile.modelId,
          requestFingerprint: fingerprint, routingDecisionId: null }, signal)
        row.runtime = result.valid ? 'ready-for-configured-template' : 'capability-blocked'
        if (!result.valid) row.detail += ' 当前节点、模型或模板绑定不满足。'
      }
    } else if (adapter instanceof PackyImage25Adapter) {
      row.validation = 'real-generation-partially-validated'
      row.runtime = await hasCredential(descriptor.id).catch(() => false) ? 'configured-unverified' : 'configuration-required'
      row.detail = 'real provider response observed; full live asset-ingestion/adoption not yet validated. 凭据仅本地检查；真实提交仍受独立验证授权门禁。'
    } else if (adapter instanceof ImageApiAdapter || adapter instanceof VideoApiAdapter) {
      row.validation = 'simulated-validated'; row.runtime = 'development-test-only'
      row.detail = 'Development / Reference：仅协议 fixture 验证，不代表真实供应商。'
    }
    rows.push(row)
  }
  if (!rows.some(r => r.validation === 'real-generation-partially-validated')) rows.push({ toolId: 'packy.image-25', name: 'Packy Image', capabilities: ['image.generate'],
    validation: 'real-generation-partially-validated', runtime: 'configuration-required', detail: 'real provider response observed; full live asset-ingestion/adoption not yet validated.', checkedAt })
  for (const kind of ['Image', 'Video']) if (!rows.some(r => r.runtime === 'development-test-only' && r.capabilities.some(c => c.startsWith(kind.toLowerCase()))))
    rows.push({ toolId: `reference.${kind.toLowerCase()}`, name: `Reference ${kind}`, capabilities: kind === 'Image' ? ['image.generate', 'image.referenceGenerate'] : ['video.textToVideo', 'video.imageToVideo'], validation: 'simulated-validated', runtime: 'development-test-only', detail: 'Development / Reference：未注册为正式生产选项。', checkedAt })
  rows.push({ toolId: 'real-video', name: 'Real Video Provider', capabilities: ['video.textToVideo', 'video.imageToVideo'], validation: 'not-validated', runtime: 'configuration-required', detail: '未配置、未验证；Reference fixture 不代表 Seedance / Kling / Veo。', checkedAt })
  return readinessSchema.parse(rows)
}
