import { z } from 'zod'
import {
  textStructuredInputSchema,
  textStructuredOutputSchema,
} from './text.js'
import {
  imageGenerateInputSchema,
  imageGenerateOutputSchema,
  imageReferenceGenerateInputSchema,
  imageReferenceGenerateOutputSchema,
} from './image.js'
import {
  videoTextToVideoInputSchema,
  videoTextToVideoOutputSchema,
  videoImageToVideoInputSchema,
  videoImageToVideoOutputSchema,
} from './video.js'
import {
  scenePrevizInputSchema,
  scenePrevizOutputSchema,
  sceneRenderInputSchema,
  sceneRenderOutputSchema,
} from './scene.js'
import {
  mediaTranscodeInputSchema,
  mediaTranscodeOutputSchema,
} from './media.js'

// Schema catalogue only: no tools, services, dynamic loading or routing.
export const capabilityContracts = {
  'text.structured': {
    version: '1.0.0',
    input: textStructuredInputSchema,
    output: textStructuredOutputSchema,
  },
  'image.generate': {
    version: '1.0.0',
    input: imageGenerateInputSchema,
    output: imageGenerateOutputSchema,
  },
  'image.referenceGenerate': {
    version: '1.0.0',
    input: imageReferenceGenerateInputSchema,
    output: imageReferenceGenerateOutputSchema,
  },
  'video.textToVideo': {
    version: '1.0.0',
    input: videoTextToVideoInputSchema,
    output: videoTextToVideoOutputSchema,
  },
  'video.imageToVideo': {
    version: '1.0.0',
    input: videoImageToVideoInputSchema,
    output: videoImageToVideoOutputSchema,
  },
  'scene.previz': {
    version: '1.0.0',
    input: scenePrevizInputSchema,
    output: scenePrevizOutputSchema,
  },
  'scene.render': {
    version: '1.0.0',
    input: sceneRenderInputSchema,
    output: sceneRenderOutputSchema,
  },
  'media.transcode': {
    version: '1.0.0',
    input: mediaTranscodeInputSchema,
    output: mediaTranscodeOutputSchema,
  },
} as const
export type Capability = keyof typeof capabilityContracts
export type CapabilityInput<C extends Capability> = z.infer<
  (typeof capabilityContracts)[C]['input']
>
export type CapabilityOutput<C extends Capability> = z.infer<
  (typeof capabilityContracts)[C]['output']
>

// A provenance snapshot union, not a universal tool request. Each input retains its schema.
function snapshot<C extends Capability, S extends z.ZodType>(
  capability: C,
  input: S,
) {
  return z.strictObject({
    capability: z.literal(capability),
    contractVersion: z.literal('1.0.0'),
    input,
  })
}
export const capabilitySnapshotSchema = z.discriminatedUnion('capability', [
  snapshot('text.structured', textStructuredInputSchema),
  snapshot('image.generate', imageGenerateInputSchema),
  snapshot('image.referenceGenerate', imageReferenceGenerateInputSchema),
  snapshot('video.textToVideo', videoTextToVideoInputSchema),
  snapshot('video.imageToVideo', videoImageToVideoInputSchema),
  snapshot('scene.previz', scenePrevizInputSchema),
  snapshot('scene.render', sceneRenderInputSchema),
  snapshot('media.transcode', mediaTranscodeInputSchema),
])
