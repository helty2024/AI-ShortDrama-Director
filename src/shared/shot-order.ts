import type { Entity, Episode, Scene, Shot } from './domain.js'

/** Formal story order, including projects whose shot numbers restart per scene. */
export function orderedShots(entities: Entity[]): Shot[] {
  const episodes = new Map(entities.filter((e): e is Episode => e.kind === 'episode').map((e) => [e.id, e]))
  const scenes = new Map(entities.filter((e): e is Scene => e.kind === 'scene').map((e) => [e.id, e]))
  return entities.filter((e): e is Shot => e.kind === 'shot').toSorted((a, b) => {
    const sa = scenes.get(a.sceneId), sb = scenes.get(b.sceneId)
    const ea = sa && episodes.get(sa.episodeId), eb = sb && episodes.get(sb.episodeId)
    return (ea?.order ?? 0) - (eb?.order ?? 0) || (sa?.order ?? 0) - (sb?.order ?? 0) || a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  })
}
