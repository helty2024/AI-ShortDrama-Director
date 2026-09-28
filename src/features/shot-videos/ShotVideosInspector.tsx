import type { Shot } from '../../shared/domain'
import { useWorkspace } from '../workspace/state'
import { useCreator } from '../../components/creator-shell/creator-context'
import { useVisual } from '../visual/use-visual'
import { useIntelligence } from '../script/use-intelligence'
import { useWorkflowRuns } from '../generate/use-workflow-runs'
import { officialVersion, shotStatus } from '../storyboard/storyboard-model'
import { shotVideoView } from './shot-video-model'
import { CandidateSource } from '../generate/GenerationSource'

export function ShotVideosInspector({ shot }: { shot: Shot }) {
  const { state } = useWorkspace()
  const { navigateCreator } = useCreator()
  const visual = useVisual(shot.projectId), ai = useIntelligence(shot.projectId), workflows = useWorkflowRuns(shot.projectId)
  const entities = state.workspace?.entities ?? []
  const versions = visual.snapshot?.versions ?? []
  const view = shotVideoView(shot, entities, versions, ai.snapshot.tasks)
  const keyframe = officialVersion(shot, 'keyframe', entities, versions)
  const scene = entities.find((entity) => entity.id === shot.sceneId && entity.kind === 'scene')
  const status = shotStatus(shot, 'video', entities, versions, ai.snapshot.tasks, workflows.runs)
  return <div><dl className="creator-inspector-facts"><dt>状态</dt><dd>{view.confirmed ? '已确认' : view.bindingBroken ? '不可用' : status === '准备就绪' ? '待生成' : status}</dd><dt>时长</dt><dd>{shot.durationSeconds}s</dd><dt>场次</dt><dd>{scene?.name ?? '未关联'}</dd><dt>关键帧</dt><dd>{keyframe ? '已确认' : '未确认'}</dd><dt>当前视频</dt><dd>{view.confirmed ? '已确认' : view.bindingBroken ? '绑定不可用' : '未确认'}</dd><dt>来源</dt><dd>{view.confirmed?.provider || (view.confirmed ? view.confirmed.sourceType === 'imported' ? '导入' : 'Legacy / provenance unavailable' : '—')}</dd><dt>确认时间</dt><dd>{view.confirmed ? new Date(view.confirmed.updatedAt).toLocaleString('zh-CN') : '—'}</dd><dt>候选数量</dt><dd>{view.candidates.length}</dd></dl>{view.confirmed && <details><summary>当前视频来源详情</summary><CandidateSource key={view.confirmed.id} version={view.confirmed} /></details>}<div className="creator-inspector-actions"><button onClick={() => navigateCreator('storyboard', { shotId: shot.id, sceneId: shot.sceneId })}>查看分镜</button><button onClick={() => navigateCreator('generation', { shotId: shot.id, sceneId: shot.sceneId, generationMode: 'video' })}>去生成</button></div></div>
}
