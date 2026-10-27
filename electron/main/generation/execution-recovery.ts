import { z } from 'zod'
import type { AIServiceManager, StoredAIService } from './ai-services.js'
import type { CredentialStore } from '../video/credentials.js'
import type { NativeProductionGate } from './native-production.js'
import type { ImageGenerationService } from './image-service.js'
import type { VideoApiGenerationService } from './video-api-service.js'
import type { ExecutionConfiguration } from '../../../src/shared/execution-binding.js'
import { ComfyUIToolAdapter } from '../tools/adapters/comfyui.js'
import { comfyToolProfileSchema } from '../../../src/shared/comfyui.js'
import { imageApiProfileSchema } from '../../../src/shared/image-api.js'
import { ImageApiAdapter } from '../tools/adapters/image-api.js'
import { PackyImage25Adapter, packyImage25ProfileSchema } from '../tools/adapters/packy-image-25.js'
import { ProductionPackyAdapter } from './production-packy.js'
import { VideoApiAdapter } from '../tools/adapters/video-api.js'
import { CompShareMiniMaxH3Adapter } from '../tools/adapters/compshare-minimax-h3.js'
import { compshareProfileSchema } from '../../../src/shared/compshare-minimax-h3.js'
import { videoApiProfileSchema } from '../../../src/shared/video-tool-profile.js'
import { ImageHttpTransport } from '../tools/adapters/image-http.js'
import { DomainError } from '../database.js'

/** Schema-checked built-in factories only; historical adapters never enter routing. */
export function configureExecutionRecovery(image: ImageGenerationService, video: VideoApiGenerationService, services: AIServiceManager, credentials: CredentialStore, gate: NativeProductionGate) {
  const service = (config: ExecutionConfiguration): StoredAIService | null => {
    if (!config.serviceId) return null
    const s = services.historicalService(config.serviceId, config.serviceRevision!)
    if (!s || s.baseUrl !== config.endpoint || s.model !== config.profile.modelId || s.credentialRef !== config.profile.credentialRef) throw new DomainError('CONFLICT', '原服务实例、修订或凭据引用不可用')
    return s
  }
  const credential = (config: ExecutionConfiguration) => async () => credentials.get(z.uuid().parse(config.profile.credentialRef))
  image.bindings.resolver = async config => {
    const s = service(config)
    if (s?.kind === 'packy-image') return new ProductionPackyAdapter(s, credentials, gate)
    if (s) return null
    if (config.descriptor.id === 'comfyui.local') return new ComfyUIToolAdapter(comfyToolProfileSchema.parse(config.profile))
    if (config.profile.adapter === 'packy-image-25') return new PackyImage25Adapter(packyImage25ProfileSchema.parse(config.profile), credential(config))
    return new ImageApiAdapter(imageApiProfileSchema.parse(config.profile), credential(config))
  }
  video.bindings.resolver = async config => {
    const s = service(config)
    if (s && s.kind !== 'compshare-video') return null
    if (config.descriptor.id === 'compshare.minimax-h3') {
      const stored = compshareProfileSchema.parse({ adapter: 'compshare-minimax-h3', toolId: config.descriptor.id, modelId: config.profile.modelId, credentialRef: config.profile.credentialRef })
      return new CompShareMiniMaxH3Adapter(stored, credential(config), new ImageHttpTransport(), s ? {
        allowedDownloadHosts: z.array(z.string()).parse(config.profile.allowedDownloadHosts),
        canExecute: async () => false,
        consume: async () => { throw new DomainError('FORBIDDEN', '历史适配器只允许查询和下载，禁止重新提交') },
        downloadHostsForTask: (id, url, context) => gate.taskDownloadHosts(s, id, url, context),
        outputVerified: (url, context, bytes, duration) => gate.noteVerifiedOutput(s, url, context, bytes, duration),
      } : null, videoApiProfileSchema.parse(config.profile).batchPolicy ?? null)
    }
    return new VideoApiAdapter(videoApiProfileSchema.parse(config.profile), credential(config))
  }
}
