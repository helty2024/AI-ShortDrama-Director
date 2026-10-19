import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { assetVersionSchema } from '../../src/shared/visual.js'
import { buildStoryboardSheet } from '../../electron/main/production/storyboard-sheet.js'
import { orderedShots } from '../../src/features/storyboard/storyboard-model.js'

function fixture() {
  const db = new ProjectDatabase(':memory:')
  const project = db.seed(buildSeed)
  return { db, workspace: db.workspace(project.id) }
}

test('Storyboard sheet respects saved order and selected scope without altering the project', () => {
  const { db, workspace } = fixture()
  try {
    const before = JSON.stringify(workspace), shots = orderedShots(workspace.entities)
    const sheet = buildStoryboardSheet(workspace, [], [shots[1]!.id, shots[0]!.id])
    assert.equal(sheet.count, 2)
    const selected = shots[1]!
    assert.ok(buildStoryboardSheet(workspace, [], [selected.id]).html.includes(`<td>${selected.plan?.shotNumber ?? selected.order + 1}</td><td>${selected.name}</td>`))
    assert.ok(sheet.html.indexOf(shots[0]!.name) < sheet.html.indexOf(shots[1]!.name))
    assert.equal(JSON.stringify(workspace), before)
    assert.equal(buildStoryboardSheet(workspace, [], []).count, 0)
  } finally { db.close() }
})

test('Offline HTML escapes creative text and contains no executable content, external media, paths or provider payload', () => {
  const { db, workspace } = fixture()
  try {
    workspace.project.name = '<script>alert("x")</script>/故事'
    const shot = orderedShots(workspace.entities)[0]!
    shot.description = '<img src="https://fixture.example/a" onerror="alert(1)">'
    shot.videoPrompt = 'PRIVATE_PROMPT_SENTINEL'
    workspace.project.description = 'PRIVATE_PROJECT_NOT_EXPORTED'
    const sheet = buildStoryboardSheet(workspace, [], [shot.id])
    assert.doesNotMatch(sheet.html, /<script|<img|PRIVATE_PROMPT_SENTINEL|PRIVATE_PROJECT_NOT_EXPORTED|<a\s/)
    assert.match(sheet.html, /&lt;script&gt;/)
    assert.match(sheet.html, /default-src 'none'/)
    assert.match(sheet.html, /@media print/)
    assert.doesNotMatch(sheet.filename, /[<>:"/\\|?*]/)
  } finally { db.close() }
})

test('Approved candidate is not confirmed until adopted; explicit simulation provenance remains labeled', () => {
  const { db, workspace } = fixture()
  try {
    const shot = orderedShots(workspace.entities)[0]!, asset = workspace.entities.find(e => e.kind === 'asset')!
    const version = assetVersionSchema.parse({ id: randomUUID(), projectId: workspace.project.id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1, assetId: asset.id, versionNumber: 1, status: 'approved', sourceType: 'generated', mimeType: 'video/mp4', width: 32, height: 32, fileSize: 32, hash: 'a'.repeat(64), storageKey: 'PRIVATE_STORAGE_SENTINEL', thumbnailPath: 'test', provider: 'alpha.reference.video', model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: { targetId: shot.id } })
    assert.match(buildStoryboardSheet(workspace, [version], [shot.id]).html, /<td>待确认<\/td>/)
    shot.confirmedVideoAssetId = asset.id
    shot.confirmedVideoAssetVersionId = version.id
    const sheet = buildStoryboardSheet(workspace, [version], [shot.id])
    assert.match(sheet.html, /模拟视频已确认/)
    assert.doesNotMatch(sheet.html, /PRIVATE_STORAGE_SENTINEL|alpha\.reference\.video/)
    assert.match(buildStoryboardSheet(workspace, [{ ...version, status: 'rejected' }], [shot.id]).html, /<td>待确认<\/td>/)
  } finally { db.close() }
})
