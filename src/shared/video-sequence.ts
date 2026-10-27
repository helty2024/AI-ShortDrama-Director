import { z } from 'zod'

// Drafts also retain temporarily invalid trims so reopening never silently
// substitutes an older, exportable edit. An empty list retains the revision
// after the final clip is removed. Export applies the stricter nonempty schema.
const draftClipSchema = z.strictObject({
  shotId: z.uuid(), versionId: z.uuid(),
  inSeconds: z.number().finite(), outSeconds: z.number().finite(),
})
export const sequenceDraftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  clips: z.array(draftClipSchema).max(100),
})
export const sequenceDraftClipsSchema = sequenceDraftSchema.shape.clips
export type SequenceDraft = z.infer<typeof sequenceDraftSchema>
