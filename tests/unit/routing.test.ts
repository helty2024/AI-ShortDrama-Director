import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { routingPolicySchema } from '../../src/shared/routing.js'
import { route, type ToolCandidate, type RouteRequest } from '../../electron/main/tools/routing.js'
import { ToolRegistry } from '../../electron/main/tools/registry.js'
import { MockSyncImageTool } from '../fixtures/tools/sync-image.js'
import { context } from '../fixtures/tools/support.js'

const now = '2026-09-15T00:00:00.000Z', later = '2026-09-15T01:00:00.000Z'
const project = randomUUID()
export const policy = () => routingPolicySchema.parse({ version: '1.0.0', selection: { mode: 'AUTO' }, hardConstraints: { locality: 'either', allowAssetUpload: true, budget: null, requiredAvailability: 'available', availableMemoryMB: 16384, availableGpuMemoryMB: 8192, networkAvailable: true, privacy: 'public' }, preferences: { order: ['cost', 'speed', 'quality'], quality: { status: 'unknown' } }, unknown: { cost: 'allow', duration: 'allow', quality: 'allow', resources: 'allow' } })
async function candidate(id = 'a.tool', price = 8000000): Promise<ToolCandidate> {
  const tool = new MockSyncImageTool()
  const descriptor = tool.describe()
  descriptor.id = id
  const input = { prompt: 'Room', negativePrompt: '', resolution: { width: 1024, height: 1024 }, aspectRatio: '1:1' as const, seed: null, count: 1, outputMime: 'image/png' as const }
  const ctx = context(tool.describe(), 'image.generate', input)
  ctx.projectId = project
  const estimate = await tool.estimate('image.generate', input, ctx, new AbortController().signal)
  estimate.createdAt = now; estimate.validUntil = later
  estimate.cost = { status: 'known', estimatedCost: { amountMicros: price, currency: 'USD' } }
  return { descriptor, capability: 'image.generate', model: null, health: { toolId: id, availability: 'available', checkedAt: now, issues: [] }, validation: { valid: true, issues: [], warnings: [], requestFingerprint: ctx.requestFingerprint }, estimate, quality: { status: 'unknown' } }
}
function request(candidates: ToolCandidate[]): RouteRequest { return { id: randomUUID(), projectId: project, createdAt: now, capability: 'image.generate', policy: policy(), candidates } }
function selected(r: ReturnType<typeof route>) { assert.equal(r.ready, true); if (!r.ready) throw new Error('No selection'); return r.decision }

test('registry validates descriptors, rejects conflicting instances, and snapshots identity', () => {
  const registry = new ToolRegistry(), tool = new MockSyncImageTool()
  registry.register(tool); registry.register(tool)
  assert.throws(() => registry.register(new MockSyncImageTool()))
  assert.equal(registry.findByCapability('image.generate').length, 1)
  assert.equal(registry.findByCapability('video.textToVideo').length, 0)
  const entry = registry.get('mock.image', '1.0.0')
  assert.throws(() => { entry.descriptor.id = 'changed.tool' })
  assert.equal(entry.descriptor.availability, 'unknown')
  assert.equal(registry.unregister('mock.image', '1.0.0'), true)
  assert.throws(() => registry.get('mock.image', '1.0.0'))
  const invalid = new MockSyncImageTool()
  invalid.describe = () => ({ ...tool.describe(), id: 'INVALID ID' })
  assert.throws(() => registry.register(invalid))
  invalid.describe = () => { throw { code: 'provider', message: 'SECRET', stack: 'SECRET' } }
  assert.throws(() => registry.register(invalid), (error: unknown) => !JSON.stringify(error).includes('SECRET'))
})

