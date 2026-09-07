import { useCallback, useEffect, useState } from 'react'
import { visualService } from '../../services/visual'
import type { VisualSnapshot, VisualCommand } from '../../shared/visual'
export function useVisual(projectId: string) {
  const [snapshot, setSnapshot] = useState<VisualSnapshot | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    setSnapshot(await visualService.snapshot(projectId))
  }, [projectId])
  useEffect(() => {
    let active = true,
      running = false
    const load = async () => {
      if (running) return
      running = true
      try {
        const next = await visualService.snapshot(projectId)
        if (active) setSnapshot(next)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '读取失败')
      } finally {
        running = false
      }
    }
    void load()
    const timer = setInterval(() => void load(), 1200)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [projectId])
  const execute = async (command: VisualCommand) => {
    setBusy(true)
    setError('')
    try {
      const data = await visualService.command(command)
      await refresh()
      return data
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      throw e
    } finally {
      setBusy(false)
    }
  }
  return { snapshot, error, busy, execute, refresh }
}
