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
  return <div className="generate-inspector"><h3>当前目标</h3><p>{target.kind === 'shot' ? '镜头' : target.kind === 'character' ? '角色' : target.kind === 'location' ? '场景' : '道具'} · {target.name}</p><h3>输入就绪</h3><p>{shot ? `关键帧：${keyframe ? '已确认' : '未确认'}` : `主参考：${assetView?.primaryVersion ? '已确认' : '未设置'}`}</p>{shot && <p>已确认参考素材：{refs.length} 张。草稿候选需要先批准并采用。</p>}<h3>下一步</h3><p>开始生成，核对预览并确认。结果出来后先批准，再设为当前版本。</p><p>默认自动推荐。Alpha 测试视频由本地模拟生成；需要调整时可展开高级设置。</p></div>
}
