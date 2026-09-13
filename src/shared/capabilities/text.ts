import { z } from 'zod'
import { promptSchema } from './common.js'

// v1 deliberately supports flat named fields, not arbitrary provider JSON Schema.
const fieldName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/)
export const textStructuredInputSchema = z
  .strictObject({
    instruction: promptSchema,
    sourceText: z.string().min(1).max(200000),
    fields: z
      .array(
        z.strictObject({
          name: fieldName,
          type: z.enum(['string', 'number', 'boolean']),
          description: z.string().max(1000),
        }),
      )
      .min(1)
      .max(64),
  })
  .refine(
    (v) => new Set(v.fields.map((f) => f.name)).size === v.fields.length,
    'Duplicate field',
  )
export const textStructuredOutputSchema = z
  .strictObject({
    fields: z
      .array(
        z.strictObject({
          name: fieldName,
          value: z.union([
            z.string().max(32000),
            z.number().finite(),
            z.boolean(),
          ]),
        }),
      )
      .min(1)
      .max(64),
  })
  .refine(
    (v) => new Set(v.fields.map((f) => f.name)).size === v.fields.length,
    'Duplicate field',
  )
export type TextStructuredInput = z.infer<typeof textStructuredInputSchema>
