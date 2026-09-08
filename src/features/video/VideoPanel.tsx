import { useState } from 'react'
import type { Shot, Entity } from '../../shared/domain'
import { videoPromptSchema } from '../../shared/video'
import type { VideoPromptPackage, ShotDirection } from '../../shared/video'
import { aiTaskSchema } from '../../shared/intelligence'
import { useWorkspace } from '../workspace/state'
import { useVisual } from '../visual/use-visual'
import { useProduction } from './use-production'
import { useIntelligence } from '../script/use-intelligence'
import { AssetReview } from '../visual/AssetReview'
import { AssetImage } from '../visual/AssetImage'
import { TaskList } from '../script/TaskList'
export function VideoPanel({
  shot,
  entities,
}: {
  shot: Shot
  entities: Entity[]
}) {
  const { state, reload, setEditorStatus } = useWorkspace(),
    production = useProduction(shot.projectId),
    visual = useVisual(shot.projectId),
    ai = useIntelligence(shot.projectId)
  const [profileId, setProfileId] = useState(''),
    [duration, setDuration] = useState(5),
    [resolution, setResolution] = useState('720p'),
    [seed, setSeed] = useState(42),
    [endFrame, setEndFrame] = useState(''),
    [prompt, setPrompt] = useState<VideoPromptPackage | null>(null),
    [action, setAction] = useState(''),
    [accepted, setAccepted] = useState(false),
    [assetId, setAssetId] = useState(''),
    [direction, setDirection] = useState(shot.direction),
    [seconds, setSeconds] = useState(
      Math.min(60, Math.round(shot.durationSeconds)),
    ),
    [dirty, setDirty] = useState(false)
  const profile =
      production.snapshot?.profiles.find((p) => p.id === profileId) ??
      production.snapshot?.profiles[0],
    versions = visual.snapshot?.versions ?? [],
    generated = versions.filter(
      (v) => v.mimeType === 'video/mp4' && v.metadata.targetId === shot.id,
    ),
    chosen = entities.find(
      (e) =>
        e.kind === 'asset' && e.id === (assetId || generated.at(-1)?.assetId),
    )
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch {
      /* errors are shown by hooks */
    }
  }
  const params = {
    projectId: shot.projectId,
    shotId: shot.id,
    profileId: profile?.id ?? '',
    assetId: chosen?.id ?? null,
    duration: profile?.capabilities.durations.includes(duration)
      ? duration
      : (profile?.capabilities.durations[0] ?? 5),
    resolution: (profile?.capabilities.resolutions.includes(
      resolution as '720p',
    )
      ? resolution
      : (profile?.capabilities.resolutions[0] ?? '720p')) as
      '480p' | '720p' | '1080p',
    seed,
    endFrameVersionId:
      profile?.capabilities.endFrame && endFrame ? endFrame : null,
    actionOverride: prompt ? action : null,
    costAccepted: accepted,
  }
  const labels: Record<keyof ShotDirection, string> = {
    startState: '开始状态',
    action: '动作过程',
    endState: '结束状态',
    subjectMovement: '主体运动',
    cameraMovement: '摄影机运动',
    performance: '表演',
    environmentMotion: '环境动态',
    speed: '速度',
    continuityNotes: '连续性备注',
  }
  return (
    <section className="video-panel" aria-label={'视频生产 ' + shot.name}>
      <h4>视频生产</h4>
      {shot.confirmedVideoAssetVersionId && (
        <>
          <p>已确认视频（固定版本）</p>
          <AssetImage
            projectId={shot.projectId}
            versionId={shot.confirmedVideoAssetVersionId}
            thumbnail={false}
            alt="已确认视频"
          />
        </>
      )}
      <details>
        <summary>导演动作信息</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setEditorStatus('saving')
            void run(async () => {
              try {
                await production.execute({
                  operation: 'direction.save',
                  projectId: shot.projectId,
                  shotId: shot.id,
                  expectedRevision: shot.revision,
                  direction,
                  duration: seconds,
                })
                setEditorStatus('saved')
                setDirty(false)
                await reload()
              } catch {
                setEditorStatus('error')
              }
            })
          }}
        >
          {Object.entries(direction).map(([k, value]) => (
            <label key={k}>
              {labels[k as keyof ShotDirection]}
              {k === 'speed' ? (
                <select
                  value={value}
                  onChange={(e) => {
                    setDirection({
                      ...direction,
                      speed: e.target.value as ShotDirection['speed'],
                    })
                    setDirty(true)
                    setEditorStatus('dirty')
                  }}
                >
                  {['slow', 'normal', 'fast'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <textarea
                  aria-label={labels[k as keyof ShotDirection]}
                  value={value}
                  onChange={(e) => {
                    setDirection({ ...direction, [k]: e.target.value })
                    setDirty(true)
                    setEditorStatus('dirty')
                  }}
                />
              )}
            </label>
          ))}
          <label>
            镜头时长
            <input
              type="number"
              min={1}
              max={60}
              value={seconds}
              onChange={(e) => {
                setSeconds(Number(e.target.value))
                setDirty(true)
                setEditorStatus('dirty')
              }}
            />
          </label>
          <button disabled={!dirty || production.busy}>保存导演信息</button>
          <button
            type="button"
            onClick={() => {
              setDirection(shot.direction)
              setSeconds(Math.min(60, Math.round(shot.durationSeconds)))
              setDirty(false)
              setEditorStatus('saved')
            }}
          >
            取消修改
          </button>
        </form>
      </details>
      {!shot.approvedKeyframeVersionId && (
        <p className="empty">请先在视觉生产中批准关键帧，再生成视频。</p>
      )}
      <p>更换关键帧：在上方视觉生产中选择图片版本并明确绑定此 Shot。</p>
      <label>
        视频 Provider Profile
        <select
          aria-label="视频 Provider Profile"
          value={profile?.id ?? ''}
          onChange={(e) => {
            setProfileId(e.target.value)
            setPrompt(null)
            setAccepted(false)
          }}
        >
          {production.snapshot?.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="asset-filters">
        <label>
          视频时长
          <select
            aria-label="视频时长"
            value={params.duration}
            onChange={(e) => {
              setDuration(Number(e.target.value))
              setPrompt(null)
            }}
          >
            {profile?.capabilities.durations.map((d) => (
              <option key={d} value={d}>
                {d} 秒
              </option>
            ))}
          </select>
        </label>
        <label>
          视频分辨率
          <select
            value={params.resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            {profile?.capabilities.resolutions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        {profile?.capabilities.seed && (
          <label>
            视频 Seed
            <input
              type="number"
              min={0}
              max={2147483647}
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
        )}
      </div>
      {profile?.capabilities.endFrame && (
        <label>
          可选尾帧
          <select
            value={endFrame}
            onChange={(e) => {
              setEndFrame(e.target.value)
              setPrompt(null)
            }}
          >
            <option value="">无</option>
            {versions
              .filter(
                (v) => v.mimeType !== 'video/mp4' && v.status === 'approved',
              )
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {entities.find((e) => e.id === v.assetId)?.name} v
                  {v.versionNumber}
                </option>
              ))}
          </select>
        </label>
      )}
      {profile?.provider === 'seedance' && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          确认向所选 Provider 提交，可能产生费用；价格未知不表示免费。
        </label>
      )}
      <div className="actions">
        <button
          disabled={
            !profile ||
            !shot.approvedKeyframeVersionId ||
            dirty ||
            production.busy
          }
          onClick={() =>
            void run(async () => {
              const p = videoPromptSchema.parse(
                await production.execute({
                  ...params,
                  operation: 'video.compile',
                }),
              )
              setPrompt(p)
              setAction(p.action)
            })
          }
        >
          编译视频 Prompt
        </button>
        <button
          className="primary"
          disabled={
            !profile ||
            !shot.approvedKeyframeVersionId ||
            dirty ||
            state.editorStatus !== 'saved' ||
            production.busy ||
            (profile.provider === 'seedance' && !accepted)
          }
          onClick={() =>
            void run(async () => {
              const t = aiTaskSchema.parse(
                await production.execute({
                  ...params,
                  operation: 'video.generate',
                }),
              )
              if ('assetId' in t.input) setAssetId(t.input.assetId)
              await reload()
              await ai.refresh()
            })
          }
        >
          生成视频
        </button>
      </div>
      {prompt && (
        <>
          <label>
            视频动作 Prompt
            <textarea
              aria-label="视频动作 Prompt"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </label>
          <details>
            <summary>视频 Prompt 结构</summary>
            <pre>{JSON.stringify(prompt, null, 2)}</pre>
          </details>
        </>
      )}
      {(production.error || visual.error) && (
        <p role="alert" className="error">
          {production.error || visual.error}
        </p>
      )}
      <TaskList
        tasks={ai.snapshot.tasks.filter(
          (t) => t.input.type === 'shot-video' && t.input.targetId === shot.id,
        )}
        execute={ai.execute}
      />
      {chosen?.kind === 'asset' && (
        <AssetReview
          asset={chosen}
          versions={versions}
          entities={entities}
          execute={visual.execute}
          onChanged={reload}
          targetId={shot.id}
          onRegenerate={(v) => {
            const p = videoPromptSchema.safeParse(v.metadata.videoPrompt)
            if (p.success) {
              setPrompt(p.data)
              setAction(p.data.action)
              setDuration(p.data.duration)
              setAssetId(v.assetId)
              setAccepted(false)
            }
          }}
        />
      )}
    </section>
  )
}
