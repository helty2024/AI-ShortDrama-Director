import { createHash } from 'node:crypto'
import type { Entity, Shot } from '../../../src/shared/domain.js'
import type {
  ContinuityState,
  ContinuitySnapshot,
  ContinuityContext,
} from '../../../src/shared/production.js'
import { continuitySnapshotSchema } from '../../../src/shared/production.js'
import type { ProjectDatabase } from '../database.js'
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function readContinuity(db: ProjectDatabase, projectId: string) {
  return db.connection
    .prepare(
      'SELECT data FROM continuity_snapshots WHERE project_id=? ORDER BY rowid',
    )
    .all(projectId)
    .map((r) => continuitySnapshotSchema.parse(JSON.parse(String(r.data))))
}
export function resolveContinuity(
  shot: Shot,
  entities: Entity[],
  snapshots: ContinuitySnapshot[],
): ContinuityContext {
  const shots = entities
    .filter(
      (e): e is Shot =>
        e.kind === 'shot' && e.storyboardId === shot.storyboardId,
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  let prior: ContinuityState = { characters: [], props: [], locations: [] },
    previousShotId: string | null = null,
    priorScene: string | null = null
  const sources: string[] = []
  for (const current of shots) {
    const scene = entities.find((e) => e.id === current.sceneId)
    const state: ContinuityState = {
      characters: current.characterIds.flatMap((id) => {
        const c = entities.find((e) => e.id === id)
        return c?.kind === 'character'
          ? [
              {
                characterId: id,
                costume: c.bible.costume,
                hairstyle: c.bible.hairstyle,
                makeup: c.bible.makeup,
                injuries: [],
                carriedProps: [],
                physicalState: '',
                emotionalState: '',
                position: '',
                notes: c.bible.continuityNotes,
              },
            ]
          : []
      }),
      props: current.propIds.flatMap((id) => {
        const p = entities.find((e) => e.id === id)
        return p?.kind === 'prop'
          ? [
              {
                propId: id,
                holderCharacterId: null,
                state: p.bible.condition,
                location: '',
                visible: true,
                notes: p.bible.continuityNotes,
              },
            ]
          : []
      }),
      locations: entities.flatMap((e) =>
        e.kind === 'location' && e.id === current.locationId
          ? [
              {
                locationId: e.id,
                timeOfDay:
                  scene?.kind === 'scene' ? scene.content.timeOfDay : '',
                lighting: e.bible.lighting,
                weather: e.bible.weather,
                environmentState: '',
                damage: '',
                notes: e.bible.continuityNotes,
              },
            ]
          : [],
      ),
    }
    const apply = (patch: ContinuityState) => {
      state.characters = state.characters.map(
        (c) =>
          patch.characters.find((v) => v.characterId === c.characterId) ?? c,
      )
      state.props = state.props.map(
        (p) => patch.props.find((v) => v.propId === p.propId) ?? p,
      )
      state.locations = state.locations.map(
        (l) => patch.locations.find((v) => v.locationId === l.locationId) ?? l,
      )
    }
    apply({
      ...prior,
      locations: priorScene === current.sceneId ? prior.locations : [],
    })
    const sceneSnapshot = snapshots.find((s) => s.targetId === current.sceneId)
    if (sceneSnapshot && priorScene !== current.sceneId) {
      apply(sceneSnapshot.state)
      sources.push(sceneSnapshot.id)
    }
    const own = snapshots.find((s) => s.targetId === current.id)
    if (own) {
      apply(own.state)
      sources.push(own.id)
    }
    if (current.id === shot.id)
      return {
        shotId: shot.id,
        sceneId: shot.sceneId,
        previousShotId,
        state,
        sources: [...new Set(sources)],
        fingerprint: fingerprint({
          state,
          direction: shot.direction,
          plan: shot.plan,
          duration: shot.durationSeconds,
          refs: entities
            .filter(
              (e) =>
                shot.characterIds.includes(e.id) ||
                shot.propIds.includes(e.id) ||
                e.id === shot.locationId,
            )
            .map((e) => [e.id, e.revision]),
        }),
      }
    // Preserve absent characters/props so state can reappear later in the episode.
    prior = {
      characters: [
        ...prior.characters.filter(
          (c) => !state.characters.some((v) => v.characterId === c.characterId),
        ),
        ...state.characters,
      ],
      props: [
        ...prior.props.filter(
          (p) => !state.props.some((v) => v.propId === p.propId),
        ),
        ...state.props,
      ],
      locations: state.locations,
    }
    previousShotId = current.id
    priorScene = current.sceneId
  }
  throw Error('Shot not found in storyboard')
}
export function continuityEntities(
  entities: Entity[],
  context: ContinuityContext,
): Entity[] {
  return entities.map((e) => {
    if (e.kind === 'character') {
      const c = context.state.characters.find((c) => c.characterId === e.id)
      if (c)
        return {
          ...e,
          bible: {
            ...e.bible,
            costume: c.costume,
            hairstyle: c.hairstyle,
            makeup: c.makeup,
            continuityNotes: c.notes,
          },
        }
    }
    if (e.kind === 'prop') {
      const p = context.state.props.find((p) => p.propId === e.id)
      if (p)
        return {
          ...e,
          bible: { ...e.bible, condition: p.state, continuityNotes: p.notes },
        }
    }
    if (e.kind === 'location') {
      const l = context.state.locations.find((l) => l.locationId === e.id)
      if (l)
        return {
          ...e,
          bible: {
            ...e.bible,
            lighting: l.lighting,
            weather: l.weather,
            continuityNotes: l.notes,
          },
        }
    }
    return e
  })
}
export function continuityText(context: ContinuityContext) {
  return (
    '当前剧情连续性（优先于 Bible 可变状态）：' + JSON.stringify(context.state)
  )
}