test('FIXED honors tool/version/model and never silently falls back', async () => {
  const a = await candidate(), b = await candidate('b.tool', 1)
  const r = request([a, b])
  r.policy.selection = { mode: 'fixed', toolId: 'a.tool', model: null }
  assert.equal(selected(route(r)).selectedToolId, 'a.tool')
  a.health!.availability = 'unavailable'
  const failed = route(r)
  assert.equal(failed.ready, false)
  if (!failed.ready) assert.equal(failed.error.message, 'fixed-tool-unusable')
  r.policy.selection = { mode: 'fixed', toolId: 'missing.tool', toolVersion: '1.0.0', model: null }
  assert.equal(route(r).ready, false)
  r.policy.selection = { mode: 'fixed', toolId: 'b.tool', toolVersion: '2.0.0', model: null }
  assert.equal(route(r).ready, false)
})

test('capability, privacy, execution mode and health reasons are structured and ordered', async () => {
  const a = await candidate()
  a.capability = 'video.textToVideo'
  a.health!.availability = 'unavailable'
  const r = request([a])
  r.policy.hardConstraints.privacy = 'sensitive-local-only'
  r.policy.hardConstraints.locality = 'local-only'
  const result = route(r)
  assert.equal(result.ready, false)
  if (!result.ready) assert.deepEqual(result.rejectedCandidates.map(c => c.code), ['capability-mismatch', 'privacy-conflict', 'execution-mode-conflict', 'unavailable'])
  r.policy.selection = { mode: 'fixed', toolId: 'a.tool', model: null }
  assert.equal(route(r).ready, false)
})

test('cloud prohibition and asset-upload denial exclude cloud before preferences', async () => {
  for (const constraint of [{ cloudAllowed: false }, { allowAssetUpload: false }, { locality: 'local-only' as const }]) {
    const r = request([await candidate()]); Object.assign(r.policy.hardConstraints, constraint)
    assert.equal(route(r).ready, false)
  }
})

test('local VRAM/memory and network constraints use external snapshots', async () => {
  const a = await candidate()
  a.descriptor.executionMode = 'managed-process'
  for (const cap of a.descriptor.capabilities) { cap.locality = 'local'; cap.resources.memoryMB = { status: 'known', value: 1024 }; cap.resources.gpuMemoryMB = { status: 'known', value: 12000 } }
  const r = request([a])
  assert.equal(route(r).ready, false)
  r.policy.hardConstraints.availableGpuMemoryMB = 16000
  assert.equal(route(r).ready, true)
  r.policy.hardConstraints.availableGpuMemoryMB = null
  r.policy.unknown!.resources = 'reject'
  assert.equal(route(r).ready, false)
  r.policy.unknown!.resources = 'allow'
  assert.equal(route(r).ready, true)
  const cloud = request([await candidate()]); cloud.policy.hardConstraints.networkAvailable = false
  assert.equal(route(cloud).ready, false)
})

test('budget rejects over-limit, unknown and different currency; never implies approval', async () => {
  const a = await candidate(), b = await candidate('b.tool', 12000000), c = await candidate('c.tool')
  c.estimate!.cost = { status: 'unknown', reason: 'not-quoted' }
  const r = request([a, b, c]); r.policy.hardConstraints.budget = { amountMicros: 10000000, currency: 'USD' }
  const decision = selected(route(r))
  assert.equal(decision.selectedToolId, 'a.tool')
  assert.deepEqual(decision.rejectedCandidates.map(c => c.code), ['budget-exceeded', 'unknown-not-allowed'])
  a.estimate!.cost = { status: 'known', estimatedCost: { amountMicros: 1, currency: 'EUR' } }
  assert.equal(route(r).ready, false)
  assert.ok(!('approvalId' in decision))
})

test('known cost ranking and mixed currency comparability', async () => {
  const a = await candidate(), b = await candidate('b.tool', 1)
  assert.equal(selected(route(request([a, b]))).selectedToolId, 'b.tool')
  b.estimate!.cost = { status: 'known', estimatedCost: { amountMicros: 1, currency: 'EUR' } }
  const decision = selected(route(request([b, a])))
  assert.equal(decision.selectedToolId, 'a.tool')
  assert.ok(!decision.decisionReasons.includes('compared-cost'))
})

