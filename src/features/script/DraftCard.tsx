import { useState } from 'react'
import type { Entity } from '../../shared/domain'
import { draftPayloadSchema } from '../../shared/intelligence'
import type {
  IntelligenceDraft,
  IntelligenceCommand,
  ProductionElement,
  DraftPayload,
} from '../../shared/intelligence'

import { categoryLabels } from './labels'
const shotLabels = {
  shotNumber: '镜号',
  shotType: '镜头类型',
  framing: '构图',
  cameraAngle: '机位角度',
  cameraMovement: '运镜',
  focalLengthSuggestion: '焦段建议',
  subject: '主体',
  action: '动作',
  emotion: '情绪',
  durationSuggestion: '时长建议（秒）',
  continuityNotes: '连续性备注',
}
export function DraftCard({
  draft,
  entities,
  production,
  execute,
  refreshWorkspace,
  locked,
}: {
  locked: boolean
  draft: IntelligenceDraft
  entities: Entity[]
  production: ProductionElement[]
  execute: (command: IntelligenceCommand) => Promise<unknown>
  refreshWorkspace: () => Promise<void>
}) {
  const [payload, setPayload] = useState<DraftPayload>(draft.payload),
    [editing, setEditing] = useState(false),
    [targetId, setTargetId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const name =
    payload.type === 'breakdown'
      ? payload.item.name
      : `镜头 ${payload.item.shotNumber} · ${payload.item.shotType}`
  const candidates =
    payload.type === 'breakdown'
      ? [
          ...entities.filter((e) => e.kind === payload.item.category),
          ...production.filter((e) => e.category === payload.item.category),
        ]
      : []
  const source = entities.find((e) => e.id === draft.sceneId)
  const stale = source?.revision !== draft.sourceRevision
  const act = async (
    operation: 'draft.edit' | 'draft.ignore' | 'draft.confirm',
  ) => {
    setBusy(true)
    setError('')
    try {
      const base = {
        projectId: draft.projectId,
        id: draft.id,
        expectedRevision: draft.revision,
      }
      if (operation === 'draft.edit')
        await execute({
          ...base,
          operation,
          payload: draftPayloadSchema.parse(payload),
        })
      else if (operation === 'draft.ignore')
        await execute({ ...base, operation })
      else {
        const target = candidates.find((e) => e.id === targetId)
        await execute({
          ...base,
          operation,
          targetId: targetId || null,
          targetRevision: target?.revision ?? null,
        })
        await refreshWorkspace()
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '审核操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="draft-card" aria-label={'草稿 ' + name}>
      <div className="section-heading">
        <strong>{name}</strong>
        <small>
          {draft.status === 'pending'
            ? '待审核'
            : draft.status === 'confirmed'
              ? '已确认'
              : '已忽略'}
        </small>
      </div>
      <p>
        来源：{source?.name ?? '已删除场次'} · v{draft.sourceRevision}
      </p>
      {payload.type === 'breakdown' ? (
        <>
          <p>
            {categoryLabels[payload.item.category]} · 置信度{' '}
            {Math.round(payload.item.confidence * 100)}%
          </p>
          <p>{payload.item.description}</p>
          <small>{payload.item.reason}</small>
        </>
      ) : (
        <p>
          {payload.item.framing} / {payload.item.cameraMovement} /{' '}
          {payload.item.durationSuggestion} 秒<br />
          {payload.item.action}
        </p>
      )}
      <small>
        {draft.provider} · {draft.promptVersion}
      </small>
      {stale && draft.status === 'pending' && (
        <p className="error">来源已改变，请重新分析。此草稿不能确认。</p>
      )}
      {draft.status === 'pending' && (
        <>
          {editing && (
            <div className="draft-edit">
              {payload.type === 'breakdown' ? (
                <>
                  <label>
                    元素名称
                    <input
                      value={payload.item.name}
                      maxLength={120}
                      onChange={(e) =>
                        setPayload({
                          ...payload,
                          item: { ...payload.item, name: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    说明
                    <textarea
                      aria-label="说明"
                      value={payload.item.description}
                      onChange={(e) =>
                        setPayload({
                          ...payload,
                          item: {
                            ...payload.item,
                            description: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    置信度
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={payload.item.confidence}
                      onChange={(e) =>
                        setPayload({
                          ...payload,
                          item: {
                            ...payload.item,
                            confidence: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    来源说明
                    <textarea
                      aria-label="来源说明"
                      value={payload.item.reason}
                      onChange={(e) =>
                        setPayload({
                          ...payload,
                          item: { ...payload.item, reason: e.target.value },
                        })
                      }
                    />
                  </label>
                  {payload.item.attributes.map((attribute, index) => (
                    <label key={index}>
                      Bible · {attribute.field}
                      <textarea
                        value={attribute.value}
                        onChange={(e) =>
                          setPayload({
                            ...payload,
                            item: {
                              ...payload.item,
                              attributes: payload.item.attributes.map(
                                (old, i) =>
                                  i === index
                                    ? { ...old, value: e.target.value }
                                    : old,
                              ),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </>
              ) : (
                <>
                  {Object.entries(shotLabels).map(([key, label]) => {
                    const field = key as keyof typeof shotLabels
                    return (
                      <label key={key}>
                        {label}
                        <input
                          type={
                            field === 'shotNumber' ||
                            field === 'durationSuggestion'
                              ? 'number'
                              : 'text'
                          }
                          value={payload.item[field]}
                          onChange={(e) =>
                            setPayload({
                              ...payload,
                              item: {
                                ...payload.item,
                                [field]:
                                  field === 'shotNumber' ||
                                  field === 'durationSuggestion'
                                    ? Number(e.target.value)
                                    : e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    )
                  })}
                  <label>
                    角色引用
                    <select
                      multiple
                      value={payload.item.characterRefs}
                      onChange={(e) =>
                        setPayload({
                          ...payload,
                          item: {
                            ...payload.item,
                            characterRefs: Array.from(
                              e.target.selectedOptions,
                              (option) => option.value,
                            ),
                          },
                        })
                      }
                    >
                      {entities
                        .filter((e) => e.kind === 'character')
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    场景引用
                    <select
                      value={payload.item.locationRef ?? ''}
                      onChange={(e) =>
                        setPayload({
                          ...payload,
                          item: {
                            ...payload.item,
                            locationRef: e.target.value || null,
                          },
                        })
                      }
                    >
                      <option value="">无</option>
                      {entities
                        .filter((e) => e.kind === 'location')
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    道具引用
                    <select
                      multiple
                      value={payload.item.propRefs}
                      onChange={(e) =>
                        setPayload({
                          ...payload,
                          item: {
                            ...payload.item,
                            propRefs: Array.from(
                              e.target.selectedOptions,
                              (option) => option.value,
                            ),
                          },
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
                </>
              )}
              <button disabled={busy} onClick={() => void act('draft.edit')}>
                保存草稿修改
              </button>
            </div>
          )}
          {payload.type === 'breakdown' && (
            <label>
              合并目标
              <select
                aria-label="合并目标"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">
                  创建新{categoryLabels[payload.item.category]}
                </option>
                {candidates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · v{e.revision}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="actions">
            <button
              disabled={busy || editing || stale || locked}
              className="primary"
              onClick={() => void act('draft.confirm')}
            >
              {targetId ? '确认合并' : '确认创建'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (editing) setPayload(draft.payload)
                setEditing(!editing)
              }}
            >
              {editing ? '取消编辑' : '编辑'}
            </button>
            <button disabled={busy} onClick={() => void act('draft.ignore')}>
              忽略
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </article>
  )
}
