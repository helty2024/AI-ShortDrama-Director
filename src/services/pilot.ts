import type { PilotCommand } from '../shared/production'
import { pilotSnapshotSchema } from '../shared/production'
export const pilotService = {
  async command(command: PilotCommand) {
    if (!window.desktop) throw Error('需要桌面环境')
    const r = await window.desktop.workspace.request({
      action: 'pilot',
      command,
    })
    if (!r.ok) throw Error(r.message)
    return r.data
  },
  async snapshot(projectId: string) {
    return pilotSnapshotSchema.parse(
      await this.command({ operation: 'snapshot', projectId }),
    )
  },
}
