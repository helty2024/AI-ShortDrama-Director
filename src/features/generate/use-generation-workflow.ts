import { useCallback, useEffect, useState } from 'react'
import { workflowSnapshotSchema } from '../../shared/workflow'
import type { WorkflowCommand, WorkflowInput, WorkflowSnapshot } from '../../shared/workflow'
import { workflowCommand } from '../workflow/api'
import { useWorkflowRuns } from './use-workflow-runs'

export function useGenerationWorkflow(projectId: string, targetId: string, mode: 'keyframe' | 'video') {
  const { runs, error: listError } = useWorkflowRuns(projectId)
  const [selectedRunId, setSelectedRunId] = useState('')
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const related = runs.filter((run) => run.targetObjectId === targetId && run.workflowType === (mode === 'keyframe' ? 'shot-keyframe' : 'shot-video'))
  const runId = related.some((run) => run.id === selectedRunId) ? selectedRunId : related[0]?.id
  const refresh = useCallback(async () => {
    if (!runId) { setSnapshot(null); return }
    setSnapshot(workflowSnapshotSchema.parse(await workflowCommand({ op: 'getWorkflowRun', projectId, runId })))
  }, [projectId, runId])
  useEffect(() => {
    let active = true, running = false
    const load = async () => {
      if (!runId || running) return
      running = true
      try { const next = workflowSnapshotSchema.parse(await workflowCommand({ op: 'getWorkflowRun', projectId, runId })); if (active) { setSnapshot(next); setError('') } }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '流程读取失败') }
      finally { running = false }
    }
    void load()
    const timer = setInterval(() => void load(), 1500)
    return () => { active = false; clearInterval(timer) }
  }, [projectId, runId])
  const create = async (input: WorkflowInput) => {
    setBusy(true); setError('')
    try {
      const next = workflowSnapshotSchema.parse(await workflowCommand({ op: 'createWorkflowRun', input }))
      setSelectedRunId(next.run.id); setSnapshot(next)
    } finally { setBusy(false) }
  }
  const act = async (command: WorkflowCommand) => {
    setBusy(true); setError('')
    try { setSnapshot(workflowSnapshotSchema.parse(await workflowCommand(command))) }
    finally { setBusy(false) }
  }
  return { related, snapshot: snapshot?.run.id === runId ? snapshot : null, runId, selectedRunId, setSelectedRunId, create, act, refresh, busy, error: error || listError }
}
