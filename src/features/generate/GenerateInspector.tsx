import type { Character, Location, Prop, Shot } from '../../shared/domain'
import { useWorkspace } from '../workspace/state'
import { useVisual } from '../visual/use-visual'
import { officialVersion, approvedShotReferences, orderedShots } from '../storyboard/storyboard-model'
import { resolveCreatorAsset } from '../assets/creator-assets'
import { useIntelligence } from '../script/use-intelligence'

export function GenerateInspector({ target }: { target: Shot | Character | Location | Prop }) {
  const { state } = useWorkspace()
  const visual = useVisual(target.projectId)
  const ai = useIntelligence(target.projectId)
  const entities = state.workspace?.entities ?? []
  const versions = visual.snapshot?.versions ?? []
  const shot = target.kind === 'shot' ? target : undefined
  const prior = shot ? orderedShots(entities).filter((item) => item.storyboardId === shot.storyboardId && item.order < shot.order).at(-1) : undefined
  const refs = shot ? approvedShotReferences(shot, entities, versions, prior) : []
  const keyframe = shot ? officialVersion(shot, 'keyframe', entities, versions) : undefined
  const assetView = target.kind !== 'shot' ? resolveCreatorAsset(target, entities, versions, ai.snapshot.tasks) : undefined
  return <div className="generate-inspector"><h3>当前目标</h3><p>{target.kind === 'shot' ? '镜头' : target.kind === 'character' ? '角色' : target.kind === 'location' ? '场景' : '道具'} · {target.name}</p><h3>输入就绪</h3><p>{shot ? `关键帧：${keyframe ? '已确认' : '未确认'}` : `主参考：${assetView?.primaryVersion ? '已确认' : '未设置'}`}</p>{shot && <p>已确认参考素材：{refs.length} 张。不会自动使用草稿候选。</p>}<h3>生成方式</h3><p>{shot ? '镜头使用现有制作工作流。关键帧采用自动路由；视频仅在 Video Tool 就绪时可用。' : '参考图使用现有 Direct Image 生产链与自动路由。'}</p><p>工具、尺寸和上传设置可在中央工作区展开“高级设置”；凭据在项目设置管理。</p></div>
}
