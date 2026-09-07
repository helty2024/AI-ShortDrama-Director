import { intelligenceSnapshotSchema } from '../shared/intelligence'
import type { IntelligenceCommand } from '../shared/intelligence'
export const intelligenceService = {
  async command(command: IntelligenceCommand) {
    if (!window.desktop) throw new Error('请在桌面应用中使用剧本智能工作区')
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
