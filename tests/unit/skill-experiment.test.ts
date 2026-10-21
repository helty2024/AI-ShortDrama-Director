import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, cp, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Seedance20Loader, assertPortableSkillOutput, assertTargetPromptCompatibility, hash } from '../../electron/main/skills/seedance-20.js'
import { SkillExperimentService, type SkillTextBinding } from '../../electron/main/skills/experiment.js'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { shotSchema } from '../../src/shared/domain.js'
import { skillOutputSchema } from '../../src/shared/skill-experiment.js'
import { CompatibleTextProvider, structuredTextBody } from '../../electron/main/intelligence/provider.js'

const root = resolve('resources/skills/seedance-20')
test('only fixed root registers; disabled is byte-identical; routes and model-specific syntax stay isolated', async () => {
  const loader = new Seedance20Loader(root)
  assert.deepEqual(await new Seedance20Loader('does-not-exist').assemble('original', 'script', 'generic', false), { system: 'original', trace: null })
  const generic = await loader.assemble('original', 'director', 'generic', true)
  assert.equal(generic.trace!.name, 'seedance-20'); assert.equal(generic.trace!.version, '6.7.0')
  assert(generic.trace!.files.length < 19); assert(!generic.trace!.ruleIds.includes('seedance-compiler'))
  assert.doesNotMatch(generic.system, /@Image\d|@Video\d/)
  const seedance = await loader.assemble('original', 'video-prompt', 'seedance-2.0', true)
  assert(seedance.trace!.ruleIds.includes('seedance-compiler'))
  assert(seedance.trace!.files.some(f => f.path === 'skills/seedance-prompt/SKILL.md'))
  assert.notEqual(seedance.trace!.contentHash, generic.trace!.contentHash)
  assert.throws(() => assertPortableSkillOutput({ prompt: 'preserve @Image1' }), /专用绑定/)
  assert.throws(() => assertTargetPromptCompatibility('use @Image1', 'MiniMax-H3'), /非 Seedance/)
  const folder = await mkdtemp(join(tmpdir(), 'skill-integrity-'))
  try { await cp(root, folder, { recursive: true }); await writeFile(join(folder, 'references/directors-read.md'), 'tampered'); await assert.rejects(new Seedance20Loader(folder).assemble('original', 'script', 'generic', true), /hash/) }
  finally { await rm(folder, { recursive: true, force: true }) }
})

async function fixture(fail = false) {
  const dir = await mkdtemp(join(tmpdir(), 'skill-experiment-')), db = new ProjectDatabase(':memory:')
  const project = db.create({ name: 'Skill offline contract', description: '', genre: 'test', language: 'zh-CN', aspectRatio: '9:16' })
  db.insertEntities(project.id, buildSeed(project.id))
  const old = db.workspace(project.id).entities.find(e => e.kind === 'shot')!
  if (old.kind !== 'shot') throw Error()
  const shots = Array.from({ length: 7 }, (_, i) => shotSchema.parse({ ...old, ...metadata(), order: i + 10, plan: { shotNumber: i + 1, shotType: '中景', framing: '桌前', cameraAngle: '平视', focalLengthSuggestion: '50mm', subject: '人物', action: '停笔望向窗外', cameraMovement: '固定', durationSuggestion: 4.5, emotion: '宁静', continuityNotes: '凝视后微笑', characterRefs: old.characterIds, locationRef: old.locationId, propRefs: old.propIds } }))
  db.insertEntities(project.id, shots)
  const calls: { system: string; input: unknown }[] = []
  const snapshot = { real: false, model: 'local-contract-only', revision: 1 }
  const binding: SkillTextBinding = { snapshot, provider: { name: 'local-contract-only', generateStructured: async request => {
    calls.push({ system: request.system, input: request.input }); if (fail) throw Error('simulated lost response')
    const output = { summary: 'Local contract output, not supplier evidence', suggestions: [], continuity56: '', references: [], videoPrompts: [], notApplicable: [] }
    request.onResponse?.({ rawOutput: JSON.stringify(output), model: 'local-contract-only', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } })
    return request.schema.parse(output)
  } } }
  const service = () => new SkillExperimentService(db, new Seedance20Loader(root), dir, () => binding)
  return { db, dir, project, shots, calls, snapshot, service, input: { op: 'prepare' as const, projectId: project.id, stage: 'director' as const, sceneId: old.sceneId, shotIds: shots.map(s => s.id), target: 'generic' as const }, close: async () => { db.close(); await rm(dir, { recursive: true, force: true }) } }
}

