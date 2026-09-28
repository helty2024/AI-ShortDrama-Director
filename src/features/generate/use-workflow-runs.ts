import { useEffect, useState } from 'react'
import { z } from 'zod'
import { workflowRunSchema } from '../../shared/workflow'
import type { WorkflowRun } from '../../shared/workflow'
import { workflowCommand } from '../workflow/api'

export function useWorkflowRuns(projectId: string) {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true, running = false
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const next = z.array(workflowRunSchema).parse(await workflowCommand({ op: 'listWorkflowRuns', projectId }))
        if (active) { setRuns(next); setError('') }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '流程暂不可用') }
      finally { running = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    return () => { active = false; clearInterval(timer) }
  }, [projectId])
  return { runs, error }
}
