import { createContext, useContext } from 'react'
export type ToastKind = 'success' | 'warning' | 'error' | 'info'
export const ToastContext = createContext<((kind: ToastKind, message: string) => void) | null>(null)
export function useToast() {
  const show = useContext(ToastContext)
  if (!show) throw new Error('ToastProvider missing')
  return show
}
