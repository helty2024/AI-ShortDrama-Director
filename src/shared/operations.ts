import { z } from 'zod'
import type { ShotProductionStatus } from './production.js'
const scope = { projectId: z.uuid() }
export const operationsCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('about') }),
  z.strictObject({ operation: z.literal('validation.create') }),
  z.strictObject({ operation: z.literal('restore') }),
  z.strictObject({
    ...scope,
    operation: z.literal('snapshot'),
    page: z.number().int().min(0).max(10000).default(0),
  }),
  z.strictObject({ ...scope, operation: z.literal('comfy.test') }),
  z.strictObject({ ...scope, operation: z.literal('backup') }),
  z.strictObject({ ...scope, operation: z.literal('diagnostics.export') }),
  z.strictObject({
    ...scope,
    operation: z.literal('paid.preview'),
    shotId: z.uuid(),
    profileId: z.uuid(),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('paid.submit'),
    previewId: z.uuid(),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('recovery.restart'),
    taskId: z.uuid(),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('qc.cancel'),
    taskId: z.uuid(),
  }),
  z.strictObject({
    ...scope,
    operation: z.literal('qc.retry'),
    taskId: z.uuid(),
  }),
])
export type OperationsCommand = z.infer<typeof operationsCommandSchema>
export const validationRecordSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  kind: z.enum(['comfy', 'paid', 'recovery', 'manifest']),
  testedAt: z.iso.datetime(),
  result: z.enum([
    'Not validated',
    'ready',
    'submitted',
    'validated',
    'failed',
  ]),
  details: z.record(z.string(), z.json()),
})
export type ValidationRecord = z.infer<typeof validationRecordSchema>
export const jobSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  shotId: z.uuid(),
  versionId: z.uuid(),
  status: z.enum(['queued', 'running', 'failed', 'cancelled', 'succeeded']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  error: z.string().nullable(),
  provider: z.string(),
  reportId: z.uuid().nullable(),
})
export type QCJob = z.infer<typeof jobSchema>
export function nextAction(
  s: Pick<ShotProductionStatus, 'complete' | 'keyframe' | 'video' | 'qc'>,
) {
  if (s.complete) return '生产完成'
  if (s.keyframe === 'missing') return '生成关键帧'
  if (s.keyframe === 'generating') return '等待关键帧生成'
  if (s.keyframe === 'review') return '审核关键帧'
  if (s.video === 'missing') return '生成视频'
  if (s.video === 'generating') return '等待视频生成'
  if (s.video === 'review') return '审核视频'
  if (s.qc === 'stale') return '源数据已变更，重新检查连续性与 QC'
  return '运行并审核 QC，确认生产结果'
}
export const taskRowSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  target: z.string(),
  provider: z.string(),
  status: z.string(),
  progress: z.number(),
  elapsed: z.number(),
  cost: z.string(),
  error: z.string().nullable(),
  remoteId: z.string().nullable(),
})
export const aboutSchema = z.object({
  version: z.string(),
  platform: z.string(),
  build: z.string(),
  schema: z.number(),
  ffmpeg: z.string(),
  ffprobe: z.string(),
})
export const operationsSnapshotSchema = z.object({
  records: z.array(validationRecordSchema),
  tasks: z.array(taskRowSchema),
  totalTasks: z.number(),
  errors: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
      target: z.string(),
      fix: z.string(),
    }),
  ),
  checklist: z.array(z.object({ label: z.string(), done: z.boolean() })),
  summary: z.record(z.string(), z.union([z.string(), z.number()])),
})
export type OperationsSnapshot = z.infer<typeof operationsSnapshotSchema>
