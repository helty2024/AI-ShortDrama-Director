import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { CreatorErrorBoundary } from './CreatorErrorBoundary'
import { useCreator } from './creator-context'
export function MainWorkspace({ children, resetKey, busy }: { children: ReactNode; resetKey: string; busy: boolean }) {
  const { contextNotice, clearContextNotice } = useCreator()
  const main = useRef<HTMLElement>(null)
  const positions = useRef(new Map<string, number>())
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = positions.current.get(resetKey) ?? 0 }, [resetKey])
  return <main ref={main} className="creator-main" aria-label="主工作区" aria-busy={busy}
    onScroll={(event) => positions.current.set(resetKey, event.currentTarget.scrollTop)}>
    {contextNotice && <div className="creator-context-notice" role="status">{contextNotice}<button aria-label="关闭上下文提示" onClick={clearContextNotice}>×</button></div>}
    <CreatorErrorBoundary key={resetKey}>{children}</CreatorErrorBoundary>
  </main>
}
