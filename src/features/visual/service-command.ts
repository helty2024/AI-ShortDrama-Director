import { aiServicesSnapshotSchema } from '../../shared/ai-services'
import type { ServiceSettingsCommand } from '../../shared/service-settings'

export async function aiServiceCommand(command: ServiceSettingsCommand) {
  const result = await window.desktop!.workspace.request({ action: 'serviceSettings', command })
  if (!result.ok) throw new Error(result.message)
  return aiServicesSnapshotSchema.parse(result.data)
}
