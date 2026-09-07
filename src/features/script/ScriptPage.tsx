import { useState } from 'react'
import { useWorkspace } from '../workspace/state'
import { SceneEditor } from './SceneEditor'
import { useIntelligence } from './use-intelligence'
import { ImportPanel } from './ImportPanel'
import { DraftCard } from './DraftCard'
import { categoryLabels } from './labels'
import { TaskList } from './TaskList'
import type { Entity, Episode, Scene } from '../../shared/domain'
import type { IntelligenceCommand } from '../../shared/intelligence'

export function ScriptPage() {
  const { state } = useWorkspace()
  if (!state.workspace)
    return (
      <>
        <h1>剧本</h1>
        <p className="empty">请先打开项目。</p>
      </>
    )
  return (
    <ScriptWorkspace
      projectId={state.workspace.project.id}
      entities={state.workspace.entities}
    />
  )
}
function ScriptWorkspace({
  projectId,
  entities,
}: {
  projectId: string
  entities: Entity[]
}) {
  const { state, modal, reload, setEditorStatus } = useWorkspace()
  const ai = useIntelligence(projectId)
  const [scriptId, setScriptId] = useState(''),
    [episodeId, setEpisodeId] = useState(''),
    [sceneId, setSceneId] = useState(''),
    [epoch, setEpoch] = useState(0)
  const [error, setError] = useState(''),
    [tab, setTab] = useState<'analysis' | 'import'>('analysis'),
    [showReviewed, setShowReviewed] = useState(false)
  const scripts = entities.filter((e) => e.kind === 'script')
  const script = scripts.find((e) => e.id === scriptId) ?? scripts[0]
  const episodes = entities
    .filter(
      (e): e is Episode => e.kind === 'episode' && e.scriptId === script?.id,
    )
    .sort((a, b) => a.order - b.order)
  const episode = episodes.find((e) => e.id === episodeId) ?? episodes[0]
  const scenes = entities
    .filter(
      (e): e is Scene => e.kind === 'scene' && e.episodeId === episode?.id,
    )
    .sort((a, b) => a.order - b.order)
  const scene = scenes.find((e) => e.id === sceneId) ?? scenes[0]
  const safe = () => {
    if (state.editorStatus === 'saving') {
      setError('正在保存，请稍候')
      return false
    }
    if (state.editorStatus !== 'saved') {
      if (!window.confirm('存在未保存修改，是否放弃并切换？')) return false
      setEpoch((n) => n + 1)
    }
    setEditorStatus('saved')
    setError('')
    return true
  }
  const execute = async (command: IntelligenceCommand) => {
    if (!safe()) return
    try {
      await ai.execute(command)
      await reload()
      setEpoch((n) => n + 1)
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败')
    }
  }
  const drafts = ai.snapshot.drafts.filter(
    (d) => d.sceneId === scene?.id && (showReviewed || d.status === 'pending'),
  )
  const clean = state.editorStatus === 'saved' && !ai.busy
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>剧本</h1>
          <p>结构化创作 → 智能草稿 → 人工审核 → 生产数据</p>
        </div>
        <button
          onClick={() => {
            if (safe()) modal({ type: 'entity', kind: 'script' })
          }}
        >
          新建剧本
        </button>
      </div>
      {(error || ai.error) && (
        <p className="error" role="alert">
          {error || ai.error}
        </p>
      )}
      <div className="script-layout">
        <section className="script-tree" aria-label="分集场次树">
          <label>
            当前剧本
            <select
              aria-label="当前剧本"
              value={script?.id ?? ''}
              onChange={(e) => {
                if (safe()) {
                  setScriptId(e.target.value)
                  setEpisodeId('')
                  setSceneId('')
                  setEpoch((n) => n + 1)
                }
              }}
            >
              <option value="" disabled>
                请选择剧本
              </option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!script}
            onClick={() => {
              if (safe()) modal({ type: 'entity', kind: 'episode' })
            }}
          >
            新建分集
          </button>
          <label>
            当前分集
            <select
              aria-label="当前分集"
              value={episode?.id ?? ''}
              onChange={(e) => {
                if (safe()) {
                  setEpisodeId(e.target.value)
                  setSceneId('')
                  setEpoch((n) => n + 1)
                }
              }}
            >
              <option value="" disabled>
                请选择分集
              </option>
              {episodes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          {episode && (
            <EpisodeName
              key={episode.id + ':' + episode.revision}
              episode={episode}
              execute={execute}
            />
          )}
          {episode && (
            <button
              className="danger"
              onClick={() => {
                if (window.confirm('删除该分集及其场次、分镜和镜头？'))
                  void execute({
                    operation: 'tree.delete',
                    projectId,
                    id: episode.id,
                    expectedRevision: episode.revision,
                  })
              }}
            >
              删除分集
            </button>
          )}
          <div className="section-heading">
            <h3>场次</h3>
            <button
              disabled={!episode}
              onClick={() => {
                if (safe()) modal({ type: 'entity', kind: 'scene' })
              }}
            >
              新建场次
            </button>
          </div>
          {!scenes.length && <p>尚无场次，可新增或从右侧导入。</p>}
          <ol className="scene-tree-list">
            {scenes.map((item, index) => (
              <li key={item.id}>
                <button
                  aria-current={scene?.id === item.id ? 'true' : undefined}
                  onClick={() => {
                    if (item.id !== scene?.id && safe()) {
                      setSceneId(item.id)
                      setEpoch((n) => n + 1)
                    }
                  }}
                >
                  {item.content.sceneNumber || index + 1} ·{' '}
                  {item.content.heading || item.name}
                </button>
                <div className="actions">
                  {([-1, 1] as const).map((offset) => (
                    <button
                      key={offset}
                      aria-label={(offset < 0 ? '上移 ' : '下移 ') + item.name}
                      disabled={
                        !episode ||
                        index + offset < 0 ||
                        index + offset >= scenes.length
                      }
                      onClick={() => {
                        if (!episode) return
                        const ids = scenes.map((s) => s.id)
                        ;[ids[index], ids[index + offset]] = [
                          ids[index + offset]!,
                          ids[index]!,
                        ]
                        void execute({
                          operation: 'scenes.reorder',
                          projectId,
                          id: episode.id,
                          expectedRevision: episode.revision,
                          sceneIds: ids,
                        })
                      }}
                    >
                      {offset < 0 ? '↑' : '↓'}
                    </button>
                  ))}
                  <button
                    className="danger"
                    aria-label={'删除场次 ' + item.name}
                    onClick={() => {
                      if (window.confirm('删除该场次及关联镜头和草稿？'))
                        void execute({
                          operation: 'tree.delete',
                          projectId,
                          id: item.id,
                          expectedRevision: item.revision,
                        })
                    }}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </section>
        {scene ? (
          <SceneEditor
            key={scene.id + ':' + epoch}
            scene={scene}
            entities={entities}
          />
        ) : (
          <section className="empty">
            <h2>开始创作</h2>
            <p>新建剧本、分集和场次，或导入已有文本。</p>
          </section>
        )}
        <section className="intelligence-panel" aria-label="智能分析面板">
          <h2>智能分析</h2>
          <p className="muted">Provider：{ai.snapshot.provider || '加载中'}</p>
          <div className="actions">
            <button
              aria-pressed={tab === 'analysis'}
              onClick={() => setTab('analysis')}
            >
              制作拆解
            </button>
            <button
              aria-pressed={tab === 'import'}
              onClick={() => setTab('import')}
            >
              剧本解析 / 导入
            </button>
          </div>
          {tab === 'import' ? (
            <ImportPanel
              projectId={projectId}
              snapshot={ai.snapshot}
              execute={ai.execute}
              refreshWorkspace={reload}
            />
          ) : (
            <>
              <p>
                分析已保存内容。结果需要编辑、确认或合并后才能成为正式数据。
              </p>
              <div className="analysis-actions">
                <button
                  disabled={!scene || !clean}
                  onClick={() =>
                    scene &&
                    void ai
                      .execute({
                        operation: 'task.start',
                        projectId,
                        input: { type: 'breakdown', targetId: scene.id },
                      })
                      .catch(() => undefined)
                  }
                >
                  分析当前场次
                </button>
                <button
                  disabled={!episode || !scenes.length || !clean}
                  onClick={() =>
                    episode &&
                    void ai
                      .execute({
                        operation: 'task.start',
                        projectId,
                        input: { type: 'breakdown', targetId: episode.id },
                      })
                      .catch(() => undefined)
                  }
                >
                  批量分析本集
                </button>
                <button
                  disabled={!script || !clean}
                  onClick={() =>
                    script &&
                    void ai
                      .execute({
                        operation: 'task.start',
                        projectId,
                        input: { type: 'breakdown', targetId: script.id },
                      })
                      .catch(() => undefined)
                  }
                >
                  分析整个剧本
                </button>
                <button
                  disabled={!scene || !clean}
                  onClick={() =>
                    scene &&
                    void ai
                      .execute({
                        operation: 'task.start',
                        projectId,
                        input: { type: 'characterBible', targetId: scene.id },
                      })
                      .catch(() => undefined)
                  }
                >
                  角色 Bible 建议
                </button>
                <button
                  disabled={!scene || !clean}
                  onClick={() =>
                    scene &&
                    void ai
                      .execute({
                        operation: 'task.start',
                        projectId,
                        input: { type: 'shotPlanning', targetId: scene.id },
                      })
                      .catch(() => undefined)
                  }
                >
                  导演拆镜
                </button>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={showReviewed}
                  onChange={(e) => setShowReviewed(e.target.checked)}
                />
                显示已审核结果
              </label>
              <h3>当前场次 Draft（{drafts.length}）</h3>
              {!drafts.length && <p>暂无结果。可选择当前场次重新分析。</p>}
              {drafts.map((draft) => (
                <DraftCard
                  key={draft.id + ':' + draft.revision}
                  draft={draft}
                  locked={state.editorStatus !== 'saved'}
                  entities={entities}
                  production={ai.snapshot.production}
                  execute={ai.execute}
                  refreshWorkspace={reload}
                />
              ))}
              <details>
                <summary>
                  Production Bible（{ai.snapshot.production.length}）
                </summary>
                {ai.snapshot.production.map((item) => (
                  <article key={item.id}>
                    <strong>
                      {categoryLabels[item.category]} · {item.name}
                    </strong>
                    <p>{item.description}</p>
                    <small>
                      来源场次：
                      {item.sceneIds
                        .map(
                          (id) =>
                            entities.find((e) => e.id === id)?.name ?? '已删除',
                        )
                        .join('、')}
                    </small>
                  </article>
                ))}
              </details>
            </>
          )}
          <TaskList tasks={ai.snapshot.tasks} execute={ai.execute} />
        </section>
      </div>
    </>
  )
}
function EpisodeName({
  episode,
  execute,
}: {
  episode: Episode
  execute: (command: IntelligenceCommand) => Promise<void>
}) {
  const [name, setName] = useState(episode.name)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void execute({
          operation: 'episode.rename',
          projectId: episode.projectId,
          id: episode.id,
          expectedRevision: episode.revision,
          name,
        })
      }}
    >
      <label>
        分集名称
        <input
          required
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button disabled={!name.trim() || name === episode.name}>
        保存分集名称
      </button>
    </form>
  )
}
