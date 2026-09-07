import { z } from 'zod'
import { entitySchema, projectSchema, workspaceSchema } from '../shared/domain'
import type { DraftInput, ProjectInput, ProjectUpdate } from '../shared/domain'
import type { Request } from '../shared/api'

async function request<T>(input: Request, schema: z.ZodType<T>): Promise<T> {
  if (!window.desktop) throw new Error('请在 Electron 桌面应用中打开工作台')
  const result = await window.desktop.workspace.request(input)
  if (!result.ok) throw new Error(result.message)
  return schema.parse(result.data)
}
export const workspaceService = {
  list: () => request({ action: 'projects.list' }, z.array(projectSchema)),
  get: (id: string) => request({ action: 'projects.get', id }, projectSchema),
  open: (id: string) => request({ action: 'projects.open', id }, projectSchema),
  create: (input: ProjectInput) =>
    request({ action: 'projects.create', input }, projectSchema),
  update: (input: ProjectUpdate) =>
    request({ action: 'projects.update', input }, projectSchema),
  delete: (id: string) => request({ action: 'projects.delete', id }, z.null()),
  readWorkspace: (id: string) =>
    request({ action: 'workspace.get', id }, workspaceSchema),
  createDraft: (input: DraftInput) =>
    request({ action: 'entities.createDraft', input }, entitySchema),
  seed: () => request({ action: 'projects.seed' }, projectSchema),
}
