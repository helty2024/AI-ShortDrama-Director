import type { AssetVersion } from './visual.js'

/** Project shots must include all shots in current formal story order. */
export function sequenceClipLabel(version: Pick<AssetVersion, 'metadata'>, projectShots: readonly { id: string }[] = []) {
  const sequence = version.metadata.sequence
  if (!Array.isArray(sequence) || !sequence.length) return '镜数未知'
  const ids: string[] = []
  for (const clip of sequence) {
    if (!clip || typeof clip !== 'object' || Array.isArray(clip) || typeof clip.shotId !== 'string' || typeof clip.versionId !== 'string') return '镜数未知'
    ids.push(clip.shotId)
  }
  const count = `${ids.length} 镜头`
  const positions = ids.map(id => projectShots.findIndex(shot => shot.id === id) + 1)
  if (positions.includes(0) || new Set(ids).size !== ids.length) return count
  const ranges: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]
    while (i + 1 < positions.length && positions[i + 1] === positions[i] + 1) i++
    ranges.push(start === positions[i] ? String(start) : `${start}-${positions[i]}`)
  }
  const shown: string[] = []
  for (const range of ranges) {
    if (shown.length === 8 || [...shown, range].join('、').length > 64) break
    shown.push(range)
  }
  return `${count} · 项目镜序${shown.join('、')}${shown.length < ranges.length ? '、…' : ''}`
}
