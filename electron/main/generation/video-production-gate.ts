import { createHash } from 'node:crypto'
import { DomainError } from '../database.js'
import type { VisualRepository } from '../visual/repository.js'
import { videoApiPreviewInputSchema, type VideoApiPreviewInput } from '../../../src/shared/video-api.js'

/** Pure local evidence, re-evaluated at preview, confirmation and immediately
 * before submission. The evidence is persisted in the approval-bound prompt snapshot. */
export function videoProductionEvidence(visual: VisualRepository, input: VideoApiPreviewInput) {
  const fail = (message: string): never => { throw new DomainError('CONFLICT', message) }
  const shot = visual.repo.entity(input.projectId, input.targetId)
  if (shot.kind !== 'shot' || shot.projectId !== input.projectId || shot.id !== input.targetId) return fail('视频目标必须是本项目正式镜头')
  const evidence: Record<string, number> = { [shot.id]: shot.revision }
  const hashes: Record<string, string> = {}
  const image = (id: string, assetId: string | null) => {
    const version = visual.version(input.projectId, id)
    const asset = visual.asset(input.projectId, version.assetId)
    if (version.projectId !== input.projectId || asset.projectId !== input.projectId || version.id !== id || !assetId || asset.id !== assetId || version.status !== 'approved' || asset.approvedVersionId !== id || !version.mimeType.startsWith('image/'))
      return fail('参考素材必须属于本项目、已批准并采用为主版本')
    evidence[version.id] = version.revision
    evidence[asset.id] = asset.revision
    hashes[id] = version.hash
    return version
  }
  if (input.purpose === 'narrative-production') {
    if (!shot.plan) fail('叙事生产需要正式分镜')
    for (const id of shot.characterIds) {
      const character = visual.repo.entity(input.projectId, id)
      if (character.kind !== 'character' || character.projectId !== input.projectId) return fail('镜头角色关联无效')
      evidence[id] = character.revision
      const primary = character.visualReferences.filter(r => r.primary)
      if (primary.length !== 1) fail('叙事生产缺少已采用的角色主参考')
      const asset = visual.asset(input.projectId, primary[0].assetId)
      if (!asset.approvedVersionId) fail('角色主参考尚未批准采用')
      image(asset.approvedVersionId!, asset.id)
    }
    const scene = visual.repo.entity(input.projectId, shot.sceneId)
    if (scene.kind !== 'scene' || !shot.locationId || scene.locationId !== shot.locationId) fail('场次与镜头地点关联不一致')
    const location = visual.repo.entity(input.projectId, shot.locationId!)
    if (location.kind !== 'location') return fail('场景主参考归属无效')
    evidence[scene.id] = scene.revision
    evidence[location.id] = location.revision
    const primary = location.visualReferences.filter(r => r.primary)
    if (primary.length !== 1) fail('叙事生产缺少已采用的场景主参考')
    const asset = visual.asset(input.projectId, primary[0].assetId)
    if (!asset.approvedVersionId) fail('场景主参考尚未批准采用')
    image(asset.approvedVersionId!, asset.id)
    if (input.mode !== 'image-to-video') fail('叙事生产需要已批准分镜关键帧；文生视频仅限独立技术测试')
  }
  // Even the technical image-to-video path must use the shot's approved frame.
  if (input.mode === 'image-to-video') {
    if (!input.firstFrameAssetVersionId || input.firstFrameAssetVersionId !== shot.approvedKeyframeVersionId)
      fail('参考驱动视频缺少本镜头已批准的关键帧')
    const first = image(input.firstFrameAssetVersionId!, shot.approvedKeyframeAssetId)
    if (input.lastFrameAssetVersionId) {
      const last = visual.version(input.projectId, input.lastFrameAssetVersionId)
      const ownerId = typeof last.metadata.targetId === 'string' ? last.metadata.targetId : visual.repo.database.workspace(input.projectId).entities.find(e => e.kind === 'shot' && e.assetIds.includes(last.assetId))?.id
      if (!ownerId) fail('尾帧没有已审核的镜头归属')
      const owner = visual.repo.entity(input.projectId, ownerId!)
      if (owner.kind !== 'shot' || (owner.id !== shot.id && (owner.sceneId !== shot.sceneId || owner.order !== shot.order + 1)))
        fail('尾帧必须属于本镜头或同场次相邻下一镜头')
      image(last.id, last.assetId)
      if (last.id === first.id) fail('首尾帧不能重复使用同一版本')
    }
  }
  return { revisions: evidence, digest: createHash('sha256').update(JSON.stringify({ input: videoApiPreviewInputSchema.parse(input), evidence, hashes })).digest('hex') }
}
