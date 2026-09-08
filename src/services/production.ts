import type { ProductionCommand } from '../shared/video'
import { productionSnapshotSchema } from '../shared/video'
export const productionService = {
  async command(command: ProductionCommand) {
    if (!window.desktop) throw new Error('需要桌面环境')
    const r = await window.desktop.workspace.request({
      action: 'production',
      command,
    })
    if (!r.ok) throw new Error(r.message)
    return r.data
  },
  async snapshot(projectId: string) {
    return productionSnapshotSchema.parse(
      await this.command({ operation: 'snapshot', projectId }),
    )
  },
}
