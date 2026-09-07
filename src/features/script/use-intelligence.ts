import { useCallback, useEffect, useState } from 'react'
import { intelligenceService } from '../../services/intelligence'
import type {
  IntelligenceCommand,
  IntelligenceSnapshot,
} from '../../shared/intelligence'

export function useIntelligence(projectId: string) {
  const [snapshot, setSnapshot] = useState<IntelligenceSnapshot>({
    tasks: [],
    drafts: [],
    imports: [],
    production: [],
    provider: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const next = await intelligenceService.snapshot(projectId)
    setSnapshot(next)
  }, [projectId])
  useEffect(() => {
    let disposed = false,
      running = false
    const load = async () => {
      if (running) return
      running = true
      try {
        const next = await intelligenceService.snapshot(projectId)
        if (!disposed) setSnapshot(next)
      } catch (error) {
        if (!disposed)
          setError(error instanceof Error ? error.message : '加载失败')
      } finally {
        running = false
      }
    }
    void load()
    const timer = setInterval(() => void load(), 800)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [projectId])
  const execute = async (command: IntelligenceCommand) => {
    setBusy(true)
    setError('')
    try {
      const result = await intelligenceService.command(command)
      await refresh()
      return result
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败')
      throw error
    } finally {
      setBusy(false)
    }
  }
  return { snapshot, error, busy, refresh, execute }
}
