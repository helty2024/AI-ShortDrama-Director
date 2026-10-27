import { z } from 'zod'
import { toolDescriptorSchema } from './tools.js'
import { capabilitySnapshotSchema } from './capabilities/index.js'

export const executionConfigurationSchema = z.strictObject({
  provider: z.string().min(1).max(100),
  serviceId: z.uuid().nullable(), serviceRevision: z.number().int().positive().nullable(),
  endpoint: z.string().nullable(),
  profile: z.record(z.string(), z.json()), descriptor: toolDescriptorSchema,
}).refine(c => (c.serviceId === null) === (c.serviceRevision === null), 'Service identity must be paired')
export const executionBindingSchema = z.strictObject({
  id: z.uuid(), projectId: z.uuid(), generationRecordId: z.uuid(), taskId: z.uuid(),
  createdAt: z.iso.datetime(), formatVersion: z.literal(1),
  configuration: executionConfigurationSchema, configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestFingerprint: z.string(), parameters: capabilitySnapshotSchema,
  authorization: z.strictObject({ approvalId: z.uuid().nullable(), reservationId: z.uuid(), approvalItemId: z.uuid(), currency: z.string(), reservedAmountMicro: z.number().int().nonnegative(), approval: z.json(), item: z.json() }),
  recoveryAllowed: z.boolean(),
})
export type ExecutionConfiguration = z.infer<typeof executionConfigurationSchema>
export type ExecutionBinding = z.infer<typeof executionBindingSchema>
