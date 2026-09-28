import type { Asset, Character, Entity, Location, Prop } from '../../shared/domain.js'
import type { AITask } from '../../shared/intelligence.js'
import type { AssetVersion, VisualReference } from '../../shared/visual.js'
import type { CreatorStatus } from '../../components/creator-shell/status.js'

export type CreatorAsset = Character | Location | Prop
export type CreatorAssetKind = CreatorAsset['kind']
export const assetKinds: CreatorAssetKind[] = ['character', 'location', 'prop']
export const assetLabels: Record<CreatorAssetKind, string> = { character: '角色', location: '场景', prop: '道具' }
export const roleLabels: Record<VisualReference['role'], string> = {
  faceReference: '面部参考', fullBodyReference: '全身参考', costumeReference: '服装参考', expressionReference: '表情参考',
  masterReference: '主视觉参考', angleReference: '角度参考', lightingReference: '光线参考', detailReference: '细节参考',
}
export function isCreatorAsset(entity: Entity): entity is CreatorAsset {
  return entity.kind === 'character' || entity.kind === 'location' || entity.kind === 'prop'
}
const imageMime = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface CreatorAssetView {
  primaryReference: VisualReference | undefined
  primaryVersion: AssetVersion | undefined
  brokenPrimary: boolean
  candidates: AssetVersion[]
  history: AssetVersion[]
  preview: AssetVersion | undefined
  status: CreatorStatus
}

export function resolveCreatorAsset(target: CreatorAsset, entities: Entity[], versions: AssetVersion[], tasks: AITask[] = []): CreatorAssetView {
  const assets = new Map(entities.filter((e): e is Asset => e.kind === 'asset').map((e) => [e.id, e]))
  const primaryReference = target.visualReferences.find((ref) => ref.primary)
  const primaryAsset = primaryReference ? assets.get(primaryReference.assetId) : undefined
  const primaryVersion = primaryAsset?.mediaType === 'image' && primaryAsset.approvedVersionId
    ? versions.find((v) => v.id === primaryAsset.approvedVersionId && v.assetId === primaryAsset.id && v.status === 'approved' && imageMime.has(v.mimeType))
    : undefined
  const brokenPrimary = Boolean(primaryReference && !primaryVersion)
  const associated = new Set([...target.assetIds, ...target.visualReferences.map((ref) => ref.assetId)])
  const taskOutputs = new Set(tasks.filter((task) => 'targetId' in task.input && task.input.targetId === target.id).flatMap((task) => task.resultIds))
  const primaryAssets = new Set(entities.filter(isCreatorAsset).flatMap((entity) => entity.visualReferences.filter((ref) => ref.primary).map((ref) => ref.assetId)))
  const related = versions.filter((v) => {
    const asset = assets.get(v.assetId)
    return asset?.mediaType === 'image' && imageMime.has(v.mimeType) && (
      associated.has(v.assetId) || v.metadata.targetId === target.id || taskOutputs.has(v.id)
    )
  }).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.versionNumber - a.versionNumber)
  const candidates = related.filter((v) => !primaryAssets.has(v.assetId) && (v.status === 'draft' || v.status === 'approved'))
  const history = related.filter((v) => primaryAssets.has(v.assetId) || v.status === 'rejected' || v.status === 'archived')
  const ready = candidates.some((v) => v.status === 'approved' && assets.get(v.assetId)?.approvedVersionId === v.id)
  const status: CreatorStatus = brokenPrimary ? '不可用' : primaryVersion ? '已确认' : ready ? '准备就绪' : candidates.some((v) => v.status === 'draft') ? '待审核' : '待生成'
  return { primaryReference, primaryVersion, brokenPrimary, candidates, history, preview: primaryVersion ?? candidates[0], status }
}

export function adoptedReferences(target: CreatorAsset, assetId: string): VisualReference[] {
  const existing = target.visualReferences.find((ref) => ref.assetId === assetId)
  const role = existing?.role ?? (target.kind === 'character' ? 'faceReference' : 'masterReference')
  return [
    ...target.visualReferences.filter((ref) => ref.assetId !== assetId).map((ref) => ({ ...ref, primary: false })),
    { assetId, role, primary: true },
  ]
}
