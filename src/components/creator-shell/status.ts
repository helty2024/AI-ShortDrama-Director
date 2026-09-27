export type CreatorStatus = '草稿' | '待生成' | '准备就绪' | '生成中' | '待审核' | '已确认' | '失败' | '等待用户' | '不可用'
export function creatorStatus(status: string, official = false): CreatorStatus {
  if (official || ['adopted', 'confirmed'].includes(status)) return '已确认'
  if (['failed', 'error'].includes(status)) return '失败'
  if (['unavailable', 'capability-blocked'].includes(status)) return '不可用'
  if (['waiting-user', 'approval-required'].includes(status)) return '等待用户'
  if (['candidate', 'waiting-review', 'approved'].includes(status)) return '待审核'
  if (['queued', 'submitted', 'running', 'generating'].includes(status)) return '生成中'
  if (['ready', 'validated'].includes(status)) return '准备就绪'
  if (['pending', 'missing'].includes(status)) return '待生成'
  if (status === 'succeeded') return '待审核'
  return '草稿'
}
export function creatorTaskStatus(status: string): CreatorStatus | '排队' | '完成' {
  if (['queued', 'pending'].includes(status)) return '排队'
  if (status === 'succeeded') return '完成'
  if (status === 'cancelled') return '不可用'
  return creatorStatus(status)
}
