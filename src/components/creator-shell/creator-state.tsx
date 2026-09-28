import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useWorkspace } from '../../features/workspace/state'
import { creatorModuleOf } from './modules'
import { CreatorContext } from './creator-context'
import type { CreatorSelection } from './creator-context'
export function CreatorContextProvider({ children }: { children: ReactNode }) {
  const { state, navigate } = useWorkspace()
  const [selection, setSelection] = useState<CreatorSelection>({})
  const [inspectorOpen, setInspectorOpen] = useState(() => window.matchMedia('(min-width: 2200px)').matches)
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false)
  const [contextNotice, setContextNotice] = useState<string | null>(null)
  const closeInspector = useCallback(() => setInspectorOpen(false), [])
  const currentModule = creatorModuleOf(state.module)
  const entities = state.workspace?.entities ?? []
  const valid = (id: string | undefined, kind: string) =>
    id && entities.some((entity) => entity.id === id && entity.kind === kind) ? id : undefined
  const normalize = (next: CreatorSelection): CreatorSelection => {
    const shotId = valid(next.shotId, 'shot')
    const shot = entities.find((entity) => entity.id === shotId)
    const targetId = next.targetKind ? valid(next.targetId, next.targetKind) : undefined
    return {
      sceneId: valid(next.sceneId ?? (shot?.kind === 'shot' ? shot.sceneId : undefined), 'scene'),
      shotId,
      assetId: next.assetId && entities.some((entity) => entity.id === next.assetId && ['character', 'location', 'prop', 'asset'].includes(entity.kind)) ? next.assetId : undefined,
      candidateId: next.shotId && !shotId ? undefined : next.candidateId,
      targetKind: targetId ? next.targetKind : undefined,
      targetId,
    }
  }
  const visibleSelection = normalize(selection)
  const missingShot = Boolean(selection.shotId && !visibleSelection.shotId)
  return <CreatorContext.Provider value={{
    ...visibleSelection, currentModule, inspectorOpen, taskDrawerOpen,
    contextNotice: contextNotice ?? (missingShot ? '所选镜头已不存在，请重新选择。' : null),
    clearContextNotice: () => {
      setContextNotice(null)
      if (missingShot) setSelection((old) => ({ ...old, shotId: undefined, candidateId: undefined }))
    },
    openInspector: () => setInspectorOpen(true),
    closeInspector,
    toggleInspector: () => setInspectorOpen((value) => !value),
    setTaskDrawerOpen,
    select: (next) => {
      setContextNotice(next.shotId && !valid(next.shotId, 'shot') ? '所选镜头已不存在，请重新选择。' : null)
      setSelection((old) => normalize({ ...old, ...next }))
      setInspectorOpen(true)
    },
    selectScene: (sceneId) => setSelection((old) => ({ ...old, sceneId: valid(sceneId, 'scene') })),
    selectCreatorAsset: (targetKind, targetId) => {
      const id = targetKind ? valid(targetId, targetKind) : undefined
      setSelection((old) => ({ ...old, assetId: id, targetKind: id ? targetKind : undefined, targetId: id, candidateId: undefined }))
      if (id) setInspectorOpen(true)
    },
    navigateCreator: (module, next) => {
      if (navigate(module) && next) {
        setContextNotice(next.shotId && !valid(next.shotId, 'shot') ? '所选镜头已不存在，请重新选择。' : null)
        setSelection((old) => normalize({ ...old, ...next }))
      }
    },
  }}>{children}</CreatorContext.Provider>
}
