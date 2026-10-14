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
  if (/unknown-submission|pending-unknown|重复扣费/.test(message)) return '需要处理：任务状态待核实，请查询原任务状态，不要重复付费提交。原任务和结果仍保留。'
  if (/authentication|AUTH|密钥|认证/.test(message)) return '密钥无效，请在 AI 服务中重新设置并检测连接。'
  if (/余额|额度|积分不足/.test(message)) return '账户额度不足，请充值后继续。'
  if (/capability|不支持|模型不可见/.test(message)) return '该模型不支持当前任务，请检查模型和生成要求。'
  if (/预检|配置|unavailable|routing failed|路由|ComfyUI|连接|工具|服务/.test(message)) return '服务不可用：请先在设置中连接 AI 服务，检查连接和生成能力。故事和已确认素材仍可继续编辑。'
  return '生成失败：请检查内容后重试，或在设置中查看高级诊断。已确认版本不会被替换。'
}
