import { AIError } from './intelligence/provider.js'
import { VisualService } from './visual/service.js'
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { requestSchema } from '../../src/shared/api.js'
import type { Result } from '../../src/shared/api.js'
import { DomainError, ProjectDatabase } from './database.js'
import { buildSeed } from './seed.js'
import { IntelligenceService } from './intelligence/service.js'

export function isTrustedSender(
  event: IpcMainInvokeEvent,
  windows: Set<number>,
  expectedUrl: string,
): boolean {
  return (
    windows.has(event.sender.id) &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url === expectedUrl
  )
}
export function registerWorkspaceIPC(
  database: ProjectDatabase,
  windows: Set<number>,
  expectedUrl: string,
  allowSeed: boolean,
  intelligence: IntelligenceService,
  visual: VisualService,
) {
  ipcMain.handle(
    'workspace:request',
    async (event, raw: unknown): Promise<Result> => {
      if (!isTrustedSender(event, windows, expectedUrl))
        return { ok: false, code: 'FORBIDDEN', message: '不允许访问项目数据' }
      try {
        const request = requestSchema.parse(raw)
        switch (request.action) {
          case 'visual':
            return { ok: true, data: await visual.execute(request.command) }
          case 'intelligence':
            return { ok: true, data: intelligence.execute(request.command) }
          case 'projects.list':
            return { ok: true, data: database.list() }
          case 'projects.create':
            return { ok: true, data: database.create(request.input) }
          case 'projects.get':
            return { ok: true, data: database.get(request.id) }
          case 'projects.open':
            return { ok: true, data: database.open(request.id) }
          case 'projects.update':
            return { ok: true, data: database.update(request.input) }
          case 'projects.delete':
            intelligence.queue.cancelProject(request.id)
            return { ok: true, data: database.delete(request.id) }
          case 'workspace.get':
            return { ok: true, data: database.workspace(request.id) }
          case 'entities.createDraft':
            return { ok: true, data: database.createDraft(request.input) }
          case 'projects.seed':
            if (!allowSeed)
              throw new DomainError('FORBIDDEN', '示例数据仅在开发模式可用')
            return { ok: true, data: database.seed(buildSeed) }
        }
      } catch (error) {
        if (error instanceof z.ZodError)
          return {
            ok: false,
            code: 'INVALID_INPUT',
            message: '输入格式错误，请检查字段和关联对象',
          }
        if (error instanceof AIError)
          return { ok: false, code: 'CONFLICT', message: error.message }
        if (error instanceof DomainError)
          return { ok: false, code: error.code, message: error.message }
        console.error('Workspace operation failed:', error)
        return { ok: false, code: 'INTERNAL', message: '数据操作失败，请重试' }
      }
    },
  )
}
