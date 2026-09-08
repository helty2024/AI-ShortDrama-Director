import { useCallback, useEffect, useState } from 'react'
import { productionService } from '../../services/production'
import type { ProductionSnapshot, ProductionCommand } from '../../shared/video'
export function useProduction(projectId: string) {
  const [snapshot, setSnapshot] = useState<ProductionSnapshot | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const refresh = useCallback(
    async () => setSnapshot(await productionService.snapshot(projectId)),
    [projectId],
  )
  useEffect(() => {
    let active = true,
      running = false
    const load = async () => {
      if (running) return
      running = true
      try {
        const s = await productionService.snapshot(projectId)
        if (active) setSnapshot(s)
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
  const execute = async (c: ProductionCommand) => {
    setBusy(true)
    setError('')
    try {
      const r = await productionService.command(c)
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