test('runtime A/B uses same formal snapshot/model/schema, retains outputs and provenance without modifying production data', async () => {
  const f = await fixture()
  try {
    const service = f.service(), before = JSON.stringify(f.db.workspace(f.project.id))
    const state = await service.execute(f.input)
    assert.equal(f.calls.length, 0); assert.equal(state.experiments.length, 3)
    assert.equal(new Set(state.experiments.map(e => e.inputHash)).size, 1)
    for (const e of state.experiments) { assert.notEqual(e.requests[0].system, e.requests[1].system); assert.deepEqual(e.requests[0].input, e.requests[1].input); assert.equal(e.requests[0].trace, null) }
    const ids = state.experiments.map(e => e.id)
    const command = { op: 'runComparisons' as const, projectId: f.project.id, ids, confirmed: true as const, maxRequests: 6 as const, currency: 'CNY', maxCostMicro: 1000000, allowUnknownCost: true as const }
    await assert.rejects(service.execute({ ...command, maxCostMicro: 0 }))
    assert.equal(f.calls.length, 0)
    const result = await service.execute(command)
    assert.equal(f.calls.length, 6); assert(result.experiments.every(e => e.status === 'completed'))
    assert(result.experiments.every(e => e.modelSnapshot.real === false && e.attempts.every(a => skillOutputSchema.safeParse(a.output).success && a.rawOutput)))
    assert.equal(JSON.stringify(f.db.workspace(f.project.id)), before)
    await assert.rejects(service.execute(command)); assert.equal(f.calls.length, 6)
    const restored = await f.service().execute({ op: 'list', projectId: f.project.id })
    assert.deepEqual(restored.experiments, result.experiments)
    const saved = JSON.parse(await readFile(join(f.dir, f.project.id + '.json'), 'utf8'))
    assert.equal(hash(JSON.stringify(saved.experiments[0].requests[1].input)), saved.experiments[0].inputHash)
  } finally { await f.close() }
})

test('configuration/source changes and unknown execution never retry or consume another request', async () => {
  const f = await fixture(true)
  try {
    const service = f.service(), state = await service.execute(f.input)
    const command = { op: 'runComparisons' as const, projectId: f.project.id, ids: state.experiments.map(e => e.id), confirmed: true as const, maxRequests: 6 as const, currency: 'CNY', maxCostMicro: 1000000, allowUnknownCost: true as const }
    f.snapshot.revision = 2; await assert.rejects(service.execute(command), /配置/); assert.equal(f.calls.length, 0)
    f.snapshot.revision = 1
    const result = await service.execute(command)
    assert.equal(f.calls.length, 1); assert(result.experiments.some(e => e.status === 'unknown'))
    await assert.rejects(f.service().execute(command)); assert.equal(f.calls.length, 1)
    const next = await service.execute(f.input), nextIds = next.experiments.slice(0, 3).map(e => e.id)
    f.db.connection.prepare("UPDATE entities SET data=json_set(data,'$.revision',99) WHERE id=?").run(f.shots[0].id)
    await assert.rejects(service.execute({ ...command, ids: nextIds }), /正式数据/); assert.equal(f.calls.length, 1)
  } finally { await f.close() }
})

test('large historical asset prompts stay outside LLM input while reference provenance remains traceable', async () => {
  const f = await fixture()
  try {
    const asset = f.db.workspace(f.project.id).entities.find(e => e.kind === 'asset')!
    const version = { ...metadata(), projectId: f.project.id, assetId: asset.id, versionNumber: 1, status: 'rejected', hash: 'a'.repeat(64), metadata: { targetId: f.shots[0].id }, prompt: 'historical-only'.repeat(20000), storageKey: 'local/private-file.png' }
    f.db.connection.prepare('INSERT INTO asset_versions VALUES (?,?,?,?,?,?)').run(version.id, f.project.id, asset.id, 1, version.hash, JSON.stringify(version))
    const state = await f.service().execute({ ...f.input, target: 'seedance-2.0' })
    const request = state.experiments.find(e => e.stage === 'video-prompt')!.requests[1]
    const input = request.input as { assetVersions: { id: string; status: string; hash: string }[] }
    assert.equal(input.assetVersions[0]!.id, version.id)
    assert.equal(input.assetVersions[0]!.status, 'rejected')
    assert.equal(input.assetVersions[0]!.hash, version.hash)
    assert.doesNotMatch(JSON.stringify(request.input), /historical-only|local\/private-file/)
    assert(request.bytes < 128 * 1024); assert.equal(f.calls.length, 0)
  } finally { await f.close() }
})

