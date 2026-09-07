import type {
  Character,
  Location,
  Prop,
  Shot,
  Entity,
} from '../../../src/shared/domain.js'
import { promptPackageSchema } from '../../../src/shared/visual.js'
import type { ImagePromptPackage } from '../../../src/shared/visual.js'
export const IMAGE_PROMPT_VERSION = 'visual-compiler-v1'
type Bible = Character | Location | Prop
const join = (values: (string | null | undefined)[]) =>
  values.filter(Boolean).join('; ')
const references = (e: Bible) =>
  e.visualReferences
    .toSorted((a, b) => Number(b.primary) - Number(a.primary))
    .map((r) => r.assetId)
function description(e: Bible) {
  return join([
    e.name,
    e.description,
    ...Object.entries(e.bible)
      .filter(
        ([k, v]) =>
          typeof v === 'string' &&
          !['visualPrompt', 'negativePrompt', 'continuityNotes'].includes(k),
      )
      .map(([k, v]) => `${k}: ${String(v)}`),
    e.bible.visualPrompt,
  ])
}
function pack(
  subject: string,
  style: string,
  composition: string,
  camera: string,
  lighting: string,
  continuity: string,
  refs: string[],
  negative = '',
): ImagePromptPackage {
  return promptPackageSchema.parse({
    positivePrompt: join([
      subject,
      composition,
      camera,
      lighting,
      style,
      continuity,
    ]),
    negativePrompt: join([
      'watermark, text overlay, low quality, distorted anatomy',
      negative,
    ]),
    subjectDescription: subject,
    composition,
    camera,
    lighting,
    style,
    continuity,
    referenceAssetIds: [...new Set(refs)],
    providerHints: {},
    promptVersion: IMAGE_PROMPT_VERSION,
  })
}
export function compileCharacterPrompt(
  e: Character,
  style = 'cinematic',
): ImagePromptPackage {
  return pack(
    description(e),
    style,
    'character costume portrait, clear face and full body',
    'eye level, 50mm',
    'soft even studio lighting',
    join(['same character appearance, same costume', e.bible.continuityNotes]),
    references(e),
    e.bible.negativePrompt,
  )
}
export function compileLocationPrompt(
  e: Location,
  style = 'cinematic',
): ImagePromptPackage {
  return pack(
    description(e),
    style,
    'empty location master establishing view',
    'wide shot, 24mm',
    e.bible.lighting,
    join([
      'same location, same time of day',
      e.bible.timeState,
      e.bible.continuityNotes,
    ]),
    references(e),
  )
}
export function compilePropPrompt(
  e: Prop,
  style = 'cinematic',
): ImagePromptPackage {
  return pack(
    description(e),
    style,
    'prop master view, clearly readable material',
    'close up, 85mm',
    'soft product lighting',
    join(['consistent prop state', e.bible.condition, e.bible.continuityNotes]),
    references(e),
  )
}
export function compileShotKeyframePrompt(
  shot: Shot,
  entities: Entity[],
  style = 'cinematic',
  previousShot = false,
): ImagePromptPackage {
  const bible = entities.filter(
    (e): e is Bible =>
      (e.kind === 'character' && shot.characterIds.includes(e.id)) ||
      (e.kind === 'location' && e.id === shot.locationId) ||
      (e.kind === 'prop' && shot.propIds.includes(e.id)),
  )
  const location = bible.find((e): e is Location => e.kind === 'location')
  const scene = entities.find((e) => e.id === shot.sceneId)
  const prior = previousShot
    ? entities
        .filter(
          (e): e is Shot =>
            e.kind === 'shot' &&
            e.storyboardId === shot.storyboardId &&
            e.order < shot.order &&
            !!e.approvedKeyframeAssetId,
        )
        .sort((a, b) => b.order - a.order)[0]
    : undefined
  const plan = shot.plan
  const result = pack(
    join([
      bible.map(description).join(' | '),
      plan?.subject,
      plan?.action || shot.description,
      plan?.emotion,
    ]),
    style,
    join([plan?.shotType, plan?.framing]),
    join([
      plan?.cameraAngle,
      plan?.cameraMovement,
      plan?.focalLengthSuggestion,
    ]),
    location?.bible.lighting || '',
    join([
      'same character appearance, same costume, same location, same time of day, consistent prop state',
      scene?.kind === 'scene' ? scene.content.timeOfDay : '',
      ...bible.map((e) => e.bible.continuityNotes),
      plan?.continuityNotes,
    ]),
    [
      ...bible.flatMap(references),
      ...(prior?.approvedKeyframeAssetId
        ? [prior.approvedKeyframeAssetId]
        : []),
    ],
    bible
      .filter((e): e is Character => e.kind === 'character')
      .map((e) => e.bible.negativePrompt)
      .join('; '),
  )
  result.providerHints = {
    sourceRevisions: Object.fromEntries(
      [shot, ...bible].map((e) => [e.id, e.revision]),
    ),
    previousKeyframeVersionId: prior?.approvedKeyframeVersionId ?? null,
  }
  return result
}
