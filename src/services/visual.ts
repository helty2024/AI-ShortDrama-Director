import { visualSnapshotSchema } from '../shared/visual'
import type { VisualCommand } from '../shared/visual'
export const visualService = {
  async command(command: VisualCommand) {
    if (!window.desktop) throw new Error('需要 Electron 桌面环境')
    const result = await window.desktop.workspace.request({
      action: 'visual',
      command,
    })
    if (!result.ok) throw new Error(result.message)
    return result.data
  },
  async snapshot(projectId: string) {
    return visualSnapshotSchema.parse(
      await this.command({ operation: 'snapshot', projectId }),
    )
  },
}
