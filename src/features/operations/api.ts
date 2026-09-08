import type { OperationsCommand } from '../../shared/operations'
export async function operate(command: OperationsCommand) {
  if (!window.desktop) throw new Error('需要桌面环境')
  const r = await window.desktop.workspace.request({
    action: 'operations',
    command,
  })
  if (!r.ok) throw new Error(r.message)
  return r.data
}
