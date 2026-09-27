import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { workflowFixture } from '../fixtures/workflow.js'
import { generationFixture } from '../fixtures/provenance.js'
import { comfyServer } from '../fixtures/comfyui-http.js'
import { imageServer } from '../fixtures/image-http.js'
import { LineageService } from '../../electron/main/generation/lineage.js'
import { toolReadiness } from '../../electron/main/tools/readiness.js'
import { ToolRegistry } from '../../electron/main/tools/registry.js'
import { ComfyUIToolAdapter } from '../../electron/main/tools/adapters/comfyui.js'
import { PackyImage25Adapter, type PackyImage25Profile } from '../../electron/main/tools/adapters/packy-image-25.js'
import { imageAdapters } from '../../electron/main/generation/image-profiles.js'
import { AITaskQueue } from '../../electron/main/intelligence/queue.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { MockTextProvider } from '../../electron/main/intelligence/mock-provider.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import { requestSchema } from '../../src/shared/api.js'
import { moneyLabel, productionMessage } from '../../src/shared/compatibility.js'
import { backupProject, restoreProject } from '../../electron/main/operations/backup.js'

test('one workflow confirmation creates one execution chain; lineage remains complete through adopt and read-only restore', async () => {
  const f = await workflowFixture()
  try {
    const run = await f.create(); await f.confirm(run.run.id)
    const versionId = f.get(run.run.id).steps[1].relatedAssetVersionId!
    const lineage = new LineageService(f.db)
    assert.equal(lineage.version(f.project.id, versionId).status, 'draft')
    await f.review(run.run.id, 'approve-candidate')
    assert.equal(lineage.version(f.project.id, versionId).status, 'approved')
    await f.review(run.run.id, 'adopt-candidate')
    const result = lineage.version(f.project.id, versionId)
    assert.equal(result.source, 'Generated'); assert.equal(result.status, 'Adopted')
    for (const key of ['outputId','recordId','taskId','routingDecisionId','promptPackageId','stepRunId','workflowRunId'] as const) assert.ok(result.links[key])
    assert.equal(result.links.workflowRunId, run.run.id)
    assert.ok(result.fields.some(v => v.label === 'Execution Mode' && v.value === 'local-service'))
    for (const table of ['ai_tasks','generation_records','approval_reservations','asset_versions'])
      assert.equal(f.db.connection.prepare(`SELECT count(*) n FROM ${table} WHERE project_id=?`).get(f.project.id)!.n, 1)
    assert.equal(f.db.workspace(f.project.id).entities.filter(e => e.kind === 'generationTask').length, 0)
    const folder = await backupProject(f.services.visual, f.project.id, f.dir)
    const restored = await restoreProject(f.services.visual, folder)
    const next = f.services.workflow.repository.list(restored.id)[0]
    const output = lineage.version(restored.id, next.resultSummary.assetVersionId!)
    assert.equal(output.status, 'Adopted')
    assert.notEqual(output.links.recordId, result.links.recordId)
    const task = f.services.image.generation.task(restored.id, output.links.taskId!)
    assert.equal(task.providerTaskId, null); assert.equal(task.historicalProviderTaskId, f.imageServer.promptId)
    assert.equal(task.executionAllowed, false); assert.equal(next.executionAllowed, false)
    assert.ok(output.fields.some(v => v.label === 'Reservation' && v.value.startsWith('historical')))
    const queue = new AITaskQueue(new IntelligenceRepository(f.db), new MockTextProvider())
    try { assert.throws(() => queue.retry(restored.id, task.id)) } finally { queue.close() }
    await f.services.image.recover(restored.id, task.id)
    assert.equal(f.imageServer.counts.submit, 1)
    const outsider = f.db.create({ name: 'other', description: '', genre: 'test', language: 'en', aspectRatio: '1:1' })
    assert.throws(() => lineage.version(outsider.id, versionId))
  } finally { await f.close() }
})

test('legacy missing provenance is not invented; import has independent lineage', async () => {
  const f = await generationFixture()
  try {
    const lineage = new LineageService(f.db), p = f.project.id, v = f.versions[4]
    assert.equal(lineage.version(p, f.versions[0].id).source, 'Legacy / provenance unavailable')
    const id = randomUUID()
    f.repository.create('import_provenance', { id, projectId: p, source: 'file-import', outputAssetVersionIds: [v.id], contentHash: `sha256:${v.hash}`, importedAt: v.createdAt, description: 'fixture', originalName: 'fixture.png', originalMime: v.mimeType, sourceApplication: null })
    const imported = lineage.version(p, v.id)
    assert.equal(imported.source, 'Imported'); assert.equal(imported.links.importId, id)
    assert.equal(imported.links.recordId, null); assert.equal(f.repository.list('generation_records', p).length, 0)
  } finally { f.db.close() }
})

