import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { projectInputSchema } from '../../shared/domain'
import type { EntityKind } from '../../shared/domain'
import { workspaceService } from '../../services/workspace'
import { useWorkspace } from './state'
import { entityLabels } from './labels'

const parents: Partial<Record<EntityKind, EntityKind>> = {
  episode: 'script',
  scene: 'episode',
  storyboard: 'episode',
  shot: 'storyboard',
}
export function WorkspaceDialog() {
  const { state, modal, mutate } = useWorkspace()
  const dialog = useRef<HTMLDialogElement>(null)
  const current = state.modal
  const [name, setName] = useState(
    current?.type === 'rename' ? current.project.name : '',
  )
  const [parentId, setParentId] = useState('')
  const [validation, setValidation] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const title = !current
    ? ''
    : current.type === 'project'
      ? '新建项目'
      : current.type === 'rename'
        ? '重命名项目'
        : current.type === 'delete'
          ? '删除项目'
          : '新增' + entityLabels[current.kind]
  const parentKind =
    current?.type === 'entity' ? parents[current.kind] : undefined
  const entities = state.workspace?.entities ?? []
  const selectedBoard = entities.find((entity) => entity.id === parentId)
  const scenes = entities.filter(
    (entity) =>
      entity.kind === 'scene' &&
      selectedBoard?.kind === 'storyboard' &&
      entity.episodeId === selectedBoard.episodeId,
  )
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!current) return
    const form = new FormData(event.currentTarget)
    setValidation('')
    if (current.type === 'project') {
      const parsed = projectInputSchema.safeParse(Object.fromEntries(form))
      if (!parsed.success) {
        setValidation(parsed.error.issues[0]?.message ?? '请检查输入')
        return
      }
      void mutate(
        async () =>
          (
            await workspaceService.open(
              (await workspaceService.create(parsed.data)).id,
            )
          ).id,
      )
    } else if (current.type === 'rename') {
      void mutate(async () => {
        await workspaceService.update({
          id: current.project.id,
          expectedRevision: current.project.revision,
          changes: { name: name.trim() },
        })
        return undefined
      })
    } else if (current.type === 'delete') {
      if (name !== current.project.name) {
        setValidation('请输入完整项目名以确认删除')
        return
      }
      void mutate(async () => {
        await workspaceService.delete(current.project.id)
        return state.workspace?.project.id === current.project.id
          ? null
          : undefined
      })
    } else if (state.workspace) {
      const projectId = state.workspace.project.id
      void mutate(async () => {
        await workspaceService.createDraft({
          projectId,
          kind: current.kind,
          name,
          ...(parentId ? { parentId } : {}),
          ...(form.get('sceneId')
            ? { sceneId: String(form.get('sceneId')) }
            : {}),
        })
        return undefined
      })
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault()
        modal(null)
      }}
      aria-labelledby="dialog-title"
    >
      <form onSubmit={submit}>
        <h2 id="dialog-title">{title}</h2>
        {current?.type === 'delete' && (
          <p>
            将永久删除「{current.project.name}
            」及其全部关联数据。请输入项目名确认。
          </p>
        )}
        <label>
          {current?.type === 'delete' ? '确认项目名' : '名称'}
          <input
            autoFocus
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {current?.type === 'project' && (
          <>
            <label>
              简介
              <textarea name="description" maxLength={4000} />
            </label>
            <label>
              类型
              <input name="genre" required maxLength={80} defaultValue="剧情" />
            </label>
            <label>
              画幅比例
              <select name="aspectRatio" defaultValue="9:16">
                <option>9:16</option>
                <option>16:9</option>
                <option>1:1</option>
                <option>4:3</option>
              </select>
            </label>
            <label>
              默认语言
              <input
                name="language"
                required
                maxLength={40}
                defaultValue="zh-CN"
              />
            </label>
            <p>创建时间由系统自动记录。</p>
          </>
        )}
        {parentKind && (
          <label>
            所属{entityLabels[parentKind]}
            <select
              required
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">
                请选择（若为空，请先创建{entityLabels[parentKind]}）
              </option>
              {entities
                .filter((entity) => entity.kind === parentKind)
                .map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {current?.type === 'entity' && current.kind === 'shot' && (
          <label>
            所属场次
            <select name="sceneId" required key={parentId}>
              <option value="">请选择同一集中的场次</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(validation || state.error) && (
          <p role="alert" className="error">
            {validation || state.error}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            disabled={state.saving}
            onClick={() => modal(null)}
          >
            取消
          </button>
          <button
            className={current?.type === 'delete' ? 'danger' : 'primary'}
            disabled={state.saving}
          >
            {state.saving
              ? '保存中…'
              : current?.type === 'delete'
                ? '确认删除'
                : '保存'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
