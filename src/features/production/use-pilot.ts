import { useCallback, useEffect, useState } from 'react'
import { pilotService } from '../../services/pilot'
import type { PilotCommand, PilotSnapshot } from '../../shared/production'
export function usePilot(projectId: string) {
  const [snapshot, setSnapshot] = useState<PilotSnapshot | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const refresh = useCallback(
    async () => setSnapshot(await pilotService.snapshot(projectId)),
    [projectId],
  )
  useEffect(() => {
    let active = true,
      running = false
    const load = async () => {
      if (running) return
      running = true
      try {
        const data = await pilotService.snapshot(projectId)
        if (active) setSnapshot(data)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '读取失败')
      } finally {
        running = false
      }
    }
    void load()
    const timer = setInterval(() => void load(), 1500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [projectId])
  const execute = async (c: PilotCommand) => {
    setBusy(true)
    setError('')
    try {
      const r = await pilotService.command(c)
      await refresh()
      return r
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      throw e
    } finally {
      setBusy(false)
    }
  }
  return { snapshot, error, busy, execute, refresh }
}
