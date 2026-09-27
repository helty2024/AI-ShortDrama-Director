import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ToastContext } from './toast-context'
import type { ToastKind } from './toast-context'
interface Toast { id: number; kind: ToastKind; message: string }
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const show = (kind: ToastKind, message: string) => setToast({ id: Date.now(), kind, message })
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])
  return <ToastContext.Provider value={show}>
    {children}
    <div className="creator-toast-host" aria-live="polite">
      {toast && <div className="creator-toast" data-kind={toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}>
        <span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}>×</button>
      </div>}
    </div>
  </ToastContext.Provider>
}