test('unknown cost and duration policies are explicit, no artificial numeric scores', async () => {
  const a = await candidate(), b = await candidate('b.tool', 1)
  a.estimate!.cost = { status: 'unknown', reason: 'not-quoted' }
  a.estimate!.estimatedDurationRange = { status: 'unknown' }
  const r = request([a, b])
  assert.equal(selected(route(r)).selectedToolId, 'a.tool')
  r.policy.unknown!.cost = 'reject'
  assert.equal(selected(route(r)).selectedToolId, 'b.tool')
  r.policy.unknown!.cost = 'allow'; r.policy.unknown!.duration = 'reject'
  assert.equal(selected(route(r)).selectedToolId, 'b.tool')
})

test('quality uses matching evaluation evidence only', async () => {
  const a = await candidate(), b = await candidate('b.tool')
  const r = request([a, b]); r.policy.preferences.order = ['quality']
  const evaluationId = randomUUID()
  b.quality = { status: 'known', score: 1, evaluationId, evaluationVersion: '1.0.0', evidence: 'Fixture evaluation sample' }
  assert.equal(selected(route(r)).selectedToolId, 'a.tool')
  r.policy.preferences.quality = { status: 'known', evaluationId, evaluationVersion: '1.0.0' }
  r.policy.unknown!.quality = 'reject'
  const decision = selected(route(r))
  assert.equal(decision.selectedToolId, 'b.tool')
  assert.equal(decision.candidateEvidence?.find(c => c.toolId === 'a.tool')?.qualityScore, null)
  b.quality.evaluationVersion = '2.0.0'
  assert.equal(route(r).ready, false)
})

test('stable tie-break ignores registration order and audit identity; decision deeply immutable', async () => {
  const a = await candidate(), b = await candidate('b.tool')
  const r = request([b, a]), first = selected(route(r))
  const second = selected(route({ ...r, id: randomUUID(), createdAt: '2026-09-15T00:00:01.000Z', candidates: [a, b] }))
  assert.notEqual(first.id, second.id)
  assert.equal(first.selectedToolId, second.selectedToolId)
  assert.deepEqual(first.decisionReasons, second.decisionReasons)
  assert.throws(() => { first.hardConstraints.locality = 'cloud-only' })
  assert.throws(() => { first.candidateEvidence![0].cost!.amountMicros = 0 })
  r.policy.hardConstraints.locality = 'cloud-only'
  assert.equal(first.hardConstraints.locality, 'either')
})

test('expired estimates and stale health cannot masquerade as fresh evidence', async () => {
  const a = await candidate()
  a.estimate!.createdAt = '2026-09-14T00:00:00.000Z'; a.estimate!.validUntil = now
  const r = request([a]); r.policy.unknown!.cost = 'reject'
  assert.equal(route(r).ready, false)
  r.policy.unknown!.cost = 'allow'
  assert.ok(!selected(route(r)).decisionReasons.includes('compared-cost'))
  a.health!.checkedAt = '2026-09-14T00:00:00.000Z'
  assert.equal(route(r).ready, false)
})

test('accepted, unknown-submission and completed attempts cannot route again', async () => {
  for (const executionState of ['accepted', 'unknown-submission', 'completed'] as const) {
    const r = request([await candidate()]); r.executionState = executionState
    assert.equal(route(r).ready, false)
  }
})

test('known speed preference uses comparable duration evidence', async () => {
  const a = await candidate(), b = await candidate('b.tool')
  a.estimate!.estimatedDurationRange = { status: 'known', seconds: { min: 10, max: 20 } }
  b.estimate!.estimatedDurationRange = { status: 'known', seconds: { min: 1, max: 2 } }
  const r = request([a, b]); r.policy.preferences.order = ['speed']
  assert.equal(selected(route(r)).selectedToolId, 'b.tool')
})
