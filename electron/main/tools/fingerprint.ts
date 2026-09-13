import { createHash } from 'node:crypto'
import { fingerprintMaterialSchema } from '../../../src/shared/generation.js'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return (
    '{' +
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
      .join(',') +
    '}'
  )
}

/** Pure contract utility, no persistence. Parses before hashing, rejects extra fields.
 * Property order is irrelevant, array order is semantic. Stable asset-version IDs
 * are inputs; random run/decision IDs, timestamps and UI state are not inputs.
 * A different decision ID still invalidates approval independently of this hash.
 */
export function requestFingerprint(raw: unknown): string {
  const material = fingerprintMaterialSchema.parse(raw)
  return (
    'sha256:' +
    createHash('sha256').update(canonical(material), 'utf8').digest('hex')
  )
}
