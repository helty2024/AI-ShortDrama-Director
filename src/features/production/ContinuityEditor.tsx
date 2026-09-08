import { useState } from 'react'
import type {
  ContinuityContext,
  ContinuityState,
  PilotSnapshot,
  PilotCommand,
} from '../../shared/production'
import type { Entity, Shot } from '../../shared/domain'
import { useWorkspace } from '../workspace/state'
export function ContinuityEditor({
  shot,
  context,
  snapshot,
  entities,
  execute,
}: {
  shot: Shot
  context: ContinuityContext
  snapshot: PilotSnapshot
  entities: Entity[]
  execute: (c: PilotCommand) => Promise<unknown>
}) {
  const { setEditorStatus } = useWorkspace(),
    [state, setState] = useState<ContinuityState>(context.state),
    [scope, setScope] = useState<'shot' | 'scene'>('shot'),
    [source, setSource] = useState<'manual' | 'plot'>('manual'),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [revisions, setRevisions] = useState(
      Object.fromEntries(
        snapshot.continuity.map((s) => [s.targetId, s.revision]),
      ),
    )
  const targetId = scope === 'shot' ? shot.id : shot.sceneId,
    revision = revisions[targetId] ?? 0
  const change = (next: ContinuityState) => {
    setState(next)
    setEditorStatus('dirty')
  }
  const name = (id: string) => entities.find((e) => e.id === id)?.name ?? id
  const texts = {
    costume: '服装',
    hairstyle: '发型',
    makeup: '妆容',
    physicalState: '身体状态',
    emotionalState: '情绪',
    position: '位置 / 情境',
    notes: '备注',
    state: '道具状态',
    location: '道具位置',
    timeOfDay: '时间',
    lighting: '光照',
    weather: '天气',
    environmentState: '环境状态',
    damage: '损伤状态',
  }
  return (
    <form
      aria-label="连续性编辑"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setEditorStatus('saving')
        void execute({
          operation: 'continuity.save',
          projectId: shot.projectId,
          targetId,
          expectedRevision: revision,
          source,
          state,
        })
          .then(() => {
            setRevisions({ ...revisions, [targetId]: revision + 1 })
            setMessage('连续性已保存，后续镜头将继承')
            setEditorStatus('saved')
          })
          .catch(() => setEditorStatus('error'))
          .finally(() => setBusy(false))
      }}
    >
      <p>继承上一镜头；当前剧情状态覆盖 Bible 的可变状态，基础身份保留。</p>
      <label>
        保存范围
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'shot' | 'scene')}
        >
          <option value="shot">当前 Shot</option>
          <option value="scene">当前 Scene 初始快照</option>
        </select>
      </label>
      <label>
        修改来源
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as 'manual' | 'plot')}
        >
          <option value="manual">人工编辑</option>
          <option value="plot">剧情动作更新</option>
        </select>
      </label>
      {state.characters.map((c, index) => (
        <fieldset key={c.characterId}>
          <legend>{name(c.characterId)}</legend>
          {(
            [
              'costume',
              'hairstyle',
              'makeup',
              'physicalState',
              'emotionalState',
              'position',
              'notes',
            ] as const
          ).map((k) => (
            <label key={k}>
              {texts[k]}
              <input
                value={c[k]}
                onChange={(e) =>
                  change({
                    ...state,
                    characters: state.characters.map((v, i) =>
                      i === index ? { ...v, [k]: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
          ))}
          <label>
            伤势（逗号分隔）
            <input
              value={c.injuries.join(',')}
              onChange={(e) =>
                change({
                  ...state,
                  characters: state.characters.map((v, i) =>
                    i === index
                      ? {
                          ...v,
                          injuries: e.target.value.split(',').filter(Boolean),
                        }
                      : v,
                  ),
                })
              }
            />
          </label>
          <label>
            携带道具
            <select
              multiple
              value={c.carriedProps}
              onChange={(e) =>
                change({
                  ...state,
                  characters: state.characters.map((v, i) =>
                    i === index
                      ? {
                          ...v,
                          carriedProps: Array.from(
                            e.target.selectedOptions,
                            (o) => o.value,
                          ),
                        }
                      : v,
                  ),
                })
              }
            >
              {entities
                .filter((e) => e.kind === 'prop')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
        </fieldset>
      ))}
      {state.props.map((p, index) => (
        <fieldset key={p.propId}>
          <legend>{name(p.propId)}</legend>
          {(['state', 'location', 'notes'] as const).map((k) => (
            <label key={k}>
              {texts[k]}
              <input
                value={p[k]}
                onChange={(e) =>
                  change({
                    ...state,
                    props: state.props.map((v, i) =>
                      i === index ? { ...v, [k]: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
          ))}
          <label>
            持有角色
            <select
              value={p.holderCharacterId ?? ''}
              onChange={(e) =>
                change({
                  ...state,
                  props: state.props.map((v, i) =>
                    i === index
                      ? { ...v, holderCharacterId: e.target.value || null }
                      : v,
                  ),
                })
              }
            >
              <option value="">无</option>
              {entities
                .filter((e) => e.kind === 'character')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={p.visible}
              onChange={(e) =>
                change({
                  ...state,
                  props: state.props.map((v, i) =>
                    i === index ? { ...v, visible: e.target.checked } : v,
                  ),
                })
              }
            />
            可见
          </label>
        </fieldset>
      ))}
      {state.locations.map((l, index) => (
        <fieldset key={l.locationId}>
          <legend>{name(l.locationId)}</legend>
          {(
            [
              'timeOfDay',
              'lighting',
              'weather',
              'environmentState',
              'damage',
              'notes',
            ] as const
          ).map((k) => (
            <label key={k}>
              {texts[k]}
              <input
                value={l[k]}
                onChange={(e) =>
                  change({
                    ...state,
                    locations: state.locations.map((v, i) =>
                      i === index ? { ...v, [k]: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
          ))}
        </fieldset>
      ))}
      <button disabled={busy}>保存连续性</button>
      <button
        type="button"
        onClick={() => {
          setState(context.state)
          setEditorStatus('saved')
        }}
      >
        放弃连续性修改
      </button>
      {message && <p>{message}</p>}
    </form>
  )
}
