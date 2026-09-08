import type { Entity, Shot } from '../../../src/shared/domain.js'
import type { AssetVersion } from '../../../src/shared/visual.js'
import type { AITask } from '../../../src/shared/intelligence.js'
import type {
  QCReport,
  ShotProductionStatus,
  CostLine,
  ProductionSettings,
} from '../../../src/shared/production.js'
import { aggregateCost } from './router.js'
export function productionCosts(
  entities: Entity[],
  tasks: AITask[],
  reports: QCReport[],
): CostLine[] {
  const links = (shotId: string | null) => {
    const s = entities.find((e) => e.id === shotId),
      scene =
        s?.kind === 'shot'
          ? entities.find((e) => e.id === s.sceneId)
          : undefined
    return {
      shotId: s?.kind === 'shot' ? shotId : null,
      sceneId: scene?.id ?? null,
      episodeId: scene?.kind === 'scene' ? scene.episodeId : null,
    }
  }
  const lines: CostLine[] = tasks
    .filter((t) => 'request' in t.input)
    .map((t) => {
      const c = t.costMetadata,
        range = c.billingMetadata.estimateRange
      const min =
          range &&
          typeof range === 'object' &&
          !Array.isArray(range) &&
          typeof range.min === 'number'
            ? range.min
            : c.estimatedCost,
        max =
          range &&
          typeof range === 'object' &&
          !Array.isArray(range) &&
          typeof range.max === 'number'
            ? range.max
            : c.estimatedCost
      const local = t.provider === 'mock-video' || t.provider === 'mock-image'
      return {
        id: t.id,
        taskId: t.id,
        versionId: t.outputAssetVersionIds[0] ?? null,
        ...links('targetId' in t.input ? t.input.targetId : null),
        kind: t.input.type === 'shot-video' ? 'video' : 'image',
        estimatedMin: local ? 0 : min,
        estimatedMax: local ? 0 : max,
        actual: local && t.status === 'succeeded' ? 0 : c.actualCost,
        currency: local ? 'LOCAL' : c.currency,
      }
    })
  return [
    ...lines,
    ...reports.map((r) => ({
      id: r.id,
      taskId: null,
      versionId: r.versionId,
      ...links(r.shotId),
      kind: 'qc' as const,
      estimatedMin: r.provider === 'mock-qc' ? 0 : null,
      estimatedMax: r.provider === 'mock-qc' ? 0 : null,
      actual: r.provider === 'mock-qc' ? 0 : null,
      currency: r.provider === 'mock-qc' ? 'LOCAL' : null,
    })),
  ]
}
export function deriveShotStatus(
  shot: Shot,
  entities: Entity[],
  versions: AssetVersion[],
  tasks: AITask[],
  reports: QCReport[],
  settings: ProductionSettings,
  contextFingerprint: string,
  costLines: CostLine[],
): ShotProductionStatus {
  const owned = tasks.filter(
      (t) => 'targetId' in t.input && t.input.targetId === shot.id,
    ),
    media = versions.filter((v) => v.metadata.targetId === shot.id),
    scene = entities.find((e) => e.id === shot.sceneId)
  const key = versions.find(
      (v) =>
        v.id === shot.approvedKeyframeVersionId &&
        v.mimeType !== 'video/mp4' &&
        v.status === 'approved',
    ),
    video = versions.find(
      (v) =>
        v.id === shot.confirmedVideoAssetVersionId &&
        v.mimeType === 'video/mp4' &&
        v.status === 'approved',
    )
  const phase = (type: 'image' | 'video') => {
    if (type === 'image' ? key : video) return 'confirmed' as const
    if (
      owned.some(
        (t) =>
          ['queued', 'running'].includes(t.status) &&
          (type === 'video'
            ? t.input.type === 'shot-video'
            : t.input.type !== 'shot-video'),
      )
    )
      return 'generating' as const
    if (
      media.some(
        (v) =>
          v.status === 'draft' &&
          (type === 'video'
            ? v.mimeType === 'video/mp4'
            : v.mimeType !== 'video/mp4'),
      )
    )
      return 'review' as const
    return 'missing' as const
  }
  const reviewVersion =
    video ??
    media
      .filter((v) => v.mimeType === 'video/mp4' && v.status === 'draft')
      .at(-1) ??
    key ??
    media.at(-1)
  const report = reports
    .filter((r) => r.shotId === shot.id && r.versionId === reviewVersion?.id)
    .at(-1)
  const keyReport = reports
    .filter((r) => r.shotId === shot.id && r.versionId === key?.id)
    .at(-1)
  const severe =
    report?.output.issues.some((i) => i.severity === 'severe') ?? false
  const qc: ShotProductionStatus['qc'] = !report
    ? 'missing'
    : report.contextFingerprint !== contextFingerprint
      ? 'stale'
      : report.status === 'ignored'
        ? 'ignored'
        : report.status === 'pending'
          ? 'pending'
          : report.status === 'rejected' || severe
            ? 'warning'
            : 'passed'
  const keyPassed =
    !!keyReport &&
    keyReport.contextFingerprint === contextFingerprint &&
    keyReport.status === 'accepted' &&
    !keyReport.output.issues.some((i) => i.severity === 'severe')
  const qcOK =
    settings.qcMode === 'strict'
      ? qc === 'passed' && keyPassed
      : (qc === 'passed' || qc === 'ignored') &&
        (!keyReport ||
          keyPassed ||
          (keyReport.status === 'ignored' &&
            keyReport.contextFingerprint === contextFingerprint))
  return {
    shotId: shot.id,
    sceneId: shot.sceneId,
    episodeId: scene?.kind === 'scene' ? scene.episodeId : shot.storyboardId,
    scriptReady: scene?.kind === 'scene' && !!scene.content.heading,
    shotPlanned: !!shot.plan,
    keyframe: phase('image'),
    video: phase('video'),
    qc,
    failedTasks: owned.filter((t) => t.status === 'failed').map((t) => t.id),
    complete: !!key && !!video && qcOK,
    provider: owned.at(-1)?.provider ?? video?.provider ?? null,
    cost: aggregateCost(costLines.filter((l) => l.shotId === shot.id)),
  }
}
