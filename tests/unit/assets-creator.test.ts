import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { assetVersionSchema } from '../../src/shared/visual.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import { resolveCreatorAsset } from '../../src/features/assets/creator-assets.js'
import type { AssetVersion } from '../../src/shared/visual.js'

test('Creator Asset primary resolution and statuses never promote unrelated or legacy versions', () => {
  const db = new ProjectDatabase(':memory:')
  try {
    const project = db.seed(buildSeed)
    const character = db.workspace(project.id).entities.find((entity) => entity.kind === 'character')!
    assert.equal(character.kind, 'character')
    if (character.kind !== 'character') throw new Error('fixture')
    const a = db.createDraft({ projectId: project.id, kind: 'asset', name: 'A' })
    const b = db.createDraft({ projectId: project.id, kind: 'asset', name: 'B' })
    assert.equal(a.kind, 'asset')
    assert.equal(b.kind, 'asset')
    if (a.kind !== 'asset' || b.kind !== 'asset') throw new Error('fixture')
    const version = (assetId: string, status: AssetVersion['status'], number: number, mimeType: AssetVersion['mimeType'] = 'image/png'): AssetVersion => {
      const id = randomUUID()
      return assetVersionSchema.parse({ ...metadata(), id, projectId: project.id, assetId, versionNumber: number, status, sourceType: 'imported', mimeType,
        width: 320, height: 240, fileSize: 1, hash: 'a'.repeat(64), storageKey: `${project.id}/${assetId}/${id}.png`, thumbnailPath: `${project.id}/${assetId}/${id}-thumb.webp`, provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: { targetId: character.id } })
    }
    const a1 = version(a.id, 'approved', 1)
    const a2 = version(a.id, 'draft', 2)
    const b1 = version(b.id, 'draft', 1)
    const video = version(b.id, 'draft', 2, 'video/mp4')
    const base = db.workspace(project.id).entities.filter((entity) => entity.id !== a.id && entity.id !== b.id)
    const target = { ...character, visualReferences: [{ assetId: a.id, role: 'faceReference' as const, primary: true }], assetIds: [a.id, b.id] }
    const entities = [...base.filter((entity) => entity.id !== character.id), target, { ...a, approvedVersionId: a1.id }, b]
    const view = resolveCreatorAsset(target, entities, [a1, a2, b1, video])
    assert.equal(view.primaryVersion?.id, a1.id)
    assert.equal(view.status, '已确认')
    assert.deepEqual(view.candidates.map((v) => v.id), [b1.id])
    assert.deepEqual(new Set(view.history.map((v) => v.id)), new Set([a1.id, a2.id]))
    assert.equal(view.candidates.some((v) => v.id === video.id), false)
    const noPrimary = { ...target, visualReferences: [] }
    assert.equal(resolveCreatorAsset(noPrimary, entities, [b1]).status, '待审核')
    const approvedB = version(b.id, 'approved', 1)
    const readyEntities = entities.map((entity) => entity.id === b.id ? { ...b, approvedVersionId: approvedB.id } : entity)
    assert.equal(resolveCreatorAsset(noPrimary, readyEntities, [approvedB]).status, '准备就绪')
    assert.equal(resolveCreatorAsset({ ...target, visualReferences: [{ assetId: randomUUID(), role: 'faceReference', primary: true }] }, entities, [a1]).status, '不可用')
    assert.equal(resolveCreatorAsset({ ...noPrimary, assetIds: [] }, entities, []).status, '待生成')
    const output = { ...b1, metadata: {} }
    const task = aiTaskSchema.parse({ ...metadata(), projectId: project.id, input: { type: 'image-api', targetId: character.id }, status: 'succeeded', attempt: 1, error: null, resultIds: [output.id], sourceRevisions: {} })
    const provenanceView = resolveCreatorAsset({ ...noPrimary, assetIds: [] }, entities, [output], [task])
    assert.deepEqual(provenanceView.candidates.map((v) => v.id), [output.id])
  } finally { db.close() }
})
