import { useState } from 'react'
import { useWorkspace } from '../workspace/state'
import { useProduction } from './use-production'
import { conservativeCapabilities, diagnosticSchema } from '../../shared/video'
import type {
  VideoProfile,
  ProviderDiagnostics,
  ProductionCommand,
} from '../../shared/video'
export function ProductionSettings({ projectId }: { projectId: string }) {
  const { state } = useWorkspace(),
    production = useProduction(projectId)
  const [selected, setSelected] = useState(''),
    [draft, setDraft] = useState<VideoProfile | null>(null),
    [diagnostic, setDiagnostic] = useState<ProviderDiagnostics | null>(null),
    [shotId, setShotId] = useState(''),
    [message, setMessage] = useState('')
  const profiles = production.snapshot?.profiles ?? [],
    profile = draft ?? profiles.find((p) => p.id === selected) ?? profiles[0]
  const run = async (c: ProductionCommand) => {
    setMessage('')
    try {
      const r = await production.execute(c)
      if (typeof r === 'string') setMessage(r)
      return r
    } catch {
      return undefined
    }
  }
  return (
    <section className="production-settings">
      <h2>生产诊断</h2>
      <button
        disabled={production.busy}
        onClick={() =>
          void run({ operation: 'diagnostics', projectId }).then((r) => {
            const d = diagnosticSchema.safeParse(r)
            if (d.success) setDiagnostic(d.data)
          })
        }
      >
        运行 ComfyUI Diagnostics
      </button>
      {diagnostic && (
        <article>
          <strong>
            {diagnostic.ready ? 'Provider Ready' : 'Provider Not Ready'}
          </strong>
          <p>可达：{diagnostic.reachable ? '是' : '否'}</p>
          <p>Checkpoint：{diagnostic.checkpoints.join('、') || '无'}</p>
          <p>槽位：{diagnostic.variables.join('、')}</p>
          {diagnostic.errors.map((e, i) => (
            <p key={i} className="error">
              {e}
            </p>
          ))}
          {diagnostic.warnings.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </article>
      )}
      <label>
        Test Generation 镜头
        <select
          aria-label="Test Generation 镜头"
          value={shotId}
          onChange={(e) => setShotId(e.target.value)}
        >
          <option value="">选择测试镜头</option>
          {state.workspace?.entities
            .filter((e) => e.kind === 'shot')
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </label>
      <button
        disabled={!shotId || production.busy}
        onClick={() =>
          void run({ operation: 'diagnostics.test', projectId, shotId }).then(
            (r) => {
              if (r)
                setMessage(
                  '已提交独立关键帧测试任务，请在生成页查看；结果仍需审核',
                )
            },
          )
        }
      >
        一键 Test Generation
      </button>
      <h2>视频 Provider Profiles</h2>
      <label>
        选择 Profile
        <select
          value={profile?.id ?? ''}
          onChange={(e) => {
            setSelected(e.target.value)
            setDraft(null)
          }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {draft && !profiles.some((p) => p.id === draft.id) && (
            <option value={draft.id}>{draft.name}</option>
          )}
        </select>
      </label>
      <button
        onClick={() =>
          setDraft({
            id: crypto.randomUUID(),
            name: 'Seedance Official',
            provider: 'seedance',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            taskPath: '/contents/generations/tasks',
            model: '',
            credentialRef: null,
            timeoutSeconds: 3600,
            pollingIntervalMs: 5000,
            capabilities: conservativeCapabilities,
          })
        }
      >
        新增 Seedance / Compatible Profile
      </button>
      {profile && (
        <ProfileForm
          key={profile.id}
          profile={profile}
          configured={production.snapshot?.credentials[profile.id] ?? false}
          busy={production.busy}
          save={async (value) => {
            const result = await run({
              operation: 'profile.save',
              projectId,
              profile: {
                ...value,
                credentialRef:
                  profiles.find((p) => p.id === value.id)?.credentialRef ??
                  null,
              },
            })
            if (result !== undefined) {
              setSelected(value.id)
              setDraft(null)
            }
          }}
          health={() =>
            void run({
              operation: 'profile.health',
              projectId,
              profileId: profile.id,
            })
          }
          credential={() =>
            void run({
              operation: 'credential.import',
              projectId,
              profileId: profile.id,
            })
          }
        />
      )}
      {(production.error || message) && (
        <p role="status" className={production.error ? 'error' : ''}>
          {production.error || message}
        </p>
      )}
    </section>
  )
}
function ProfileForm({
  profile,
  configured,
  busy,
  save,
  health,
  credential,
}: {
  profile: VideoProfile
  configured: boolean
  busy: boolean
  save: (p: VideoProfile) => Promise<void>
  health: () => void
  credential: () => void
}) {
  const [value, setValue] = useState(profile)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save(value)
      }}
    >
      <label>
        Profile 名称
        <input
          required
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
        />
      </label>
      <label>
        视频服务类型
        <select
          value={value.provider}
          onChange={(e) =>
            setValue({
              ...value,
              provider: e.target.value as VideoProfile['provider'],
            })
          }
        >
          <option value="mock-video">Mock Video</option>
          <option value="seedance">Seedance / Ark-compatible</option>
        </select>
      </label>
      {value.provider === 'seedance' && (
        <>
          <label>
            视频 Base URL
            <input
              required
              value={value.baseUrl}
              onChange={(e) => setValue({ ...value, baseUrl: e.target.value })}
            />
          </label>
          <label>
            任务 endpoint 路径
            <input
              required
              value={value.taskPath}
              onChange={(e) => setValue({ ...value, taskPath: e.target.value })}
            />
          </label>
          <label>
            Model
            <input
              required
              value={value.model}
              onChange={(e) => setValue({ ...value, model: e.target.value })}
            />
          </label>
          <p>
            凭据：{configured ? '已安全配置' : '未配置'}。保存 Profile
            后，选择只包含 API Key
            的本地文本；主进程加密读取，页面不会接收密钥。原始文件由你自行保管。
          </p>
          <button type="button" disabled={busy} onClick={credential}>
            从文件安全导入凭据
          </button>
        </>
      )}
      <label>
        等待超时（秒）
        <input
          type="number"
          min={30}
          max={86400}
          value={value.timeoutSeconds}
          onChange={(e) =>
            setValue({ ...value, timeoutSeconds: Number(e.target.value) })
          }
        />
      </label>
      <label>
        轮询间隔（毫秒）
        <input
          type="number"
          min={100}
          max={60000}
          value={value.pollingIntervalMs}
          onChange={(e) =>
            setValue({ ...value, pollingIntervalMs: Number(e.target.value) })
          }
        />
      </label>
      <details>
        <summary>能力配置（仅填写服务真实支持的能力）</summary>
        <label>
          支持时长（逗号分隔，秒）
          <input
            defaultValue={value.capabilities.durations.join(',')}
            onChange={(e) =>
              setValue({
                ...value,
                capabilities: {
                  ...value.capabilities,
                  durations: e.target.value.split(',').map(Number),
                },
              })
            }
          />
        </label>
        {(['endFrame', 'cancel', 'seed'] as const).map((key) => (
          <label className="check-label" key={key}>
            <input
              type="checkbox"
              checked={value.capabilities[key]}
              onChange={(e) =>
                setValue({
                  ...value,
                  capabilities: {
                    ...value.capabilities,
                    [key]: e.target.checked,
                  },
                })
              }
            />
            {key}
          </label>
        ))}
        <label>
          分辨率
          <select
            multiple
            value={value.capabilities.resolutions}
            onChange={(e) =>
              setValue({
                ...value,
                capabilities: {
                  ...value.capabilities,
                  resolutions: Array.from(
                    e.target.selectedOptions,
                    (o) => o.value as '480p' | '720p' | '1080p',
                  ),
                },
              })
            }
          >
            {['480p', '720p', '1080p'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <p>
          本适配器支持首帧及可选尾帧；不混用 reference_image
          模式。不同协议需要独立适配器。
        </p>
      </details>
      <div className="actions">
        <button disabled={busy}>保存视频 Profile</button>
        <button type="button" disabled={busy} onClick={health}>
          测试视频 Provider
        </button>
      </div>
    </form>
  )
}
