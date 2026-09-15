import { z } from 'zod'
import { capabilityIdSchema } from '../../../src/shared/capabilities/common.js'
import { generationEstimateSchema } from '../../../src/shared/generation.js'
import { toolDescriptorSchema, toolHealthSchema, toolValidationSchema } from '../../../src/shared/tools.js'
import { routingPolicySchema, routingDecisionSchema, rejectionCodeSchema, type RoutingPolicy, type RoutingDecision } from '../../../src/shared/routing.js'
import type { Capability } from '../../../src/shared/capabilities/index.js'
import { boundaryError, immutable } from './registry.js'

export const candidateSchema = z.strictObject({
  descriptor: toolDescriptorSchema,
  capability: capabilityIdSchema,
  model: z.string().min(1).max(200).nullable(),
  health: toolHealthSchema.nullable(),
  validation: toolValidationSchema.nullable(),
  estimate: generationEstimateSchema.nullable(),
  quality: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('unknown') }),
    z.strictObject({ status: z.literal('known'), score: z.number().finite().min(0).max(1), evaluationId: z.uuid(), evaluationVersion: z.string().min(1), evidence: z.string().min(1).max(500) }),
  ]),
})
export type ToolCandidate = z.infer<typeof candidateSchema>
export type RejectionCode = z.infer<typeof rejectionCodeSchema>
export interface Rejection { toolId: string; toolVersion: string; code: RejectionCode; reason: string }
export interface RouteRequest {
  id: string
  projectId: string
  createdAt: string
  capability: Capability
  policy: RoutingPolicy
  candidates: readonly ToolCandidate[]
  executionState?: 'not-submitted' | 'accepted' | 'unknown-submission' | 'completed'
}
export type RouteResult = { ready: true; decision: RoutingDecision; candidate: ToolCandidate } | { ready: false; error: ReturnType<typeof boundaryError>; rejectedCandidates: readonly Rejection[] }
const defaults = { cost: 'reject', duration: 'allow', quality: 'allow', resources: 'reject' } as const
const identity = (c: ToolCandidate) => `${c.descriptor.id}@${c.descriptor.version}/${c.model ?? ''}`
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Pure static exclusion; suitable before any adapter receives project content. */
export function staticReasons(c: ToolCandidate, capability: Capability, policy: RoutingPolicy): RejectionCode[] {
  const reasons: RejectionCode[] = []
  const hard = policy.hardConstraints
  const cap = c.descriptor.capabilities.find(v => v.capability === capability)
  if (c.capability !== capability || !cap || (c.model !== null && cap.models.status === 'known' && !cap.models.value.includes(c.model))) reasons.push('capability-mismatch')
  const cloud = c.descriptor.executionMode === 'cloud'
  // Conservative: denying upload denies sending project request content to cloud tools.
  if (cloud && (hard.privacy === 'sensitive-local-only' || !hard.allowAssetUpload)) reasons.push('privacy-conflict')
  if ((cloud && (hard.cloudAllowed === false || hard.locality === 'local-only')) || (!cloud && hard.locality === 'cloud-only')) reasons.push('execution-mode-conflict')
  return reasons
}
function quality(c: ToolCandidate, policy: RoutingPolicy): number | null {
  const q = c.quality, reference = policy.preferences.quality
  return q.status === 'known' && reference.status === 'known' && q.evaluationId === reference.evaluationId && q.evaluationVersion === reference.evaluationVersion ? q.score : null
}
function reasons(c: ToolCandidate, request: RouteRequest): RejectionCode[] {
  const policy = request.policy, hard = policy.hardConstraints, unknown = policy.unknown ?? defaults
  const list = staticReasons(c, request.capability, policy)
  const now = Date.parse(request.createdAt)
  if (!c.health || c.health.toolId !== c.descriptor.id || c.health.availability !== 'available' || Date.parse(c.health.checkedAt) > now || now - Date.parse(c.health.checkedAt) > 60000) list.push('unavailable')
  if (c.validation && (!c.validation.valid || (c.estimate && c.validation.requestFingerprint !== c.estimate.requestFingerprint))) list.push('preflight-invalid')
  const cap = c.descriptor.capabilities.find(v => v.capability === request.capability)
  // GPU/memory requirements describe this host only for local tools, not cloud servers.
  if (c.descriptor.executionMode !== 'cloud') {
    for (const resources of [cap?.resources, c.descriptor.runtimeRequirements]) {
      if (!resources) continue
      for (const [required, available] of [[resources.memoryMB, hard.availableMemoryMB], [resources.gpuMemoryMB, hard.availableGpuMemoryMB]] as const) {
        if (required.status === 'known' && required.value === 0) continue
        if (required.status === 'known' && available !== null) { if (required.value > available) list.push('resource-insufficient') }
        else if (unknown.resources === 'reject') list.push('unknown-not-allowed')
      }
    }
  }
  if (c.descriptor.executionMode === 'cloud' || c.descriptor.executionMode === 'local-service') {
    if (hard.networkAvailable === false) list.push('resource-insufficient')
    else if (hard.networkAvailable == null && unknown.resources === 'reject') list.push('unknown-not-allowed')
  }
  const quote = c.estimate
  const fresh = quote && Date.parse(quote.createdAt) <= now && Date.parse(quote.validUntil) > now && quote.projectId === request.projectId
  const cost = fresh && quote.cost.status === 'known' ? quote.cost.estimatedCost : null
  if (!cost && (hard.budget !== null || unknown.cost === 'reject')) list.push('unknown-not-allowed')
  if (cost && hard.budget && (cost.currency !== hard.budget.currency || cost.amountMicros > hard.budget.amountMicros)) list.push('budget-exceeded')
  if ((!fresh || quote.estimatedDurationRange.status === 'unknown') && unknown.duration === 'reject') list.push('unknown-not-allowed')
  if (quality(c, policy) === null && unknown.quality === 'reject') list.push('unknown-not-allowed')
  return [...new Set(list)]
}
/** Pure routing: IDs/time are supplied audit fields, never preference inputs. */
export function route(raw: RouteRequest): RouteResult {
  z.uuid().parse(raw.id)
  z.uuid().parse(raw.projectId)
  z.iso.datetime().parse(raw.createdAt)
  capabilityIdSchema.parse(raw.capability)
  const policy = routingPolicySchema.parse(raw.policy)
  const request = { ...raw, policy }
  const candidates = raw.candidates.map(c => {
    const parsed = candidateSchema.parse(c)
    if (parsed.estimate && (Date.parse(parsed.estimate.validUntil) <= Date.parse(raw.createdAt) || Date.parse(parsed.estimate.createdAt) > Date.parse(raw.createdAt) || parsed.estimate.projectId !== raw.projectId)) parsed.estimate = null
    return parsed
  }).sort((a, b) => compareText(identity(a), identity(b)))
  if (new Set(candidates.map(identity)).size !== candidates.length) throw boundaryError('preflight-invalid')
  if (raw.executionState && raw.executionState !== 'not-submitted') return immutable({ ready: false, error: boundaryError('preflight-invalid'), rejectedCandidates: [] })
  const rejected: Rejection[] = [], eligible: ToolCandidate[] = []
  for (const c of candidates) {
    const codes = reasons(c, request)
    const fixed = policy.selection
    if (fixed.mode === 'fixed' && (fixed.toolId !== c.descriptor.id || (fixed.toolVersion !== undefined && fixed.toolVersion !== c.descriptor.version) || fixed.model !== c.model)) codes.push('fixed-tool-unusable')
    if (codes.length) for (const code of new Set(codes)) rejected.push({ toolId: c.descriptor.id, toolVersion: c.descriptor.version, code, reason: code })
    else eligible.push(c)
  }
  if (!eligible.length) return immutable({ ready: false, error: boundaryError(policy.selection.mode === 'fixed' ? 'fixed-tool-unusable' : 'routing-no-candidate'), rejectedCandidates: rejected })
  // Rank a dimension only when every eligible candidate has comparable evidence.
  // This avoids invented unknown scores and non-transitive pairwise comparators.
  const dimensions = policy.preferences.order.filter(dimension => {
    if (dimension === 'quality') return eligible.every(c => quality(c, policy) !== null)
    if (dimension === 'speed') return eligible.every(c => c.estimate?.estimatedDurationRange.status === 'known')
    return eligible.every(c => c.estimate?.cost.status === 'known') && new Set(eligible.map(c => c.estimate?.cost.status === 'known' ? c.estimate.cost.estimatedCost.currency : '')).size === 1
  })
  const score = (c: ToolCandidate, dimension: 'cost' | 'speed' | 'quality') => dimension === 'quality' ? -(quality(c, policy) ?? 0) : dimension === 'cost' ? (c.estimate?.cost.status === 'known' ? c.estimate.cost.estimatedCost.amountMicros : 0) : (c.estimate?.estimatedDurationRange.status === 'known' ? c.estimate.estimatedDurationRange.seconds.max : 0)
  eligible.sort((a, b) => {
    for (const dimension of dimensions) { const delta = score(a, dimension) - score(b, dimension); if (delta) return delta }
    return compareText(identity(a), identity(b))
  })
  const selected = eligible[0]
  const candidateEvidence = candidates.map(c => ({ toolId: c.descriptor.id, toolVersion: c.descriptor.version, model: c.model, healthCheckedAt: c.health?.checkedAt ?? null, estimateId: c.estimate?.id ?? null, cost: c.estimate?.cost.status === 'known' ? c.estimate.cost.estimatedCost : null, durationMaxSeconds: c.estimate?.estimatedDurationRange.status === 'known' ? c.estimate.estimatedDurationRange.seconds.max : null, qualityScore: quality(c, policy), qualityEvidence: c.quality.status === 'known' && quality(c, policy) !== null ? c.quality.evidence : null }))
  const decision = routingDecisionSchema.parse({ id: request.id, projectId: request.projectId, workflowRunId: null, stepRunId: null, requestedCapability: request.capability, contractVersion: '1.0.0', routingMode: policy.selection, selectedToolId: selected.descriptor.id, selectedToolVersion: selected.descriptor.version, selectedModel: selected.model, decisionReasons: ['hard-constraints-passed', ...dimensions.map(d => `compared-${d}`), 'stable-tool-version-model-tie-break'], rejectedCandidates: rejected, hardConstraints: policy.hardConstraints, preferenceInputs: policy.preferences, policyVersion: '1.0.0', policySnapshot: policy, candidateEvidence, createdAt: request.createdAt })
  return immutable({ ready: true, decision, candidate: selected })
}
