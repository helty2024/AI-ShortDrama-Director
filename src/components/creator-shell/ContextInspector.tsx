import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useWorkspace } from '../../features/workspace/state'
import { useCreator } from './creator-context'
import { AssetsInspector } from '../../features/assets/AssetsInspector'
import { StoryboardInspector } from '../../features/storyboard/StoryboardInspector'
import { GenerateInspector } from '../../features/generate/GenerateInspector'
import { ShotVideosInspector } from '../../features/shot-videos/ShotVideosInspector'

export function ContextInspector({ title, objectType, content, footer }: {
  title?: string; objectType?: string; content?: ReactNode; footer?: ReactNode
}) {
  const { state } = useWorkspace()
  const { currentModule, inspectorOpen, closeInspector, shotId, sceneId, assetId, candidateId, targetKind, targetId, navigateCreator } = useCreator()
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
  const scene = entities.find((entity) => entity.id === sceneId && entity.kind === 'scene')
  const story = currentModule === 'story' ? state.workspace?.project : null
  const creatorAsset = currentModule === 'assetsHub' ? entities.find((entity) => entity.id === targetId && entity.kind === targetKind) : undefined
  const assetTarget = creatorAsset?.kind === 'character' || creatorAsset?.kind === 'location' || creatorAsset?.kind === 'prop' ? creatorAsset : undefined
  const shotTarget = entities.find((entity) => entity.id === shotId && entity.kind === 'shot')
  const generateTarget = targetId && targetKind ? assetTarget ?? entities.find((entity) => entity.id === targetId && entity.kind === targetKind) : shotTarget
  const heading = title ?? (story ? '故事属性' : currentModule === 'scripts' ? (scene?.kind === 'scene' ? scene.content.heading || scene.name : '场次详情') : currentModule === 'assetsHub' ? assetTarget?.name ?? '资产详情' : selected?.name ?? '当前上下文')
  return <aside className="creator-inspector" aria-label="上下文检查器" aria-modal={overlay ? true : undefined} role={overlay ? 'dialog' : 'complementary'}>
    <div className="creator-inspector-head"><div><small>{objectType ?? (story ? '故事' : currentModule === 'scripts' ? '场次' : currentModule === 'assetsHub' ? assetTarget?.kind === 'character' ? '角色' : assetTarget?.kind === 'location' ? '场景' : assetTarget?.kind === 'prop' ? '道具' : '资产' : selected ? ({ shot: '镜头', scene: '场次', character: '角色', location: '场景', prop: '道具' } as Record<string, string>)[selected.kind] ?? '素材' : '详情')}</small><h2>{heading}</h2></div>
      <button ref={closeButton} aria-label="关闭检查器" onClick={closeInspector}>×</button></div>
    <div className="creator-inspector-body">{content ?? (currentModule === 'shotVideos' && shotTarget?.kind === 'shot' ? <ShotVideosInspector key={shotTarget.id} shot={shotTarget} /> : story ? <dl className="creator-inspector-facts"><dt>类型</dt><dd>{story.genre}</dd><dt>画幅</dt><dd>{story.aspectRatio}</dd><dt>语言</dt><dd>{story.language}</dd><dt>最后更新</dt><dd>{new Date(story.updatedAt).toLocaleString('zh-CN')}</dd><dt>创作摘要</dt><dd>{story.logline || '先写一句话概念，建立这个短剧的创作方向。'}</dd></dl> : currentModule === 'scripts' ? (scene?.kind === 'scene' ? <dl className="creator-inspector-facts"><dt>场次编号</dt><dd>{scene.content.sceneNumber || String(scene.order + 1)}</dd><dt>名称</dt><dd>{scene.content.heading || scene.name}</dd><dt>地点</dt><dd>{scene.content.location || '未设置'}</dd><dt>时间</dt><dd>{scene.content.timeOfDay || '未设置'}</dd><dt>人物</dt><dd>{scene.content.characters.join('、') || '未设置'}</dd><dt>状态</dt><dd>草稿</dd></dl> : <p>选择一个场次，查看其创作上下文。</p>) : currentModule === 'assetsHub' ? assetTarget ? <AssetsInspector key={assetTarget.id} target={assetTarget} /> : <p>选择角色、场景或道具，查看设定、主参考与候选。</p> : currentModule === 'storyboard' && shotTarget?.kind === 'shot' ? <StoryboardInspector key={shotTarget.id} shot={shotTarget} /> : currentModule === 'generation' && generateTarget && (generateTarget.kind === 'shot' || generateTarget.kind === 'character' || generateTarget.kind === 'location' || generateTarget.kind === 'prop') ? <GenerateInspector key={generateTarget.id} target={generateTarget} /> : <>
      {selected ? <p>{selected.description || '暂无简介'}</p> : <p>选择场次、镜头或资产后，可在这里查看上下文。</p>}
      {shotId && <div className="creator-inspector-actions"><button onClick={() => navigateCreator('generation', { shotId })}>去生成</button><button onClick={() => navigateCreator('storyboard', { shotId })}>查看分镜</button></div>}
      {candidateId && <p>已选择候选结果。</p>}
    </>)}</div>
    {footer && <div className="creator-inspector-footer">{footer}</div>}
  </aside>
}
