import type { EntityKind } from '../../shared/domain'
export const entityLabels: Record<EntityKind, string> = {
  script: '剧本',
  episode: '分集',
  scene: '场次',
  character: '角色',
  location: '场景',
  prop: '道具',
  storyboard: '分镜表',
  shot: '镜头',
  asset: '素材记录',
  generationTask: '生成任务草稿',
}
