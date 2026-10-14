export type CreatorStatus = '草稿' | '准备中' | '可以生成' | '生成中' | '等待选择' | '已确认' | '需要处理' | '生成失败' | '服务不可用'
export function creatorStatus(status: string, official = false): CreatorStatus {
  if (official || ['adopted', 'confirmed'].includes(status)) return '已确认'
  if (['unknown-submission', 'pending-unknown', 'unknown', 'routing failed'].includes(status)) return '需要处理'
  if (['failed', 'error'].includes(status)) return '生成失败'
  if (['unavailable', 'capability-blocked', 'configured-unverified'].includes(status)) return '服务不可用'
  if (['waiting-user', 'approval-required', 'candidate', 'waiting-review', 'approved'].includes(status)) return '等待选择'
  if (['queued', 'submitted', 'running', 'generating'].includes(status)) return '生成中'
  if (['ready', 'validated'].includes(status)) return '可以生成'
  if (status === 'pending') return '准备中'
  if (status === 'succeeded') return '等待选择'
  return '草稿'
}
export function creatorTaskStatus(status: string): CreatorStatus {
  if (['queued', 'pending'].includes(status)) return '准备中'
  if (status === 'succeeded') return '等待选择'
  if (status === 'cancelled') return '需要处理'
  return creatorStatus(status)
}

export function creatorErrorMessage(message: string): string {
  if (/unknown-submission|pending-unknown|重复扣费/.test(message)) return '需要处理：暂时无法确认生成结果，请刷新状态。不要重复生成；原任务和结果仍保留。'
  if (/预检|配置|unavailable|routing failed|路由|ComfyUI|连接|工具|服务/.test(message)) return '服务不可用：请检查设置中的生成服务，或使用 Alpha 测试生成。故事和已确认素材仍可继续编辑。'
  return '生成失败：请检查内容后重试，或在设置中查看高级诊断。已确认版本不会被替换。'
}