test('unknown submission query is read-only and distinguishes unknown cost from zero', async () => {
  const f = await generationFixture()
  try {
    f.service.recordAttempt(f.record); f.service.failAttempt(f.project.id, f.record.id, 'unknown-submission')
    const before = f.repository.getRecord(f.project.id, f.record.id)
    const result = new LineageService(f.db).generation(f.project.id, f.record.id)
    assert.ok(result.fields.some(v => v.label === 'Outcome' && v.value.includes('不会自动重试')))
    assert.ok(result.fields.some(v => v.label === 'Actual Cost' && v.value.includes('unknown')))
    assert.deepEqual(f.repository.getRecord(f.project.id, f.record.id), before)
    assert.match(moneyLabel({ amountMicros: 0, currency: 'USD' }), /known zero/)
    assert.match(moneyLabel({ amountMicros: 400000, currency: 'USD' }), /known non-zero/)
    assert.match(productionMessage('pending-unknown'), /预算继续持有/)
  } finally { f.db.close() }
})

for (const mode of ['ok', 'missing-model', 'missing-node'] as const) test(`Comfy readonly runtime ${mode} is separate from historical real validation`, async () => {
  const server = await comfyServer(mode), registry = new ToolRegistry()
  registry.register(new ComfyUIToolAdapter(server.profile))
  try {
    const [row] = await toolReadiness([registry], async () => false)
    assert.equal(row.validation, 'real-local-validated')
    assert.equal(row.runtime, mode === 'ok' ? 'ready-for-configured-template' : 'capability-blocked')
    assert.equal(server.counts.submit, 0); assert.equal(server.counts.upload, 0)
    assert.equal(server.counts.health, 1); assert.equal(server.counts.objectInfo, 1)
  } finally { await server.close() }
  const [offline] = await toolReadiness([registry], async () => false)
  assert.equal(offline.runtime, 'offline'); assert.equal(offline.validation, 'real-local-validated')
})

test('Packy partial evidence and credential presence never claim live E2E or invoke credential/network', async () => {
  const profile: PackyImage25Profile = { adapter: 'packy-image-25', toolId: 'packy.image-25', displayName: 'PackyAPI · GPT Image 2.5 Sunburst', modelId: 'gpt-image-2.5-sunburst', tokenGroup: 'image', credentialRef: null, currency: 'USD' }
  const registry = new ToolRegistry()
  registry.register(new PackyImage25Adapter(profile, async () => { throw new Error('must never read secret') }))
  for (const present of [false, true]) {
    const rows = await toolReadiness([registry], async () => present)
    assert.equal(rows[0].validation, 'real-generation-partially-validated')
    assert.equal(rows[0].runtime, present ? 'configured-unverified' : 'configuration-required')
    assert.equal(rows.find(r => r.toolId === 'real-video')?.validation, 'not-validated')
  }
})

test('reference profiles excluded from production composition, explicit fixture opt-in only', async () => {
  const server = await imageServer()
  try {
    const credentials = { get: async () => 'FIXTURE-ONLY', set: async () => {}, has: async () => true }
    assert.equal(imageAdapters([server.profile], credentials).length, 0)
    assert.equal(imageAdapters([server.profile], credentials, true).length, 1)
    assert.equal(server.counts.submit, 0)
  } finally { await server.close() }
})

test('legacy queue neither mutates nor retries or starts production tasks', async () => {
  const f = await generationFixture()
  const task = aiTaskSchema.parse({ ...f.task, input: { type: 'video-api', targetId: f.target.id }, status: 'running', providerTaskId: 'fixture-accepted' })
  f.db.connection.prepare('UPDATE ai_tasks SET data=? WHERE id=?').run(JSON.stringify(task), task.id)
  const repo = new IntelligenceRepository(f.db), queue = new AITaskQueue(repo, new MockTextProvider())
  try {
    assert.deepEqual(repo.task(f.project.id, task.id), task)
    queue.cancelProject(f.project.id)
    assert.deepEqual(repo.task(f.project.id, task.id), task)
    assert.throws(() => queue.retry(f.project.id, task.id))
    assert.throws(() => queue.cancel(f.project.id, task.id))
    assert.throws(() => queue.start(f.project.id, task.input))
  } finally { queue.close(); f.db.close() }
})

test('compatibility IPC only accepts scoped readonly IDs, rejects paths URLs and writes', () => {
  const base = { action: 'compatibility', command: { op: 'lineage', projectId: randomUUID(), versionId: randomUUID() } }
  assert.equal(requestSchema.safeParse(base).success, true)
  for (const field of ['dbPath','url','cost','status','parameters'])
    assert.equal(requestSchema.safeParse({ ...base, command: { ...base.command, [field]: 'forbidden' } }).success, false)
  assert.equal(requestSchema.safeParse({ action: 'compatibility', command: { op: 'write' } }).success, false)
})
