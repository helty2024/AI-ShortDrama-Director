import { SimpleBoard } from '../operations/SimpleBoard'
import { useSimpleMode } from '../operations/mode'
import { LazyPanel } from '../../components/LazyPanel'
import { nextAction } from '../../shared/operations'
import { useIntelligence } from '../script/use-intelligence'
import { TaskList } from '../script/TaskList'
import { useState } from 'react'
import type { Entity, Shot } from '../../shared/domain'
import type {
  CostSummary,
  PilotSnapshot,
  PilotCommand,
  ContinuityContext,
  BatchPreview,
  ProductionSettings,
} from '../../shared/production'
import {
  continuityContextSchema,
  batchPreviewSchema,
} from '../../shared/production'
import { useWorkspace } from '../workspace/state'
import { usePilot } from './use-pilot'
import { useVisual } from '../visual/use-visual'
import { AssetImage } from '../visual/AssetImage'
import { VisualPanel } from '../visual/VisualPanel'
import { VideoPanel } from '../video/VideoPanel'
import { ContinuityEditor } from './ContinuityEditor'
import './production.css'
export function CostView({ cost }: { cost: CostSummary }) {
  return (
    <span>
      {cost.currencies
        .map(
          (c) =>
            `${c.currency} 预计 ${c.estimatedMin.toFixed(2)}–${c.estimatedMax.toFixed(2)} / 已知实际 ${c.actual.toFixed(2)}`,
        )
        .join('；') || '暂无已知费用'}
      ；无法估算 {cost.unknownEstimated} 项 / 实际未知 {cost.unknownActual} 项
    </span>
  )
}
export function ProductionBoard() {
  const { state } = useWorkspace()
  const simple = useSimpleMode()
  if (simple)
    return (
      <>
        <h1>生产看板</h1>
        <SimpleBoard />
      </>
    )
  return (
    <>
      <h1>生产看板</h1>
      {state.workspace ? (
        <Board
          projectId={state.workspace.project.id}
          entities={state.workspace.entities}
        />
      ) : (
        <p>请先打开项目。</p>
      )}
    </>
  )
}
function Board({
  projectId,
  entities,
}: {
  projectId: string
  entities: Entity[]
}) {
  const [page, setPage] = useState(0)
  const ai = useIntelligence(projectId)
  const pilot = usePilot(projectId),
    { reload, state } = useWorkspace(),
    [episodeId, setEpisodeId] = useState(''),
    [sceneId, setSceneId] = useState(''),
    [filter, setFilter] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [profileId, setProfileId] = useState(''),
    [preview, setPreview] = useState<BatchPreview | null>(null),
    [accepted, setAccepted] = useState(false),
    [message, setMessage] = useState('')
  const s = pilot.snapshot
  const run = async (action: () => Promise<unknown>) => {
    try {
      const r = await action()
      if (typeof r === 'string') setMessage(r)
      await reload()
    } catch {
      /* hook owns errors */
    }
  }
  if (!s) return <p>{pilot.error || '读取生产状态…'}</p>
  const statuses = s.statuses.filter(
      (v) =>
        (!episodeId || v.episodeId === episodeId) &&
        (!sceneId || v.sceneId === sceneId),
    ),
    rows = statuses.filter((v) =>
      filter === 'keyMissing'
        ? v.keyframe === 'missing'
        : filter === 'keyReview'
          ? v.keyframe === 'review'
          : filter === 'videoMissing'
            ? v.video === 'missing'
            : filter === 'failed'
              ? v.failedTasks.length > 0
              : filter === 'videoReview'
                ? v.video === 'review'
                : filter === 'qc'
                  ? ['warning', 'stale', 'pending'].includes(v.qc)
                  : filter === 'complete'
                    ? v.complete
                    : true,
    )
  const disabled = pilot.busy || state.editorStatus !== 'saved'
  return (
    <section className="production-board">
      <p>
        按 Episode → Scene → Shot 管理素材生产。QC
        是建议，任何批次都不会自动确认版本。
      </p>
      <details>
        <summary>项目生产设置与 Provider 能力</summary>
        <Settings
          key={s.settings.revision}
          settings={s.settings}
          snapshot={s}
          projectId={projectId}
          execute={pilot.execute}
        />
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>T2V / I2V</th>
              <th>首尾帧 / 参考图</th>
              <th>最长时长</th>
              <th>分辨率 / 比例</th>
              <th>取消</th>
              <th>费用 / 可用性</th>
            </tr>
          </thead>
          <tbody>
            {s.capabilities.map((r) => (
              <tr key={r.profile.id}>
                <td>{r.profile.name}</td>
                <td>
                  {String(r.textToVideo)} / {String(r.imageToVideo)}
                </td>
                <td>
                  {String(r.profile.capabilities.endFrame)} /{' '}
                  {String(r.profile.capabilities.referenceImages)}
                </td>
                <td>{r.maxDuration}s</td>
                <td>
                  {r.profile.capabilities.resolutions.join(',')} /{' '}
                  {r.profile.capabilities.aspectRatios.join(',')}
                </td>
                <td>{String(r.profile.capabilities.cancel)}</td>
                <td>
                  {r.rate
                    ? `${r.rate.currency} ${r.rate.minPerSecond}–${r.rate.maxPerSecond}/s`
                    : '未知（Mock 无 API 费用）'}
                  ；{r.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <h2>项目成本</h2>
      {Object.entries(s.categoryCosts).map(([kind, cost]) => (
        <p key={kind}>
          {kind}：<CostView cost={cost} />
        </p>
      ))}
      <p>
        <CostView cost={s.projectCost} />
      </p>
      <details>
        <summary>Task / Shot / Scene / Episode 成本明细</summary>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>任务 / 报告</th>
              <th>Shot</th>
              <th>版本</th>
              <th>预计</th>
              <th>实际</th>
            </tr>
          </thead>
          <tbody>
            {s.costLines.map((l) => (
              <tr key={l.id}>
                <td>{l.kind}</td>
                <td>{l.taskId ?? l.id}</td>
                <td>
                  {entities.find((e) => e.id === l.shotId)?.name ??
                    'Bible / 项目'}
                </td>
                <td>{l.versionId ?? '未完成'}</td>
                <td>
                  {l.estimatedMin === null
                    ? '未知'
                    : `${l.currency} ${l.estimatedMin}–${l.estimatedMax}`}
                </td>
                <td>
                  {l.actual === null ? '未知' : `${l.currency} ${l.actual}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {s.episodes.map((e) => (
        <article key={e.id} aria-label={'分集摘要 ' + e.name}>
          <h2>{e.name}</h2>
          <p>
            {e.total} Shots · 完成 {e.complete}/{e.total} · 关键帧 {e.keyframes}
            /{e.total} · 视频 {e.videos}/{e.total} · QC 通过 {e.qcPassed}/
            {e.videos} · 待审核 {e.review} · 失败 {e.failed}
          </p>
          <p>
            <CostView cost={e.cost} />
          </p>
          <button
            onClick={() =>
              void run(() =>
                pilot.execute({
                  operation: 'manifest.export',
                  projectId,
                  episodeId: e.id,
                }),
              )
            }
          >
            导出 {e.name} Manifest
          </button>
        </article>
      ))}
      <div className="asset-filters">
        <label>
          生产 Episode
          <select
            value={episodeId}
            onChange={(e) => {
              setEpisodeId(e.target.value)
              setSceneId('')
            }}
          >
            <option value="">全部</option>
            {s.episodes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          生产 Scene
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            <option value="">全部</option>
            {entities
              .filter(
                (e) =>
                  e.kind === 'scene' &&
                  (!episodeId || e.episodeId === episodeId),
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          生产筛选
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {[
              ['', '全部'],
              ['keyMissing', '未生成关键帧'],
              ['keyReview', '待审核关键帧'],
              ['videoMissing', '未生成视频'],
              ['failed', '生成失败'],
              ['videoReview', '待审核视频'],
              ['qc', 'QC 问题'],
              ['complete', '已完成'],
            ].map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions">
        <button
          onClick={() => setSelected(rows.slice(0, 20).map((v) => v.shotId))}
        >
          当前范围全选
        </button>
        <button
          onClick={() =>
            setSelected(
              statuses
                .filter(
                  (v) => v.keyframe === 'confirmed' && v.video !== 'confirmed',
                )
                .slice(0, 20)
                .map((v) => v.shotId),
            )
          }
        >
          仅选可生产视频
        </button>
        <button
          onClick={() =>
            setSelected(
              statuses
                .filter((v) =>
                  s.reports.some(
                    (r) => r.shotId === v.shotId && r.status === 'rejected',
                  ),
                )
                .slice(0, 20)
                .map((v) => v.shotId),
            )
          }
        >
          仅选 QC Reject
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            void run(() =>
              pilot.execute({
                operation: 'tasks.retry',
                projectId,
                taskIds: statuses.flatMap((v) => v.failedTasks).slice(0, 20),
              }),
            )
          }
        >
          仅重试 failed
        </button>
        <button onClick={() => setSelected([])}>清空生产选择</button>
      </div>
      <label>
        批量视频 Profile
        <select
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value)
            setPreview(null)
            setAccepted(false)
          }}
        >
          <option value="">规则路由推荐</option>
          {s.capabilities.map((r) => (
            <option key={r.profile.id} value={r.profile.id}>
              {r.profile.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={disabled || !selected.length}
        onClick={() =>
          void run(async () => {
            setPreview(
              batchPreviewSchema.parse(
                await pilot.execute({
                  operation: 'batch.preview',
                  projectId,
                  shotIds: selected,
                  profileId: profileId || null,
                }),
              ),
            )
            setAccepted(false)
          })
        }
      >
        预览批量视频生产
      </button>
      {preview && (
        <article aria-label="批量视频预览">
          <h3>批量视频预览</h3>
          {preview.items.map((i) => (
            <details key={i.shotId}>
              <summary>
                {entities.find((e) => e.id === i.shotId)?.name} ·{' '}
                {s.capabilities.find((r) => r.profile.id === i.profileId)
                  ?.profile.name ?? '不可用'}
              </summary>
              <p>{i.error || i.reason}</p>
              <pre>{i.prompt ? JSON.stringify(i.prompt, null, 2) : ''}</pre>
            </details>
          ))}
          <p>
            <CostView cost={preview.cost} />
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            我已核对 Provider 和预计费用；未知费用不代表免费，确认提交本批次。
          </label>
          <button
            disabled={
              disabled ||
              !accepted ||
              !!s.previews.find((b) => b.id === preview.id)?.submittedGroupId
            }
            onClick={() =>
              void run(() =>
                pilot.execute({
                  operation: 'batch.confirm',
                  projectId,
                  id: preview.id,
                  expectedRevision: preview.revision,
                  costAccepted: accepted,
                }),
              )
            }
          >
            确认开始批量视频生产
          </button>
        </article>
      )}
      {(pilot.error || message) && <p role="alert">{pilot.error || message}</p>}
      <p>
        镜头第 {page + 1} 页 · 共 {rows.length} 项
      </p>
      <button disabled={!page} onClick={() => setPage((n) => n - 1)}>
        上一页镜头
      </button>
      <button
        disabled={(page + 1) * 20 >= rows.length}
        onClick={() => setPage((n) => n + 1)}
      >
        下一页镜头
      </button>
      {s.scenes
        .filter((scene) =>
          rows
            .slice(page * 20, (page + 1) * 20)
            .some((r) => r.sceneId === scene.id),
        )
        .map((scene) => (
          <section key={scene.id}>
            <h2>
              {scene.name} · {scene.complete}/{scene.total} 完成
            </h2>
            <p>
              <CostView cost={scene.cost} />
            </p>
            {rows
              .slice(page * 20, (page + 1) * 20)
              .filter((r) => r.sceneId === scene.id)
              .map((status) => {
                const shot = entities.find((e) => e.id === status.shotId)
                return shot?.kind === 'shot' ? (
                  <article
                    className="production-shot"
                    aria-label={'生产镜头 ' + shot.name}
                    key={shot.id}
                  >
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={selected.includes(shot.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, shot.id].slice(0, 20)
                              : selected.filter((id) => id !== shot.id),
                          )
                        }
                      />
                      <strong>
                        Shot {shot.plan?.shotNumber ?? shot.order + 1} ·{' '}
                        {shot.name}
                      </strong>
                    </label>
                    <p>下一步：{nextAction(status)}</p>
                    {shot.approvedKeyframeVersionId && (
                      <AssetImage
                        projectId={projectId}
                        versionId={shot.approvedKeyframeVersionId}
                        alt={shot.name}
                      />
                    )}
                    <p>
                      {entities
                        .filter((e) => shot.characterIds.includes(e.id))
                        .map((e) => e.name)
                        .join('、')}{' '}
                      ·{' '}
                      {entities.find((e) => e.id === shot.locationId)?.name ??
                        '无地点'}{' '}
                      · {shot.durationSeconds}s ·{' '}
                      {status.provider ?? '未选择 Provider'}
                    </p>
                    <p>
                      Keyframe: {status.keyframe} · Video: {status.video} · QC:{' '}
                      {status.qc} ·{' '}
                      {status.complete ? 'Production Complete' : '生产中'}
                    </p>
                    <p>
                      <CostView cost={status.cost} />
                    </p>
                    <ShotTools
                      shot={shot}
                      entities={entities}
                      snapshot={s}
                      execute={pilot.execute}
                    />
                    <LazyPanel title="关键帧生产与审核">
                      <VisualPanel entity={shot} entities={entities} />
                    </LazyPanel>
                    <LazyPanel title="视频生产与审核">
                      <VideoPanel shot={shot} entities={entities} />
                    </LazyPanel>
                  </article>
                ) : null
              })}
          </section>
        ))}
      <h2>视频批次</h2>
      {s.batches
        .filter((b) => b.kind === 'video')
        .toReversed()
        .map((b) => (
          <article key={b.id}>
            <h3>{b.name}</h3>
            <p>
              {
                ai.snapshot.tasks.filter(
                  (t) =>
                    t.status === 'succeeded' &&
                    b.entries.some((e) => e.taskId === t.id),
                ).length
              }
              /{b.entries.length} 已完成任务
            </p>
            <TaskList
              tasks={ai.snapshot.tasks.filter((t) =>
                b.entries.some((e) => e.taskId === t.id),
              )}
              execute={ai.execute}
            />
            {b.entries.map((e) => (
              <p key={e.shotId}>
                {entities.find((v) => v.id === e.shotId)?.name}：
                {e.error ?? '任务 ' + e.taskId}
              </p>
            ))}
            <button
              disabled={disabled}
              onClick={() =>
                void run(() =>
                  pilot.execute({
                    operation: 'batch.cancel',
                    projectId,
                    id: b.id,
                  }),
                )
              }
            >
              取消此批次等待与运行任务
            </button>
          </article>
        ))}
    </section>
  )
}
export function ShotTools({
  shot,
  entities,
  snapshot,
  execute,
}: {
  shot: Shot
  entities: Entity[]
  snapshot: PilotSnapshot
  execute: (c: PilotCommand) => Promise<unknown>
}) {
  const visual = useVisual(shot.projectId),
    [context, setContext] = useState<ContinuityContext | null>(null),
    [versionId, setVersionId] = useState(''),
    [error, setError] = useState(''),
    [costAccepted, setCostAccepted] = useState(false),
    [busy, setBusy] = useState(false)
  const versions =
      visual.snapshot?.versions.filter(
        (v) =>
          v.metadata.targetId === shot.id || shot.assetIds.includes(v.assetId),
      ) ?? [],
    current =
      versionId ||
      shot.confirmedVideoAssetVersionId ||
      versions.at(-1)?.id ||
      ''
  const run = async (c: PilotCommand) => {
    setBusy(true)
    setError('')
    try {
      return await execute(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      return null
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        disabled={busy}
        onClick={() =>
          void run({
            operation: 'continuity.resolve',
            projectId: shot.projectId,
            shotId: shot.id,
          }).then((r) => {
            const c = continuityContextSchema.safeParse(r)
            if (c.success) setContext(c.data)
          })
        }
      >
        读取 / 编辑连续性
      </button>
      {context && (
        <ContinuityEditor
          key={context.fingerprint}
          shot={shot}
          context={context}
          snapshot={snapshot}
          entities={entities}
          execute={execute}
        />
      )}
      <details>
        <summary>Visual / Video QC</summary>
        <label>
          QC 素材版本
          <select
            value={current}
            onChange={(e) => setVersionId(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.mimeType} v{v.versionNumber} · {v.status}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!current || busy}
          onClick={() =>
            void run({
              operation: 'qc.run',
              projectId: shot.projectId,
              shotId: shot.id,
              versionId: current,
            })
          }
        >
          运行 Mock QC
        </button>
        <p>Mock 只验证元数据与连续性规则，不代表真实视觉模型评分。</p>
        {snapshot.reports
          .filter((r) => r.shotId === shot.id && r.versionId === current)
          .toReversed()
          .map((r) => (
            <article key={r.id} aria-label="QC 报告">
              <h4>
                {r.provider} · {r.status} · 总分 {r.output.overallScore}
              </h4>
              <p>版本 {r.versionId}</p>
              <p>
                identity {r.output.identityScore} · costume{' '}
                {r.output.costumeScore} · location {r.output.locationScore} ·
                prop {r.output.propScore} · action {r.output.actionScore} ·
                camera {r.output.cameraScore} · integrity{' '}
                {r.output.visualIntegrityScore} · continuity{' '}
                {r.output.continuityScore}
              </p>
              {r.output.issues.map((i, n) => (
                <p key={n}>
                  {i.severity} / {i.category}：{i.description}；
                  {i.affectedSubject}；{i.suggestedFix}
                </p>
              ))}
              {r.output.suggestions.map((i, n) => (
                <p key={n}>{i}</p>
              ))}
              {(['accepted', 'ignored', 'rejected'] as const).map(
                (decision, i) => (
                  <button
                    key={decision}
                    disabled={busy}
                    onClick={() =>
                      void run({
                        operation: 'qc.review',
                        projectId: shot.projectId,
                        id: r.id,
                        expectedRevision: r.revision,
                        decision,
                      })
                    }
                  >
                    {['Accept QC', 'Ignore warning', 'Reject version'][i]}
                  </button>
                ),
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run({
                    operation: 'regeneration.plan',
                    projectId: shot.projectId,
                    reportId: r.id,
                  })
                }
              >
                制定 Regeneration Plan
              </button>
            </article>
          ))}
        {snapshot.plans
          .filter((p) => p.shotId === shot.id)
          .toReversed()
          .map((p) => (
            <article key={p.id}>
              <h4>Regeneration Plan</h4>
              {p.instructions.map((v, i) => (
                <p key={i}>{v}</p>
              ))}
              <p>{p.newSeed ? '更换 Seed' : '沿用 Seed'}；生成一次候选版本</p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={costAccepted}
                  onChange={(e) => setCostAccepted(e.target.checked)}
                />
                确认重生方案及可能产生的费用
              </label>
              <button
                disabled={
                  busy ||
                  !costAccepted ||
                  !!p.submittedTaskId ||
                  p.executionState !== 'ready'
                }
                onClick={() =>
                  void run({
                    operation: 'regeneration.confirm',
                    projectId: shot.projectId,
                    id: p.id,
                    expectedRevision: p.revision,
                    costAccepted,
                  })
                }
              >
                确认执行重生
              </button>
            </article>
          ))}
      </details>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
function Settings({
  settings,
  snapshot,
  projectId,
  execute,
}: {
  settings: ProductionSettings
  snapshot: PilotSnapshot
  projectId: string
  execute: (c: PilotCommand) => Promise<unknown>
}) {
  const [value, setValue] = useState(settings),
    [profileId, setProfileId] = useState(
      snapshot.capabilities[0]?.profile.id ?? '',
    ),
    [min, setMin] = useState(0),
    [max, setMax] = useState(0),
    [currency, setCurrency] = useState('CNY'),
    [message, setMessage] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void execute({ operation: 'settings.save', projectId, settings: value })
          .then(() => setMessage('已保存'))
          .catch(() => undefined)
      }}
    >
      <label>
        QC 完成标准
        <select
          value={value.qcMode}
          onChange={(e) =>
            setValue({
              ...value,
              qcMode: e.target.value as 'strict' | 'advisory',
            })
          }
        >
          <option value="strict">Strict QC</option>
          <option value="advisory">Advisory QC（允许人工忽略）</option>
        </select>
      </label>
      <label>
        Router 偏好
        <select
          value={value.preferredProfileId ?? ''}
          onChange={(e) =>
            setValue({ ...value, preferredProfileId: e.target.value || null })
          }
        >
          <option value="">无偏好</option>
          {snapshot.capabilities.map((r) => (
            <option key={r.profile.id} value={r.profile.id}>
              {r.profile.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        路由分辨率
        <select
          value={value.resolution}
          onChange={(e) =>
            setValue({
              ...value,
              resolution: e.target.value as ProductionSettings['resolution'],
            })
          }
        >
          {['480p', '720p', '1080p'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        运动复杂度
        <select
          value={value.motionComplexity}
          onChange={(e) =>
            setValue({
              ...value,
              motionComplexity: e.target
                .value as ProductionSettings['motionComplexity'],
            })
          }
        >
          {['subtle', 'normal', 'complex'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>手工报价估算（不代表供应商实际账单）</legend>
        <select
          aria-label="报价 Profile"
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
        >
          {snapshot.capabilities.map((r) => (
            <option key={r.profile.id} value={r.profile.id}>
              {r.profile.name}
            </option>
          ))}
        </select>
        <label>
          币种
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
        </label>
        <label>
          每秒最低
          <input
            type="number"
            min={0}
            step="0.001"
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
          />
        </label>
        <label>
          每秒最高
          <input
            type="number"
            min={0}
            step="0.001"
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setValue({
              ...value,
              rates: [
                ...value.rates.filter((r) => r.profileId !== profileId),
                { profileId, currency, minPerSecond: min, maxPerSecond: max },
              ],
            })
          }
        >
          添加报价到待保存设置
        </button>
        {value.rates.map((r) => (
          <p key={r.profileId}>
            {
              snapshot.capabilities.find((v) => v.profile.id === r.profileId)
                ?.profile.name
            }{' '}
            {r.currency} {r.minPerSecond}–{r.maxPerSecond}/s{' '}
            <button
              type="button"
              onClick={() =>
                setValue({
                  ...value,
                  rates: value.rates.filter((v) => v.profileId !== r.profileId),
                })
              }
            >
              移除报价
            </button>
          </p>
        ))}
      </fieldset>
      <button>保存生产设置</button>
      {message}
    </form>
  )
}
