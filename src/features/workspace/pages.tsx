import { OperationsPage } from '../operations/OperationsPage'
import { LazyPanel } from '../../components/LazyPanel'
import { BatchPanel } from '../video/BatchPanel'
import { VideoPanel } from '../video/VideoPanel'
import { VisualPanel } from '../visual/VisualPanel'
import { BibleEditor } from '../script/BibleEditor'
import type { EntityKind } from '../../shared/domain'
import { useWorkspace } from './state'
import { workspaceService } from '../../services/workspace'

import { entityLabels } from './labels'

function EntityList({ kind }: { kind: EntityKind }) {
  const { state, modal } = useWorkspace()
  const entities = state.workspace?.entities ?? []
  const rows = entities.filter((entity) => entity.kind === kind)
  const lookup = (id: string) =>
    entities.find((entity) => entity.id === id)?.name ?? '未知对象'
  return (
    <section className="list-section" aria-label={entityLabels[kind] + '列表'}>
      <div className="section-heading">
        <h2>
          {entityLabels[kind]} <span className="count">{rows.length}</span>
        </h2>
        <button
          disabled={!state.workspace || state.loading || state.saving}
          onClick={() => modal({ type: 'entity', kind })}
        >
          新增{entityLabels[kind]}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="empty">
          暂无{entityLabels[kind]}。
          {state.workspace
            ? '使用新增入口创建第一条记录。'
            : '请先打开一个项目。'}
        </p>
      ) : (
        <ul className="entity-list">
          {rows.map((entity) => (
            <li key={entity.id}>
              <div>
                <strong>{entity.name}</strong>
                {(entity.kind === 'character' ||
                  entity.kind === 'location' ||
                  entity.kind === 'prop') && (
                  <BibleEditor
                    key={entity.id + ':' + entity.revision}
                    entity={entity}
                    entities={entities}
                  />
                )}
                <p>{entity.description || '暂无简介'}</p>
                {entity.kind === 'shot' && (
                  <LazyPanel title="视频生产">
                    <VideoPanel shot={entity} entities={entities} />
                  </LazyPanel>
                )}
                {(entity.kind === 'character' ||
                  entity.kind === 'location' ||
                  entity.kind === 'prop' ||
                  entity.kind === 'shot') && (
                  <LazyPanel title="视觉生产">
                    <VisualPanel entity={entity} entities={entities} />
                  </LazyPanel>
                )}
                {entity.kind === 'script' && (
                  <p>{entity.content || '剧本内容待填写。'}</p>
                )}
                {entity.kind === 'episode' && (
                  <p>所属剧本：{lookup(entity.scriptId)}</p>
                )}
                {entity.kind === 'scene' && (
                  <p>
                    所属分集：{lookup(entity.episodeId)} · 场景：
                    {entity.locationId ? lookup(entity.locationId) : '未关联'}
                  </p>
                )}
                {entity.kind === 'storyboard' && (
                  <p>所属分集：{lookup(entity.episodeId)}</p>
                )}
                {entity.kind === 'shot' && (
                  <p>
                    场次：{lookup(entity.sceneId)} · {entity.durationSeconds} 秒
                    <br />
                    角色：
                    {entity.characterIds.map(lookup).join('、') || '未关联'} ·
                    场景：
                    {entity.locationId ? lookup(entity.locationId) : '未关联'}
                    <br />
                    道具：{entity.propIds.map(lookup).join('、') || '未关联'} ·
                    素材：{entity.assetIds.map(lookup).join('、') || '未关联'}
                  </p>
                )}
                {entity.kind === 'shot' && entity.plan && (
                  <details>
                    <summary>已确认镜头计划</summary>
                    <p>
                      {entity.plan.shotType} · {entity.plan.framing} ·{' '}
                      {entity.plan.cameraAngle} · {entity.plan.cameraMovement}
                    </p>
                    <p>焦距建议：{entity.plan.focalLengthSuggestion}</p>
                    <p>主体：{entity.plan.subject}</p>
                    <p>动作：{entity.plan.action}</p>
                    <p>情绪：{entity.plan.emotion}</p>
                    <p>连续性：{entity.plan.continuityNotes}</p>
                  </details>
                )}
                {'assetIds' in entity && entity.kind !== 'shot' && (
                  <p>
                    关联素材：
                    {entity.assetIds.map(lookup).join('、') || '未关联'}
                  </p>
                )}
                {entity.kind === 'asset' && (
                  <p>
                    {entity.status === 'placeholder'
                      ? '占位记录，尚无媒体文件'
                      : entity.status}{' '}
                    · {entity.mediaType}
                  </p>
                )}
                {entity.kind === 'generationTask' && (
                  <p>
                    状态：{entity.status} ·{' '}
                    {entity.source?.providerId ??
                      '未配置 Provider，尚未提交生成'}
                  </p>
                )}
              </div>
              <small>v{entity.revision}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
export function ProjectPage() {
  const { state, open, modal, mutate } = useWorkspace()
  const busy = state.loading || state.saving
  const recent = state.projects
    .filter((project) => project.lastOpenedAt)
    .slice(0, 5)
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>项目</h1>
          <p>创建和管理本地短剧项目。</p>
        </div>
        <div className="actions">
          {window.desktop?.development && (
            <button
              disabled={busy}
              onClick={() =>
                void mutate(
                  async () =>
                    (
                      await workspaceService.open(
                        (await workspaceService.seed()).id,
                      )
                    ).id,
                )
              }
            >
              载入开发示例
            </button>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() => modal({ type: 'project' })}
          >
            新建项目
          </button>
        </div>
      </div>
      <section aria-label="最近打开项目">
        <h2>最近打开</h2>
        {recent.length ? (
          <div className="recent">
            {recent.map((project) => (
              <button
                key={project.id}
                disabled={busy}
                onClick={() => void open(project.id)}
              >
                {project.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="empty">还没有最近打开的项目。</p>
        )}
      </section>
      <section aria-label="项目列表">
        <h2>
          全部项目 <span className="count">{state.projects.length}</span>
        </h2>
        {!state.projects.length && (
          <p className="empty">
            暂无项目。新建一个项目，或载入开发示例开始体验。
          </p>
        )}
        <div className="project-grid">
          {state.projects.map((project) => (
            <article className="project-card" key={project.id}>
              <h3>{project.name}</h3>
              <p>{project.description || '暂无简介'}</p>
              <p>
                {project.genre} · {project.aspectRatio} · {project.language}
              </p>
              <small>
                创建于 {new Date(project.createdAt).toLocaleString('zh-CN')}
              </small>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void open(project.id)}
                >
                  {state.workspace?.project.id === project.id
                    ? '已打开 · 刷新'
                    : '打开项目'}
                </button>
                <button
                  disabled={busy}
                  onClick={() => modal({ type: 'rename', project })}
                >
                  重命名
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => modal({ type: 'delete', project })}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}
export function CharactersPage() {
  return (
    <>
      <h1>角色</h1>
      <EntityList kind="character" />
    </>
  )
}
export function LocationsPage() {
  return (
    <>
      <h1>场景</h1>
      <p>场景是可复用地点；剧本中的场次可引用场景。</p>
      <EntityList kind="location" />
    </>
  )
}
export function PropsPage() {
  return (
    <>
      <h1>道具</h1>
      <EntityList kind="prop" />
    </>
  )
}
export function StoryboardPage() {
  return (
    <>
      <h1>分镜</h1>
      <BatchPanel />
      <EntityList kind="storyboard" />
      <EntityList kind="shot" />
    </>
  )
}
export function GenerationPage() {
  return (
    <>
      <h1>生成</h1>
      <OperationsPage tasksOnly />
      <p>上方统一追踪文本、图片和视频任务；下方保留早期媒体任务记录。</p>
      <EntityList kind="generationTask" />
    </>
  )
}
