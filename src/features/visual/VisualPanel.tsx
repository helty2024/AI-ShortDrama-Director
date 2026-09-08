import { aiTaskSchema } from '../../shared/intelligence'
import { useState } from 'react'
import type {
  Character,
  Location,
  Prop,
  Shot,
  Entity,
} from '../../shared/domain'
import { promptPackageSchema } from '../../shared/visual'
import type { ImagePromptPackage, VisualReference } from '../../shared/visual'
import { useWorkspace } from '../workspace/state'
import { useVisual } from './use-visual'
import { useIntelligence } from '../script/use-intelligence'
import { TaskList } from '../script/TaskList'
import { AssetReview } from './AssetReview'
import { AssetImage } from './AssetImage'
export function VisualPanel({
  entity,
  entities,
  assetOverride,
}: {
  entity: Character | Location | Prop | Shot
  entities: Entity[]
  assetOverride?: string
}) {
  const { state, reload } = useWorkspace(),
    visual = useVisual(entity.projectId),
    ai = useIntelligence(entity.projectId)
  const [prompt, setPrompt] = useState<ImagePromptPackage | null>(null),
    [positive, setPositive] = useState(''),
    [negative, setNegative] = useState(''),
    [provider, setProvider] = useState<'mock-image' | 'comfyui' | ''>(''),
    [previous, setPrevious] = useState(false),
    [error, setError] = useState(''),
    [existing, setExisting] = useState(''),
    [role, setRole] = useState<VisualReference['role']>(
      entity.kind === 'character' ? 'faceReference' : 'masterReference',
    ),
    [selected, setSelected] = useState(assetOverride ?? 'auto')
  const snapshot = visual.snapshot,
    versions = snapshot?.versions ?? []
  const generated = versions.filter(
    (v) => v.mimeType !== 'video/mp4' && v.metadata.targetId === entity.id,
  )
  const assetId =
    assetOverride ||
    (selected === 'auto' ? (generated.at(-1)?.assetId ?? '') : selected)
  const asset = entities.find((e) => e.kind === 'asset' && e.id === assetId)
  const disabled = visual.busy || state.editorStatus !== 'saved'
  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    }
  }
  const compile = () =>
    run(async () => {
      const result = promptPackageSchema.parse(
        await visual.execute({
          operation: 'compile',
          projectId: entity.projectId,
          targetId: entity.id,
          previousShot: previous,
        }),
      )
      setPrompt(result)
      setPositive(result.positivePrompt)
      setNegative(result.negativePrompt)
    })
  const generate = () =>
    run(async () => {
      const task = aiTaskSchema.parse(
        await visual.execute({
          operation: 'generate',
          projectId: entity.projectId,
          targetId: entity.id,
          assetId: assetId || null,
          provider: provider || snapshot?.settings.provider || 'mock-image',
          positivePrompt: prompt ? positive : null,
          negativePrompt: prompt ? negative : null,
          previousShot: previous,
        }),
      )
      if ('assetId' in task.input) setSelected(task.input.assetId)
      await reload()
      await ai.refresh()
    })
  const refs = 'visualReferences' in entity ? entity.visualReferences : []
  const saveRefs = (references: VisualReference[]) =>
    run(async () => {
      await visual.execute({
        operation: 'references.save',
        projectId: entity.projectId,
        id: entity.id,
        expectedRevision: entity.revision,
        references,
      })
      await reload()
    })
  return (
    <section className="visual-panel" aria-label={'视觉生产 ' + entity.name}>
      <h4>{entity.kind === 'shot' ? '关键帧生成' : '视觉资产与参考图'}</h4>
      {entity.kind === 'shot' && entity.approvedKeyframeVersionId && (
        <div>
          <p>当前已确认关键帧（版本固定）</p>
          <AssetImage
            projectId={entity.projectId}
            versionId={entity.approvedKeyframeVersionId}
            alt="已确认关键帧"
          />
        </div>
      )}
      {entity.kind !== 'shot' && (
        <details>
          <summary>参考图管理（{refs.length}）</summary>
          <button
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                await visual.execute({
                  operation: 'asset.import',
                  projectId: entity.projectId,
                  assetId: null,
                  targetId: entity.id,
                })
                await reload()
              })
            }
          >
            导入参考图
          </button>
          <label>
            现有素材
            <select
              aria-label="现有素材"
              value={existing}
              onChange={(e) => setExisting(e.target.value)}
            >
              <option value="">选择素材</option>
              {entities
                .filter((e) => e.kind === 'asset' && e.mediaType === 'image')
                .map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            参考类型
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as VisualReference['role'])
              }
            >
              {(entity.kind === 'character'
                ? [
                    'faceReference',
                    'fullBodyReference',
                    'costumeReference',
                    'expressionReference',
                  ]
                : entity.kind === 'location'
                  ? ['masterReference', 'angleReference', 'lightingReference']
                  : ['masterReference', 'detailReference']
              ).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <button
            disabled={disabled || !existing}
            onClick={() =>
              void saveRefs([
                ...refs,
                { assetId: existing, role, primary: false },
              ])
            }
          >
            添加参考
          </button>
          {refs.map((ref) => (
            <div key={ref.assetId + ref.role}>
              <span>
                {entities.find((e) => e.id === ref.assetId)?.name} · {ref.role}{' '}
                {ref.primary ? '★ 主参考' : ''}
              </span>
              <button
                disabled={disabled}
                onClick={() =>
                  void saveRefs(
                    refs.map((r) => ({
                      ...r,
                      primary: r.assetId === ref.assetId && r.role === ref.role,
                    })),
                  )
                }
              >
                设为主参考
              </button>
              <button
                disabled={disabled}
                onClick={() => void saveRefs(refs.filter((r) => r !== ref))}
              >
                移除引用
              </button>
            </div>
          ))}
        </details>
      )}
      <label>
        图像 Provider
        <select
          aria-label="图像 Provider"
          value={provider || snapshot?.settings.provider || 'mock-image'}
          onChange={(e) =>
            setProvider(e.target.value as 'mock-image' | 'comfyui')
          }
        >
          <option value="mock-image">Mock Image（确定性测试图）</option>
          <option value="comfyui">ComfyUI</option>
        </select>
      </label>
      <label>
        版本所属资产
        <select
          aria-label="版本所属资产"
          value={assetId}
          disabled={!!assetOverride}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">新资产</option>
          {entities
            .filter((e) => e.kind === 'asset' && e.mediaType === 'image')
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </label>
      {entity.kind === 'shot' && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={previous}
            onChange={(e) => {
              setPrevious(e.target.checked)
              setPrompt(null)
            }}
          />
          使用上一镜头已确认关键帧
        </label>
      )}
      <div className="actions">
        <button disabled={disabled} onClick={() => void compile()}>
          编译并编辑 Prompt
        </button>
        <button
          className="primary"
          disabled={disabled}
          onClick={() => void generate()}
        >
          {entity.kind === 'shot' ? '生成关键帧' : '生成视觉资产'}
        </button>
      </div>
      <p className="muted">
        生成结果进入 Draft。标准文生图模板仅使用文字；参考图需工作流包含
        reference_image 槽位。重试任务保留相同 Prompt 和 seed。
      </p>
      {prompt && (
        <details open>
          <summary>Prompt Compiler · {prompt.promptVersion}</summary>
          <label>
            正向 Prompt
            <textarea
              aria-label="正向 Prompt"
              value={positive}
              onChange={(e) => setPositive(e.target.value)}
            />
          </label>
          <label>
            负向 Prompt
            <textarea
              aria-label="负向 Prompt"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </label>
          <p>连续性：{prompt.continuity}</p>
          <p>参考资产：{prompt.referenceAssetIds.length}</p>
        </details>
      )}
      {(error || visual.error) && (
        <p role="alert" className="error">
          {error || visual.error}
        </p>
      )}
      <TaskList
        tasks={ai.snapshot.tasks.filter(
          (t) =>
            'targetId' in t.input &&
            t.input.targetId === entity.id &&
            'request' in t.input,
        )}
        execute={ai.execute}
      />
      {asset?.kind === 'asset' && (
        <AssetReview
          asset={asset}
          versions={versions}
          entities={entities}
          execute={visual.execute}
          onChanged={reload}
          targetId={entity.id}
          onRegenerate={(v) => {
            const parsed = promptPackageSchema.safeParse(
              v.metadata.promptPackage,
            )
            if (parsed.success) {
              setPrompt(parsed.data)
              setPositive(v.prompt)
              setNegative(v.negativePrompt)
              setSelected(v.assetId)
            } else void compile()
          }}
        />
      )}
    </section>
  )
}
