import { z } from 'zod'
import { intelligenceCommandSchema } from './intelligence.js'
import type {
  AITask,
  IntelligenceDraft,
  IntelligenceSnapshot,
} from './intelligence.js'
import {
  draftInputSchema,
  idSchema,
  projectInputSchema,
  projectUpdateSchema,
} from './domain.js'
import type { Entity, Project, Workspace } from './domain.js'

export const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('intelligence'),
    command: intelligenceCommandSchema,
  }),
  z.strictObject({ action: z.literal('projects.list') }),
  z.strictObject({
    action: z.literal('projects.create'),
    input: projectInputSchema,
  }),
  z.strictObject({ action: z.literal('projects.get'), id: idSchema }),
  z.strictObject({ action: z.literal('projects.open'), id: idSchema }),
  z.strictObject({
    action: z.literal('projects.update'),
    input: projectUpdateSchema,
  }),
  z.strictObject({ action: z.literal('projects.delete'), id: idSchema }),
  z.strictObject({ action: z.literal('workspace.get'), id: idSchema }),
  z.strictObject({
    action: z.literal('entities.createDraft'),
    input: draftInputSchema,
  }),
  z.strictObject({ action: z.literal('projects.seed') }),
])
export type Request = z.infer<typeof requestSchema>
export type ResponseData =
  | Project
  | Project[]
  | Workspace
  | Entity
  | IntelligenceSnapshot
  | AITask
  | IntelligenceDraft
  | null
export type Result =
  | { ok: true; data: ResponseData }
  | {
      ok: false
      code:
        'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL'
      message: string
    }
export interface WorkspaceAPI {
  request: (request: Request) => Promise<Result>
}
