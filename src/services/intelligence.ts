import { intelligenceSnapshotSchema } from '../shared/intelligence'
import type { IntelligenceCommand } from '../shared/intelligence'
import { aiServicesSnapshotSchema } from '../shared/ai-services'
export const intelligenceService = {
  async command(command: IntelligenceCommand) {
    if (!window.desktop) throw new Error('请在桌面应用中使用剧本智能工作区')
    if (command.operation === 'task.start' || command.operation === 'task.retry') {
      const response = await window.desktop.workspace.request({ action: 'serviceSettings', command: { op: 'ai.list' } })
      if (!response.ok) throw new Error(response.message)
      if (aiServicesSnapshotSchema.parse(response.data).mode === 'production') {
        if (!window.confirm('将向默认文本 AI 发送本次故事或场次内容，可能产生实际 API 费用。仅请求本次任务，不自动重试。是否继续？')) throw new Error('已取消真实文本请求')
        command = { ...command, realRequestConfirmed: true }
      }
    }
    const result = await window.desktop.workspace.request({
      action: 'intelligence',
      command,
    })
    if (!result.ok) throw new Error(result.message)
    return result.data
  },
  async snapshot(projectId: string) {
    return intelligenceSnapshotSchema.parse(
      await this.command({ operation: 'snapshot', projectId }),
    )
  },
}
