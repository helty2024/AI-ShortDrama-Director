import type { Capability } from '../../../src/shared/capabilities/index.js'
import { toolDescriptorSchema, type ToolDescriptor, type ToolError } from '../../../src/shared/tools.js'
import type { ToolAdapter } from './protocol.js'
import { normalizeToolError } from './errors.js'

export type BoundaryReason = 'tool-not-registered' | 'capability-not-supported' | 'tool-unavailable' | 'preflight-invalid' | 'estimate-expired' | 'ownership-mismatch' | 'output-not-issued' | 'routing-no-candidate' | 'fixed-tool-unusable'
export function boundaryError(reason: BoundaryReason): ToolError {
  const code = reason === 'ownership-mismatch' || reason === 'output-not-issued' ? 'authorization' : reason === 'tool-unavailable' ? 'dependency' : 'validation'
  return { ...normalizeToolError({ code }), message: reason }
}
export function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child)
    Object.freeze(value)
  }
  return value
}
export interface RegisteredTool {
  readonly descriptor: ToolDescriptor
  readonly adapter: ToolAdapter<Capability>
}
const key = (id: string, version: string) => `${id}@${version}`
export class ToolRegistry {
  private readonly entries = new Map<string, RegisteredTool>()
  // Only trusted main-process composition code may register adapters. No discovery/loading.
  register(adapter: ToolAdapter<never>): void {
    let description: unknown
    try { description = adapter.describe() }
    catch (raw) { throw normalizeToolError(raw) }
    const parsed = toolDescriptorSchema.safeParse(description)
    if (!parsed.success) throw boundaryError('preflight-invalid')
    const descriptor = immutable(parsed.data)
    const identity = key(descriptor.id, descriptor.version)
    const existing = this.entries.get(identity)
    if (existing) {
      if (existing.adapter !== adapter || JSON.stringify(existing.descriptor) !== JSON.stringify(descriptor)) throw boundaryError('preflight-invalid')
      return
    }
    // Erasure is internal; every Broker operation checks the registered capability first.
    this.entries.set(identity, Object.freeze({ descriptor, adapter: adapter as ToolAdapter<Capability> }))
  }
  unregister(id: string, version: string): boolean { return this.entries.delete(key(id, version)) }
  get(id: string, version: string): RegisteredTool {
    const entry = this.entries.get(key(id, version))
    if (!entry) throw boundaryError('tool-not-registered')
    return entry
  }
  list(): readonly RegisteredTool[] {
    return Object.freeze([...this.entries.values()].sort((a, b) => {
      const x = key(a.descriptor.id, a.descriptor.version), y = key(b.descriptor.id, b.descriptor.version)
      return x < y ? -1 : x > y ? 1 : 0
    }))
  }
  findByCapability(capability: Capability): readonly RegisteredTool[] {
    return Object.freeze(this.list().filter(e => e.descriptor.capabilities.some(c => c.capability === capability)))
  }
}
