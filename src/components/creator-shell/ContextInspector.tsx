import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useWorkspace } from '../../features/workspace/state'
import { useCreator } from './creator-context'

export function ContextInspector({ title, objectType, content, footer }: {
  title?: string; objectType?: string; content?: ReactNode; footer?: ReactNode
}) {
  const { state } = useWorkspace()
  const { inspectorOpen, closeInspector, shotId, sceneId, assetId, candidateId, navigateCreator } = useCreator()
  const closeButton = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const overlay = window.matchMedia('(max-width: 2199px)').matches
  useEffect(() => {
    if (!inspectorOpen) return
    if (overlay) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      closeButton.current?.focus()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeInspector() }
      if (overlay && event.key === 'Tab') {
        const controls = Array.from(document.querySelectorAll<HTMLElement>('.creator-inspector button:not([disabled]), .creator-inspector a[href], .creator-inspector input:not([disabled])'))
        if (!controls.length) return
        const first = controls[0]!, last = controls[controls.length - 1]!
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); if (overlay) trigger.current?.focus() }
  }, [inspectorOpen, overlay, closeInspector])
  if (!inspectorOpen) return null
  const entities = state.workspace?.entities ?? []
  const selected = entities.find((entity) => entity.id === (assetId ?? shotId ?? sceneId))
  const heading = title ?? selected?.name ?? '当前上下文'
  return <aside className="creator-inspector" aria-label="上下文检查器" aria-modal={overlay ? true : undefined} role={overlay ? 'dialog' : 'complementary'}>
    <div className="creator-inspector-head"><div><small>{objectType ?? (selected ? ({ shot: '镜头', scene: '场次', character: '角色', location: '场景', prop: '道具' } as Record<string, string>)[selected.kind] ?? '素材' : '详情')}</small><h2>{heading}</h2></div>
      <button ref={closeButton} aria-label="关闭检查器" onClick={closeInspector}>×</button></div>
    <div className="creator-inspector-body">{content ?? <>
      {selected ? <p>{selected.description || '暂无简介'}</p> : <p>选择场次、镜头或资产后，可在这里查看上下文。</p>}
      {shotId && <div className="creator-inspector-actions"><button onClick={() => navigateCreator('generation', { shotId })}>去生成</button><button onClick={() => navigateCreator('storyboard', { shotId })}>查看分镜</button></div>}
      {candidateId && <p>已选择候选结果。</p>}
    </>}</div>
    {footer && <div className="creator-inspector-footer">{footer}</div>}
  </aside>
}
