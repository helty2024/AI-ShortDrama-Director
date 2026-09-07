import { useState } from 'react'
import type { Character, Location, Prop, Entity } from '../../shared/domain'
import { useWorkspace } from '../workspace/state'
import { intelligenceService } from '../../services/intelligence'

const labels: Record<string, string> = {
  aliases: '别名（逗号分隔）',
  age: '年龄',
  gender: '性别',
  height: '身高',
  build: '体型',
  facialFeatures: '面部特征',
  hairstyle: '发型',
  skinTone: '肤色',
  personality: '性格',
  costume: '服装',
  accessories: '配饰',
  makeup: '妆容',
  behavioralHabits: '行为习惯',
  expressionHabits: '表情习惯',
  voiceDescription: '声音描述',
  continuityNotes: '连续性备注',
  visualPrompt: '视觉提示词',
  negativePrompt: '负面提示词',
  type: '类型',
  interiorExterior: '内景 / 外景',
  geography: '地理 / 空间描述',
  architecture: '建筑与材质',
  colors: '色彩',
  lighting: '光线',
  timeState: '时间状态',
  weather: '天气',
  fixedAreas: '固定区域',
  appearance: '外观',
  material: '材质',
  size: '尺寸',
  condition: '状态',
  usedByCharacterIds: '使用角色',
  sceneIds: '出现场次',
}
export function BibleEditor({
  entity,
  entities,
}: {
  entity: Character | Location | Prop
  entities: Entity[]
}) {
  const { state, setEditorStatus, setEditorOwner, reload } = useWorkspace()
  const [editing, setEditing] = useState(false),
    [bible, setBible] = useState(entity.bible),
    [name, setName] = useState(entity.name),
    [description, setDescription] = useState(entity.description),
    [assetIds, setAssetIds] = useState(entity.assetIds),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const changed = () => setEditorStatus('dirty')
  const save = async () => {
    setBusy(true)
    setEditorStatus('saving')
    setError('')
    try {
      await intelligenceService.command({
        operation: 'bible.save',
        projectId: entity.projectId,
        id: entity.id,
        expectedRevision: entity.revision,
        name,
        description,
        assetIds,
        bible,
      })
      setEditorStatus('saved')
      await reload()
      setEditing(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败')
      setEditorStatus('error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="bible-editor">
      {!editing ? (
        <>
          <details>
            <summary>Bible 详情</summary>
            {Object.entries(entity.bible).map(([key, value]) => (
              <p key={key}>
                <strong>{labels[key] ?? key}：</strong>
                {Array.isArray(value)
                  ? value
                      .map((v) => entities.find((e) => e.id === v)?.name ?? v)
                      .join('、') || '未填写'
                  : value || '未填写'}
              </p>
            ))}
          </details>
          <button
            onClick={() => {
              if (state.editorStatus === 'saved' && !state.editorOwner) {
                setEditorOwner(entity.id)
                setEditing(true)
              } else setError('请先保存或取消其他 Bible 编辑')
            }}
          >
            编辑 Bible
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <h4>编辑 {entity.name} Bible</h4>
          <label>
            名称
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                changed()
              }}
            />
          </label>
          <label>
            简介
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                changed()
              }}
            />
          </label>
          <div className="bible-fields">
            {Object.entries(bible).map(([key, value]) => (
              <label key={key}>
                {labels[key] ?? key}
                {Array.isArray(value) ? (
                  key === 'aliases' ? (
                    <input
                      defaultValue={value.join('、')}
                      onChange={(e) => {
                        setBible({
                          ...bible,
                          aliases: e.target.value
                            .split(/[、,，]/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                        changed()
                      }}
                    />
                  ) : (
                    <select
                      multiple
                      value={value}
                      onChange={(e) => {
                        setBible({
                          ...bible,
                          [key]: Array.from(
                            e.target.selectedOptions,
                            (option) => option.value,
                          ),
                        })
                        changed()
                      }}
                    >
                      {entities
                        .filter(
                          (e) =>
                            e.kind ===
                            (key === 'sceneIds' ? 'scene' : 'character'),
                        )
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  )
                ) : (
                  <textarea
                    aria-label={labels[key] ?? key}
                    value={value}
                    onChange={(e) => {
                      setBible({ ...bible, [key]: e.target.value })
                      changed()
                    }}
                  />
                )}
              </label>
            ))}
          </div>
          <label>
            参考素材
            <select
              multiple
              value={assetIds}
              onChange={(e) => {
                setAssetIds(
                  Array.from(
                    e.target.selectedOptions,
                    (option) => option.value,
                  ),
                )
                changed()
              }}
            >
              {entities
                .filter((e) => e.kind === 'asset')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="actions">
            <button className="primary" disabled={busy}>
              保存 Bible
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm('放弃本次 Bible 修改？')) {
                  setBible(entity.bible)
                  setName(entity.name)
                  setDescription(entity.description)
                  setAssetIds(entity.assetIds)
                  setEditorStatus('saved')
                  setEditorOwner(null)
                  setEditing(false)
                  setError('')
                }
              }}
            >
              取消编辑
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
