import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { orderedShots, shotGroups, officialVersion, shotCandidates, shotStatus, videoStatusWithReadiness } from '../../src/features/storyboard/storyboard-model.js'
import { currencyToMicro } from '../../src/features/generate/cost.js'
import { videoToolReady } from '../../src/features/generate/readiness.js'
import { compileShotKeyframePrompt } from '../../electron/main/visual/prompt-compiler.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { IntelligenceService } from '../../electron/main/intelligence/service.js'
import { AITaskQueue } from '../../electron/main/intelligence/queue.js'
import { MockTextProvider } from '../../electron/main/intelligence/mock-provider.js'
import { assetVersionSchema } from '../../src/shared/visual.js'
import type { AssetVersion } from '../../src/shared/visual.js'

test('currency input converts precisely to safe integer micro units', () => {
  for (const [value, expected] of [['0', 0], ['0.5', 500000], ['0.000001', 1], ['123.456789', 123456789], ['9007199254.740991', Number.MAX_SAFE_INTEGER]] as const)
    assert.equal(currencyToMicro(value), expected)
  for (const value of ['', 'NaN', '-1', '1.0000001', '1e2', '9007199254.740992', '01', '.5'])
    assert.equal(currencyToMicro(value), null)
})

test('no video profile is unavailable and cannot pass the create guard', () => {
  assert.equal(videoToolReady([], ''), false)
  assert.equal(videoToolReady([], 'reference-video'), false)
  assert.equal(videoStatusWithReadiness('待生成', false), '不可用')
  assert.equal(videoStatusWithReadiness('准备就绪', false), '不可用')
  assert.equal(videoStatusWithReadiness('已确认', false), '已确认')
  assert.equal(videoToolReady([{ toolId: 'reference-video' }], 'reference-video'), true)
})

test('Keyframe compiler ignores legacy imagePrompt and uses editable Shot semantics', () => {
  const db = new ProjectDatabase(':memory:')
  try {
    const project = db.seed(buildSeed)
    const entities = db.workspace(project.id).entities
    const shot = entities.find((e) => e.kind === 'shot')!
    if (shot.kind !== 'shot') throw new Error('fixture')
    const a = compileShotKeyframePrompt({ ...shot, imagePrompt: 'LEGACY SHOULD NOT BE SUBMITTED', description: '真实画面' }, entities)
    const b = compileShotKeyframePrompt({ ...shot, imagePrompt: 'CHANGED LEGACY', description: '真实画面' }, entities)
    assert.equal(a.positivePrompt, b.positivePrompt)
    assert.ok(!a.positivePrompt.includes('LEGACY SHOULD NOT BE SUBMITTED'))
  } finally { db.close() }
})

test('Shot description/plan save is revision-checked and keeps videoPrompt intact', () => {
  const db = new ProjectDatabase(':memory:')
  const repo = new IntelligenceRepository(db)
  const queue = new AITaskQueue(repo, new MockTextProvider())
  try {
    const project = db.seed(buildSeed)
    const shot = db.workspace(project.id).entities.find((e) => e.kind === 'shot')!
    if (shot.kind !== 'shot') throw new Error('fixture')
    const service = new IntelligenceService(repo, queue)
    const saved = service.execute({ operation: 'shot.save', projectId: project.id, id: shot.id, expectedRevision: shot.revision,
      description: '雨夜古桥', plan: shot.plan && { ...shot.plan, action: '擦肩回眸' } })
    if (!saved || !('kind' in saved) || saved.kind !== 'shot') throw new Error('save failed')
    assert.equal(saved.description, '雨夜古桥')
    assert.equal(saved.videoPrompt, shot.videoPrompt)
    assert.throws(() => service.execute({ operation: 'shot.save', projectId: project.id, id: shot.id, expectedRevision: shot.revision,
      description: 'stale', plan: shot.plan }), /数据已更新/)
  } finally { queue.close(); db.close() }
})

