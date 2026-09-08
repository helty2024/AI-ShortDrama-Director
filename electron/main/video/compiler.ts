import type { Shot, Entity } from '../../../src/shared/domain.js'
import type {
  VideoProfile,
  VideoPromptPackage,
} from '../../../src/shared/video.js'
import { videoPromptSchema } from '../../../src/shared/video.js'
import { DomainError } from '../database.js'
export function compileShotVideoPrompt(
  shot: Shot,
  entities: Entity[],
  profile: VideoProfile,
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:3',
  duration: number,
  endFrame: string | null = null,
): VideoPromptPackage {
  if (!shot.approvedKeyframeVersionId)
    throw new DomainError('CONFLICT', '请先确认此 Shot 的关键帧')
  if (
    !profile.capabilities.durations.includes(duration) ||
    !profile.capabilities.aspectRatios.includes(aspectRatio) ||
    (endFrame && !profile.capabilities.endFrame)
  )
    throw new DomainError(
      'CONFLICT',
      '当前 Provider 不支持所选时长、比例或尾帧',
    )
  const characters = entities.filter(
    (e) => e.kind === 'character' && shot.characterIds.includes(e.id),
  )
  const location = entities.find((e) => e.id === shot.locationId),
    props = entities.filter(
      (e) => e.kind === 'prop' && shot.propIds.includes(e.id),
    ),
    scene = entities.find((e) => e.id === shot.sceneId)
  const previous = entities
    .filter(
      (e): e is Shot =>
        e.kind === 'shot' &&
        e.storyboardId === shot.storyboardId &&
        e.order < shot.order,
    )
    .sort((a, b) => b.order - a.order)[0]
  const d = shot.direction,
    plan = shot.plan
  const identity = characters
    .map((c) =>
      c.kind === 'character'
        ? `${c.name}: ${c.bible.facialFeatures}; ${c.bible.hairstyle}; costume ${c.bible.costume}; ${c.bible.continuityNotes}`
        : '',
    )
    .join(' | ')
  const refs = entities
    .filter(
      (e) =>
        (e.kind === 'character' && shot.characterIds.includes(e.id)) ||
        (e.kind === 'location' && e.id === shot.locationId) ||
        (e.kind === 'prop' && shot.propIds.includes(e.id)),
    )
    .flatMap((e) =>
      'visualReferences' in e
        ? e.visualReferences.filter((r) => r.primary).map((r) => r.assetId)
        : [],
    )
  return videoPromptSchema.parse({
    sceneDescription:
      scene?.kind === 'scene' ? scene.content.heading : shot.description,
    subject:
      plan?.subject || characters.map((c) => c.name).join('、') || shot.name,
    characterConsistency: identity,
    action: `开始：${d.startState || '延续已确认首帧姿态'}。过程：${d.action || plan?.action || shot.description}；主体运动：${d.subjectMovement || '自然连贯动作'}。结束：${d.endState || '稳定停留，为下一镜头留出衔接'}。速度：${d.speed}。`,
    performance: d.performance || plan?.emotion || '',
    cameraMovement: d.cameraMovement || plan?.cameraMovement || '保持稳定机位',
    framing: plan?.framing || '',
    lens: plan?.focalLengthSuggestion || '',
    environment:
      (location?.kind === 'location'
        ? location.name + ' ' + location.bible.weather
        : '') +
      '；环境动态：' +
      d.environmentMotion,
    lighting: location?.kind === 'location' ? location.bible.lighting : '',
    continuity: `同一人物、服装、地点和道具状态；${props.map((p) => (p.kind === 'prop' ? p.name + ':' + p.bible.condition : '')).join('；')}；时间：${scene?.kind === 'scene' ? scene.content.timeOfDay : ''}；${d.continuityNotes}；上一镜头：${previous ? previous.name + '；结束状态：' + (previous.direction.endState || previous.plan?.action || previous.description) + '；连续性说明：' + previous.direction.continuityNotes : '无'}`,
    startFrameAssetVersionId: shot.approvedKeyframeVersionId,
    optionalEndFrameAssetVersionId: endFrame,
    duration,
    aspectRatio,
    negativePrompt:
      'identity drift, costume changes, camera jitter, abrupt cuts, distorted motion',
    providerHints: {
      referenceAssetIds: refs,
      previousVideoVersionId: previous?.confirmedVideoAssetVersionId ?? null,
      previousKeyframeVersionId: previous?.approvedKeyframeVersionId ?? null,
      sourceRevision: shot.revision,
    },
    promptVersion: 'shot-video-v1',
  })
}
export function renderVideoPrompt(p: VideoPromptPackage) {
  return [
    p.sceneDescription,
    p.subject,
    p.characterConsistency,
    p.action,
    p.performance,
    `Camera: ${p.cameraMovement}; ${p.framing}; lens ${p.lens}`,
    p.environment,
    p.lighting,
    p.continuity,
    `Avoid: ${p.negativePrompt}`,
  ]
    .filter(Boolean)
    .join('\n')
}
