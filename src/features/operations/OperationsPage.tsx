import { AssetImage } from '../visual/AssetImage'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  aboutSchema,
  operationsSnapshotSchema,
  validationRecordSchema,
} from '../../shared/operations'
import type {
  OperationsSnapshot,
  ValidationRecord,
} from '../../shared/operations'
import { productionService } from '../../services/production'
import { useWorkspace } from '../workspace/state'
import { operate } from './api'
import { LazyPanel } from '../../components/LazyPanel'
import { projectSchema } from '../../shared/domain'
export function PaidTest({
  projectId,
  shotId,
}: {
  projectId: string
  shotId: string
}) {
  const { reload } = useWorkspace()
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]),
    [profile, setProfile] = useState(''),
    [preview, setPreview] = useState<ValidationRecord | null>(null),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void productionService
      .snapshot(projectId)
      .then((s) => {
        if (active) setProfiles(s.profiles)
      })
      .catch(() => setError('无法读取服务配置'))
    return () => {
      active = false
    }
  }, [projectId])
  const run = async (submit: boolean) => {
    setBusy(true)
    setError('')
    try {
      const r = await operate(
        submit && preview
          ? {
              operation: 'paid.submit',
              projectId,
              previewId: preview.id,
              confirmed: true,
            }
          : {
              operation: 'paid.preview',
              projectId,
              shotId,
              profileId: profile || profiles[0]!.id,
            },
      )
      setPreview(validationRecordSchema.parse(r))
      if (submit) await reload()
      setAccepted(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="单镜头视频验收">
      <label>
        视频服务
        <select
          value={profile}
          onChange={(e) => {
            setProfile(e.target.value)
            setPreview(null)
            setAccepted(false)
          }}
        >
          <option value="">选择服务</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || !profiles.length}
        onClick={() => void run(false)}
      >
        预览单镜头最小测试
      </button>
      {preview && (
        <article>
          <h3>提交前核对 · {preview.result}</h3>
          <dl>
            {[
              'provider',
              'endpoint',
              'model',
              'duration',
              'resolution',
              'keyframe',
              'estimatedCost',
              'credentialConfigured',
              'warning',
            ].map((key) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(preview.details[key])}</dd>
              </div>
            ))}
          </dl>
          {typeof preview.details.keyframe === 'string' && (
            <AssetImage
              projectId={projectId}
              versionId={preview.details.keyframe}
              alt="本次视频首帧"
            />
          )}
          <h4>本次完整 Prompt</h4>
          <pre className="paid-prompt">
            {JSON.stringify(preview.details.prompt, null, 2)}
          </pre>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            我已核对以上参数，允许提交这一镜头并承担可能产生的费用
          </label>
          <button
            disabled={busy || !accepted || preview.result !== 'ready'}
            onClick={() => void run(true)}
          >
            Test Submit · 确认提交
          </button>
          {preview.details.taskId && (
            <p>
              任务已进入队列：{String(preview.details.taskId)}
              。在任务中心查看远程 ID、进度和恢复。
            </p>
          )}
        </article>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
export function SetupWizard() {
  const { state, navigate, modal } = useWorkspace(),
    [dismissed, setDismissed] = useState(
      () => localStorage.getItem('director-setup') === 'done',
    ),
    [tools, setTools] = useState('')
  if (dismissed || state.loading) return null
  return (
    <section aria-label="首次设置">
      <h2>首次设置 · Setup Wizard</h2>
      <ol>
        <li>
          <button onClick={() => modal({ type: 'project' })}>
            1. 创建第一个项目
          </button>
        </li>
        <li>
          <button
            onClick={() =>
              void operate({ operation: 'about' })
                .then((r) => {
                  const a = aboutSchema.parse(r)
                  setTools(a.ffmpeg + ' / ' + a.ffprobe)
                })
                .catch(() => setTools('检测失败，请检查 FFmpeg 安装'))
            }
          >
            2. 检查 FFmpeg / FFprobe
          </button>
          <p>{tools}</p>
        </li>
        <li>
          <button onClick={() => navigate('settings')}>
            3. 可选配置 ComfyUI
          </button>
        </li>
        <li>
          <button onClick={() => navigate('settings')}>
            4. 可选配置 Seedance（需自行绑定凭据）
          </button>
        </li>
        <li>
          <button
            onClick={() => {
              localStorage.setItem('director-setup', 'done')
              setDismissed(true)
            }}
          >
            5. 进入工作台 / 暂时跳过设置
          </button>
        </li>
      </ol>
    </section>
  )
}
export function OperationsPage({ tasksOnly = false }: { tasksOnly?: boolean }) {
  const { state, open, navigate } = useWorkspace(),
    p = state.workspace?.project.id
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null),
    [page, setPage] = useState(0),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [about, setAbout] = useState<z.infer<typeof aboutSchema> | null>(null),
    [shot, setShot] = useState(''),
    [restartId, setRestartId] = useState('')
  useEffect(() => {
    let active = true
    const refresh = async () => {
      if (!p) return
      try {
        const r = operationsSnapshotSchema.parse(
          await operate({ operation: 'snapshot', projectId: p, page }),
        )
        if (active) setSnapshot(r)
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : '读取失败')
      }
    }
    void refresh()
    const id = setInterval(() => void refresh(), 2000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [p, page])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setMessage('')
    try {
      const r = await action()
      setMessage(typeof r === 'string' ? r : '操作完成')
      if (p)
        setSnapshot(
          operationsSnapshotSchema.parse(
            await operate({ operation: 'snapshot', projectId: p, page }),
          ),
        )
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  const restore = async () => {
    const r = await operate({ operation: 'restore' })
    if (r) await open(projectSchema.parse(r).id)
  }
  const shots = state.workspace?.entities.filter((e) => e.kind === 'shot') ?? []
  return (
    <section>
      <h1>{tasksOnly ? '任务中心' : '生产验收与维护'}</h1>
      {!tasksOnly && (
        <>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = projectSchema.parse(
                    await operate({ operation: 'validation.create' }),
                  )
                  await open(r.id)
                })
              }
            >
              创建 3 Shot 验收项目
            </button>
            <button disabled={busy} onClick={() => void run(restore)}>
              Restore Project
            </button>
            <button
              onClick={() =>
                void run(async () =>
                  setAbout(
                    aboutSchema.parse(await operate({ operation: 'about' })),
                  ),
                )
              }
            >
              About / 检查环境
            </button>
          </div>
          {about && (
            <dl>
              {Object.entries(about).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {p && (
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => operate({ operation: 'backup', projectId: p }))
                }
              >
                Backup Project
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    operate({ operation: 'diagnostics.export', projectId: p }),
                  )
                }
              >
                Export Diagnostics
              </button>
              <button onClick={() => navigate('production')}>
                打开生产看板
              </button>
            </div>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {!p && <p>创建或打开项目开始。</p>}
      {p && snapshot && (
        <>
          {!tasksOnly && (
            <>
              <h2>Validation Checklist</h2>
              <ul>
                {snapshot.checklist.map((c) => (
                  <li key={c.label}>
                    {c.done ? '✓' : '○'} {c.label} —{' '}
                    {c.done ? '完成' : 'Not validated / 待完成'}
                  </li>
                ))}
              </ul>
              <h2>Validation Summary</h2>
              <dl className="validation-summary">
                {Object.entries(snapshot.summary).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <h2>ComfyUI 实机检查</h2>
              <p>
                先检查连接与工作流，再在看板生成关键帧、导入参考图并审核；完成后重新检测以记录证据。
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    operate({ operation: 'comfy.test', projectId: p }),
                  )
                }
              >
                Test Connection / Workflow / Results
              </button>
              <h2>Paid Validation Flow</h2>
              <select
                aria-label="验收镜头"
                value={shot}
                onChange={(e) => setShot(e.target.value)}
              >
                <option value="">选择一个已确认关键帧的镜头</option>
                {shots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {shot && <PaidTest key={shot} projectId={p} shotId={shot} />}
              <LazyPanel title="验收报告与恢复证据">
                {snapshot.records.map((r) => (
                  <article key={r.id}>
                    <h3>
                      {r.kind} · {r.result}
                    </h3>
                    <p>{r.testedAt}</p>
                    <pre>{JSON.stringify(r.details, null, 2)}</pre>
                  </article>
                ))}
              </LazyPanel>
            </>
          )}
          <h2>Error Center · 最近问题（最多 50 条）</h2>
          {snapshot.errors.length ? (
            snapshot.errors.map((e) => (
              <article key={e.id}>
                <strong>{e.reason}</strong>
                <p>影响对象：{e.target}</p>
                <p>{e.fix}</p>
                <button onClick={() => navigate('settings')}>打开设置</button>
                <button onClick={() => navigate('production')}>
                  检查镜头 / QC
                </button>
              </article>
            ))
          ) : (
            <p>暂无已记录错误；这不代表真实服务已经通过验收。</p>
          )}
          <h2>Text / Image / Video / QC Tasks</h2>
          <p>
            共 {snapshot.totalTasks} 个任务 · 第 {page + 1} 页
          </p>
          <button disabled={!page} onClick={() => setPage((n) => n - 1)}>
            上一页任务
          </button>
          <button
            disabled={(page + 1) * 50 >= snapshot.totalTasks}
            onClick={() => setPage((n) => n + 1)}
          >
            下一页任务
          </button>
          {snapshot.tasks.map((t) => (
            <article key={t.id}>
              <strong>
                {t.target} · {t.kind}
              </strong>
              <p>
                {t.provider} · {t.status} · {Math.round(t.progress * 100)}% ·{' '}
                {Math.round(t.elapsed)}秒 · 预计费用 {t.cost}
              </p>
              {t.error && <p role="alert">{t.error}</p>}
              {t.remoteId && <p>远程 ID：{t.remoteId}</p>}
              {['failed', 'cancelled'].includes(t.status) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      t.kind === 'qc'
                        ? operate({
                            operation: 'qc.retry',
                            projectId: p,
                            taskId: t.id,
                          })
                        : window
                            .desktop!.workspace.request({
                              action: 'intelligence',
                              command: {
                                operation: 'task.retry',
                                projectId: p,
                                id: t.id,
                              },
                            })
                            .then((r) => {
                              if (!r.ok) throw Error(r.message)
                              return r.data
                            }),
                    )
                  }
                >
                  重试任务
                </button>
              )}
              {['queued', 'running'].includes(t.status) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      t.kind === 'qc'
                        ? operate({
                            operation: 'qc.cancel',
                            projectId: p,
                            taskId: t.id,
                          })
                        : window
                            .desktop!.workspace.request({
                              action: 'intelligence',
                              command: {
                                operation: 'task.cancel',
                                projectId: p,
                                id: t.id,
                              },
                            })
                            .then((r) => {
                              if (!r.ok) throw Error(r.message)
                              return r.data
                            }),
                    )
                  }
                >
                  取消任务
                </button>
              )}
              {t.remoteId &&
                ['comfyui', 'seedance'].includes(t.provider) &&
                ['queued', 'running'].includes(t.status) && (
                  <button onClick={() => setRestartId(t.id)}>
                    验证关闭后恢复
                  </button>
                )}
            </article>
          ))}
          {restartId && (
            <article>
              <p>
                应用将关闭并重新启动，使用已有远程 ID 恢复拉取。请先保存编辑。
              </p>
              <button
                disabled={busy || state.editorStatus !== 'saved'}
                onClick={() =>
                  void run(() =>
                    operate({
                      operation: 'recovery.restart',
                      projectId: p,
                      taskId: restartId,
                      confirmed: true,
                    }),
                  )
                }
              >
                确认关闭并重启
              </button>
              <button onClick={() => setRestartId('')}>返回</button>
            </article>
          )}
        </>
      )}
    </section>
  )
}