test('Shot scene-local reorder validates full membership and safe deletion retains production history', () => {
  const db = new ProjectDatabase(':memory:')
  const repo = new IntelligenceRepository(db)
  const queue = new AITaskQueue(repo, new MockTextProvider())
  try {
    const project = db.seed(buildSeed)
    const entities = db.workspace(project.id).entities
    const scene = entities.find((e) => e.kind === 'scene')!
    const board = entities.find((e) => e.kind === 'storyboard')!
    const created = db.createDraft({ projectId: project.id, kind: 'shot', name: '可删除草稿', parentId: board.id, sceneId: scene.id })
    if (created.kind !== 'shot') throw new Error('fixture')
    const shots = db.workspace(project.id).entities.filter((e) => e.kind === 'shot' && e.sceneId === scene.id)
    const ids = shots.map((shot) => shot.id).reverse()
    const service = new IntelligenceService(repo, queue)
    assert.throws(() => service.execute({ operation: 'shots.reorder', projectId: project.id, id: scene.id, expectedRevision: scene.revision, shotIds: ids.slice(1) }), /全部镜头/)
    service.execute({ operation: 'shots.reorder', projectId: project.id, id: scene.id, expectedRevision: scene.revision, shotIds: ids })
    assert.deepEqual(orderedShots(db.workspace(project.id).entities).filter((e) => e.sceneId === scene.id).map((e) => e.id), ids)
    const current = repo.entity(project.id, created.id)
    service.execute({ operation: 'shot.delete', projectId: project.id, id: current.id, expectedRevision: current.revision })
    assert.equal(db.workspace(project.id).entities.some((e) => e.id === created.id), false)
  } finally { queue.close(); db.close() }
})

test('Shot board stays continuous through 30 and groups by Scene beyond 30 without mutating order', () => {
  const db = new ProjectDatabase(':memory:')
  try {
    const project = db.seed(buildSeed)
    const entities = db.workspace(project.id).entities
    const board = entities.find((e) => e.kind === 'storyboard')!
    const scenes = entities.filter((e) => e.kind === 'scene')
    const before = orderedShots(entities)
    assert.equal(shotGroups(entities).length, 1)
    assert.equal(shotGroups(entities)[0]?.shots.length, before.length)
    for (let index = before.length; index < 31; index++) db.createDraft({ projectId: project.id, kind: 'shot', name: `补充镜头 ${index}`, parentId: board.id, sceneId: scenes[index % scenes.length]!.id })
    const expanded = db.workspace(project.id).entities
    const groups = shotGroups(expanded)
    assert.ok(groups.length > 1)
    assert.deepEqual(groups.flatMap((group) => group.shots.map((shot) => shot.id)), orderedShots(expanded).map((shot) => shot.id))
    assert.equal(shotGroups(expanded).length, groups.length)
    assert.equal(db.workspace(project.id).entities.filter((e) => e.kind === 'shot').length, 31)
  } finally { db.close() }
})

test('Shot official binding uses the pinned version, never a newer candidate', () => {
  const db = new ProjectDatabase(':memory:')
  try {
    const project = db.seed(buildSeed)
    const entities = db.workspace(project.id).entities
    const shot = entities.find((e) => e.kind === 'shot')!
    const asset = entities.find((e) => e.kind === 'asset')!
    if (shot.kind !== 'shot' || asset.kind !== 'asset') throw new Error('fixture')
    const version = (status: AssetVersion['status']): AssetVersion => assetVersionSchema.parse({ id: randomUUID(), projectId: project.id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1, assetId: asset.id, versionNumber: 1, status, sourceType: 'generated', mimeType: 'image/png', width: 32, height: 32, fileSize: 32, hash: 'a'.repeat(64), storageKey: 'test', thumbnailPath: 'test', provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: { targetId: shot.id } })
    const draft = version('draft')
    assert.equal(officialVersion(shot, 'keyframe', entities, [draft]), undefined)
    assert.equal(shotCandidates(shot, 'keyframe', [draft], [])[0]?.id, draft.id)
    assert.equal(shotStatus(shot, 'keyframe', entities, [draft], [], []), '待审核')
    const pinned = version('archived')
    const bound = { ...shot, approvedKeyframeAssetId: asset.id, approvedKeyframeVersionId: pinned.id }
    assert.equal(officialVersion(bound, 'keyframe', entities, [draft, pinned])?.id, pinned.id)
    assert.equal(shotStatus(bound, 'keyframe', entities, [draft, pinned], [], []), '已确认')
  } finally { db.close() }
})
