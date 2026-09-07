import { useCallback, useEffect, useRef, useState } from 'react'
import type { Entity, Scene } from '../../shared/domain'
import { sceneSchema } from '../../shared/domain'
import type { SceneContent } from '../../shared/intelligence'
import { sceneContentSchema } from '../../shared/intelligence'
import { intelligenceService } from '../../services/intelligence'
import { workspaceService } from '../../services/workspace'
import { useWorkspace } from '../workspace/state'

export function SceneEditor({
  scene,
  entities,
}: {
  scene: Scene
  entities: Entity[]
}) {
  const { setEditorStatus, acceptEntity } = useWorkspace()
  const [history, setHistory] = useState<{
    past: SceneContent[]
    present: SceneContent
    future: SceneContent[]
  }>({ past: [], present: scene.content, future: [] })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldEpoch, setFieldEpoch] = useState(0)
  const contentRef = useRef(scene.content),
    saved = useRef(JSON.stringify(scene.content)),
    revision = useRef(scene.revision)
  const busy = useRef(false),
    failed = useRef(false),
    changedAt = useRef(0),
    alive = useRef(true)
  const accept = useRef(acceptEntity)
  useEffect(() => {
    accept.current = acceptEntity
  }, [acceptEntity])
  const persist = useCallback(async () => {
    if (busy.current || JSON.stringify(contentRef.current) === saved.current)
      return
    const input = sceneContentSchema.safeParse(contentRef.current)
    if (!input.success) {
      failed.current = true
      setError('请检查场次字段长度和对白内容')
      setEditorStatus('error')
      return
    }
    busy.current = true
    failed.current = false
    setSaving(true)
    setError('')
    setEditorStatus('saving')
    const snapshot = JSON.stringify(input.data)
    try {
      const updated = sceneSchema.parse(
        await intelligenceService.command({
          operation: 'scene.save',
          projectId: scene.projectId,
          id: scene.id,
          expectedRevision: revision.current,
          content: input.data,
        }),
      )
      revision.current = updated.revision
      saved.current = snapshot
      if (alive.current) {
        accept.current(updated)
        setEditorStatus(
          JSON.stringify(contentRef.current) === snapshot ? 'saved' : 'dirty',
        )
      }
    } catch (error) {
      failed.current = true
      if (alive.current) {
        setError(
          error instanceof Error ? error.message : '保存失败，本地修改已保留',
        )
        setEditorStatus('error')
      }
    } finally {
      busy.current = false
      if (alive.current) setSaving(false)
    }
  }, [scene.id, scene.projectId, setEditorStatus])
  useEffect(() => {
    alive.current = true
    const timer = setInterval(() => {
      if (!failed.current && Date.now() - changedAt.current >= 650)
        void persist()
    }, 300)
    return () => {
      alive.current = false
      clearInterval(timer)
    }
  }, [persist])
  const change = (next: SceneContent) => {
    contentRef.current = next
    changedAt.current = Date.now()
    setHistory((old) => ({
      past: [...old.past.slice(-99), old.present],
      present: next,
      future: [],
    }))
    setEditorStatus(
      busy.current
        ? 'saving'
        : JSON.stringify(next) === saved.current
          ? 'saved'
          : 'dirty',
    )
  }
  const moveHistory = (direction: 'undo' | 'redo') => {
    const next = direction === 'undo' ? history.past.at(-1) : history.future[0]
    if (!next) return
    contentRef.current = next
    changedAt.current = Date.now()
    setHistory(
      direction === 'undo'
        ? {
            past: history.past.slice(0, -1),
            present: next,
            future: [history.present, ...history.future],
          }
        : {
            past: [...history.past, history.present],
            present: next,
            future: history.future.slice(1),
          },
    )
    setFieldEpoch((n) => n + 1)
    setEditorStatus(JSON.stringify(next) === saved.current ? 'saved' : 'dirty')
  }
  const discard = async () => {
    if (!window.confirm('放弃本地修改，并重新载入已保存场次？')) return
    try {
      const next = (
        await workspaceService.readWorkspace(scene.projectId)
      ).entities.find((e) => e.id === scene.id)
      if (next?.kind !== 'scene') throw new Error('场次已被删除')
      contentRef.current = next.content
      saved.current = JSON.stringify(next.content)
      revision.current = next.revision
      failed.current = false
      setHistory({ past: [], present: next.content, future: [] })
      setFieldEpoch((n) => n + 1)
      setError('')
      setEditorStatus('saved')
      accept.current(next)
    } catch (error) {
      setError(error instanceof Error ? error.message : '重新载入失败')
    }
  }
  const value = history.present
  return (
    <section
      className="scene-editor"
      aria-label="场次编辑器"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'z'
        ) {
          event.preventDefault()
          moveHistory(event.shiftKey ? 'redo' : 'undo')
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'y'
        ) {
          event.preventDefault()
          moveHistory('redo')
        }
      }}
    >
      <div className="section-heading">
        <h2>场次编辑</h2>
        <div className="actions">
          <button
            disabled={!history.past.length}
            onClick={() => moveHistory('undo')}
          >
            撤销
          </button>
          <button
            disabled={!history.future.length}
            onClick={() => moveHistory('redo')}
          >
            重做
          </button>
          <button disabled={saving} onClick={() => void persist()}>
            {saving ? '保存中…' : '立即保存'}
          </button>
        </div>
      </div>
      <p className="muted">
        修改后自动保存。Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做。
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
          <button disabled={saving} onClick={() => void discard()}>
            放弃本地修改并重新载入
          </button>
        </div>
      )}
      <div className="field-grid">
        <label>
          场次编号
          <input
            value={value.sceneNumber}
            maxLength={40}
            onChange={(e) => change({ ...value, sceneNumber: e.target.value })}
          />
        </label>
        <label>
          内景 / 外景
          <select
            value={value.interiorExterior}
            onChange={(e) =>
              change({
                ...value,
                interiorExterior: e.target
                  .value as SceneContent['interiorExterior'],
              })
            }
          >
            <option value="UNKNOWN">未指定</option>
            <option value="INT">内景</option>
            <option value="EXT">外景</option>
            <option value="INT/EXT">内外景</option>
          </select>
        </label>
      </div>
      <label>
        场景标题
        <input
          value={value.heading}
          maxLength={300}
          onChange={(e) => change({ ...value, heading: e.target.value })}
        />
      </label>
      <div className="field-grid">
        <label>
          地点
          <input
            value={value.location}
            maxLength={2000}
            onChange={(e) => change({ ...value, location: e.target.value })}
          />
        </label>
        <label>
          日 / 夜 / 时间
          <input
            value={value.timeOfDay}
            maxLength={80}
            onChange={(e) => change({ ...value, timeOfDay: e.target.value })}
          />
        </label>
      </div>
      <label>
        出场角色（逗号分隔）
        <input
          key={fieldEpoch}
          defaultValue={value.characters.join('、')}
          onChange={(e) =>
            change({
              ...value,
              characters: e.target.value
                .split(/[、,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label>
        动作
        <textarea
          aria-label="动作"
          value={value.action}
          maxLength={100000}
          onChange={(e) => change({ ...value, action: e.target.value })}
        />
      </label>
      <div className="section-heading">
        <h3>对白</h3>
        <button
          onClick={() =>
            change({
              ...value,
              dialogue: [
                ...value.dialogue,
                {
                  characterId: null,
                  characterName: '',
                  parenthetical: '',
                  text: '',
                },
              ],
            })
          }
        >
          添加对白
        </button>
      </div>
      {value.dialogue.map((line, index) => (
        <fieldset className="dialogue-line" key={index}>
          <legend>对白 {index + 1}</legend>
          <label>
            关联角色
            <select
              value={line.characterId ?? ''}
              onChange={(e) => {
                const character = entities.find(
                  (item) => item.id === e.target.value,
                )
                change({
                  ...value,
                  dialogue: value.dialogue.map((old, i) =>
                    i === index
                      ? {
                          ...old,
                          characterId: e.target.value || null,
                          characterName: character?.name ?? old.characterName,
                        }
                      : old,
                  ),
                })
              }}
            >
              <option value="">临时角色名</option>
              {entities
                .filter((e) => e.kind === 'character')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          {(['characterName', 'parenthetical', 'text'] as const).map(
            (field) => (
              <label key={field}>
                {
                  {
                    characterName: '角色名',
                    parenthetical: '语气 / 括注',
                    text: '对白内容',
                  }[field]
                }
                <textarea
                  rows={field === 'text' ? 3 : 1}
                  value={line[field]}
                  onChange={(e) =>
                    change({
                      ...value,
                      dialogue: value.dialogue.map((old, i) =>
                        i === index ? { ...old, [field]: e.target.value } : old,
                      ),
                    })
                  }
                />
              </label>
            ),
          )}
          <button
            className="danger"
            onClick={() =>
              change({
                ...value,
                dialogue: value.dialogue.filter((_, i) => i !== index),
              })
            }
          >
            删除此对白
          </button>
        </fieldset>
      ))}
      {(['narration', 'notes'] as const).map((field) => (
        <label key={field}>
          {field === 'narration' ? '旁白' : '备注'}
          <textarea
            aria-label={field === 'narration' ? '旁白' : '备注'}
            value={value[field]}
            maxLength={100000}
            onChange={(e) => change({ ...value, [field]: e.target.value })}
          />
        </label>
      ))}
    </section>
  )
}
