import type { VideoProfile } from '../../../src/shared/video.js'
import type { Shot } from '../../../src/shared/domain.js'
import type {
  CapabilityRow,
  ProductionSettings,
  CostLine,
  CostSummary,
} from '../../../src/shared/production.js'
export function capabilityMatrix(
  profiles: VideoProfile[],
  configured: Record<string, boolean>,
  settings: ProductionSettings,
): CapabilityRow[] {
  return profiles.map((profile) => ({
    profile,
    available: profile.provider === 'mock-video' || !!configured[profile.id],
    textToVideo: false,
    imageToVideo: true,
    maxDuration: Math.max(...profile.capabilities.durations),
    reason:
      profile.provider === 'mock-video'
        ? '本地 FFmpeg Mock，非 AI 质量'
        : configured[profile.id]
          ? '凭据已配置；提交前仍需健康检查'
          : '未配置凭据',
    rate: settings.rates.find((r) => r.profileId === profile.id) ?? null,
  }))
}
export interface RoutingRequirements {
  taskType: 'image-to-video' | 'text-to-video'
  endFrame: boolean
  referenceImages: number
}
export function routeGeneration(
  shot: Shot,
  rows: CapabilityRow[],
  settings: ProductionSettings,
  ratio: VideoProfile['capabilities']['aspectRatios'][number],
  preferred: string | null = null,
  requirements: RoutingRequirements = {
    taskType: 'image-to-video',
    endFrame: false,
    referenceImages: 0,
  },
) {
  const supported = rows.filter(
    (r) =>
      r.available &&
      (requirements.taskType === 'image-to-video'
        ? r.imageToVideo
        : r.textToVideo) &&
      (!requirements.endFrame || r.profile.capabilities.endFrame) &&
      (!requirements.referenceImages ||
        r.profile.capabilities.referenceImages) &&
      r.profile.capabilities.durations.includes(
        Math.round(shot.durationSeconds),
      ) &&
      r.profile.capabilities.resolutions.includes(settings.resolution) &&
      r.profile.capabilities.aspectRatios.includes(ratio),
  )
  supported.sort(
    (a, b) =>
      Number(b.profile.id === (preferred ?? settings.preferredProfileId)) -
        Number(a.profile.id === (preferred ?? settings.preferredProfileId)) ||
      Number(a.profile.provider === 'mock-video') -
        Number(b.profile.provider === 'mock-video') ||
      (a.rate?.currency === b.rate?.currency
        ? (a.rate?.maxPerSecond ?? Infinity) -
          (b.rate?.maxPerSecond ?? Infinity)
        : 0),
  )
  return {
    recommendedId: supported[0]?.profile.id ?? null,
    alternatives: supported.slice(1).map((r) => r.profile.id),
    reason: supported.length
      ? `满足图生视频、${Math.round(shot.durationSeconds)} 秒、${settings.resolution}；优先用户偏好，其次可用真实服务和同币种报价。运动复杂度 ${settings.motionComplexity}，未宣称模型质量优势。`
      : '无可用 Profile 满足首帧、时长、比例和分辨率要求',
  }
}
export function estimate(row: CapabilityRow, duration: number) {
  if (row.profile.provider === 'mock-video')
    return { estimatedMin: 0, estimatedMax: 0, currency: 'LOCAL' }
  return row.rate
    ? {
        estimatedMin: row.rate.minPerSecond * duration,
        estimatedMax: row.rate.maxPerSecond * duration,
        currency: row.rate.currency,
      }
    : { estimatedMin: null, estimatedMax: null, currency: null }
}
export function aggregateCost(lines: CostLine[]): CostSummary {
  const currencies = new Map<
    string,
    {
      currency: string
      estimatedMin: number
      estimatedMax: number
      actual: number
    }
  >()
  let unknownEstimated = 0,
    unknownActual = 0
  for (const l of lines) {
    if (l.estimatedMin === null || l.estimatedMax === null || !l.currency)
      unknownEstimated++
    if (l.actual === null || !l.currency) unknownActual++
    if (l.currency) {
      const c = currencies.get(l.currency) ?? {
        currency: l.currency,
        estimatedMin: 0,
        estimatedMax: 0,
        actual: 0,
      }
      c.estimatedMin += l.estimatedMin ?? 0
      c.estimatedMax += l.estimatedMax ?? 0
      c.actual += l.actual ?? 0
      currencies.set(l.currency, c)
    }
  }
  return {
    currencies: [...currencies.values()],
    unknownEstimated,
    unknownActual,
    count: lines.length,
  }
}
