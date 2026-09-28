import { z } from 'zod'
import { imageApiCommandSchema } from '../../shared/image-api'
import type { ImageApiCommand } from '../../shared/image-api'
import { videoApiCommandSchema } from '../../shared/video-api'
import type { VideoApiCommand } from '../../shared/video-api'
import { aiTaskSchema } from '../../shared/intelligence'
import { persistedRecordSchema } from '../../shared/provenance'
import { assetVersionSchema } from '../../shared/visual'
import { reservationStatusSchema } from '../../shared/approval'

export const imageProfilesSchema = z.array(z.object({ toolId: z.string(), displayName: z.string(), executionMode: z.string(), capabilities: z.array(z.string()), resolutions: z.object({ status: z.string(), value: z.array(z.object({ width: z.number(), height: z.number() })).optional() }), model: z.object({ status: z.string(), value: z.array(z.string()).optional() }) }))
export const videoProfilesSchema = z.array(z.object({ toolId: z.string(), displayName: z.string(), capabilities: z.array(z.string()), durations: z.array(z.number()), resolutions: z.array(z.object({ width: z.number(), height: z.number() })), aspectRatios: z.array(z.string()) }))
export const directQuerySchema = z.object({ task: aiTaskSchema, record: persistedRecordSchema, reservationStatus: reservationStatusSchema.nullable(), versions: z.array(assetVersionSchema) })

export async function imageCommand(command: ImageApiCommand): Promise<unknown> {
  const response = await window.desktop!.workspace.request({ action: 'imageApi', command: imageApiCommandSchema.parse(command) })
  if (!response.ok) throw new Error(response.message)
  return response.data
}
export async function videoCommand(command: VideoApiCommand): Promise<unknown> {
  const response = await window.desktop!.workspace.request({ action: 'videoApi', command: videoApiCommandSchema.parse(command) })
  if (!response.ok) throw new Error(response.message)
  return response.data
}