test('director-only authorization permits precisely two requests and persists telemetry without touching other experiments', async () => {
  const f = await fixture()
  try {
    Object.assign(f.snapshot, { sampling: { temperature: 0.7, top_p: 0.8 } })
    const service = f.service(), state = await service.execute({ ...f.input, shotIds: f.shots.slice(4, 6).map(s => s.id) })
    // A changed service default must not replace the already fingerprinted pair.
    Object.assign(f.snapshot, { sampling: null })
    const director = state.experiments.find(e => e.stage === 'director')!
    const command = { op: 'runComparisons' as const, projectId: f.project.id, ids: [director.id], confirmed: true as const, maxRequests: 2 as const, currency: 'CNY', maxCostMicro: 1000000, allowUnknownCost: true as const }
    await assert.rejects(service.execute({ ...command, maxRequests: 6 })); assert.equal(f.calls.length, 0)
    await assert.rejects(service.execute({ ...command, ids: [state.experiments.find(e => e.stage === 'script')!.id] })); assert.equal(f.calls.length, 0)
    const result = await service.execute(command), completed = result.experiments.find(e => e.id === director.id)!
    assert.equal(f.calls.length, 2); assert.equal(completed.status, 'completed')
    assert(completed.attempts.every(a => a.wireFingerprint === hash(a.wireBody!) && a.elapsedMs !== null && a.usage?.totalTokens === 30 && a.responseModel === 'local-contract-only'))
    assert(completed.attempts.every(a => JSON.parse(a.wireBody!).temperature === 0.7 && JSON.parse(a.wireBody!).top_p === 0.8))
    assert(result.experiments.filter(e => e.id !== director.id).every(e => e.status === 'offline' && e.attempts.length === 0))
    await assert.rejects(f.service().execute(command)); assert.equal(f.calls.length, 2)
  } finally { await f.close() }
})

test('preview wire body equals transport body and records raw content plus usage; no random parameter is invented', async () => {
  const config = { baseUrl: 'http://127.0.0.1/v1', model: 'local-contract-only', maxTokens: 4000, outputMode: 'json-prompt' as const }
  const output = { summary: 'Local contract, not real model evidence', suggestions: [], continuity56: '', references: [], videoPrompts: [], notApplicable: [] }, raw = JSON.stringify(output, null, 2)
  let captured = '', usage: number | null = null, rawOutput: string | null = null
  const provider = new CompatibleTextProvider(config, { retries: 0 }, async (_url, init) => {
    captured = String(init?.body)
    return new Response(JSON.stringify({ model: 'local-contract-only', choices: [{ finish_reason: 'stop', message: { content: raw } }], usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 } }))
  })
  const request = { system: 'system', input: { same: true }, schema: skillOutputSchema, schemaName: 'skill_experiment', signal: AbortSignal.timeout(5000), onResponse: (m: { usage: { totalTokens: number | null } | null; rawOutput: string | null }) => { usage = m.usage?.totalTokens ?? null; rawOutput = m.rawOutput } }
  await provider.generateStructured(request)
  assert.equal(captured, JSON.stringify(structuredTextBody(config, request))); assert.equal(usage, 33); assert.equal(rawOutput, raw)
  assert.doesNotMatch(captured, /"(?:temperature|seed|top_p)"/)
  const sampled = { ...request, sampling: { temperature: 0.7, top_p: 0.8 } }
  await provider.generateStructured(sampled)
  assert.equal(captured, JSON.stringify(structuredTextBody(config, sampled)))
  assert.equal(JSON.parse(captured).temperature, 0.7); assert.equal(JSON.parse(captured).top_p, 0.8)
  assert.throws(() => structuredTextBody(config, { ...request, sampling: { temperature: 99, top_p: 0.8 } }))
})
