import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startAlphaReferenceRuntime } from '../../electron/main/alpha/reference-runtime.js'
import { alphaVideoTool, isAlphaTestTool } from '../../src/shared/alpha.js'
import { creatorStatus, creatorTaskStatus, creatorErrorMessage } from '../../src/components/creator-shell/status.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { VideoApiGenerationService } from '../../electron/main/generation/video-api-service.js'

test('Alpha frontstage statuses explain unknown, unavailable and review without exposing internal labels', () => {
  assert.equal(creatorStatus('unknown-submission'), '需要处理')
  assert.equal(creatorStatus('configured-unverified'), '服务不可用')
  assert.equal(creatorStatus('routing failed'), '需要处理')
  assert.equal(creatorStatus('approved'), '等待选择')
  assert.equal(creatorStatus('adopted'), '已确认')
  assert.equal(creatorTaskStatus('queued'), '准备中')
  for (const text of ['unknown-submission', 'configured-unverified', 'routing failed', 'ComfyUI offline', 'fixture failed']) {
    const readable = creatorErrorMessage(text)
    assert.doesNotMatch(readable, /unknown-submission|configured-unverified|routing failed|fixture failed/)
    assert.match(readable, /处理|重试|设置/)
  }
  assert.equal(isAlphaTestTool('compshare.minimax-h3'), false)
})

test('Alpha Reference runtime rejects unauthenticated submit and never persists source text or headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alpha-runtime-security-'))
  const runtime = await startAlphaReferenceRuntime(root)
  try {
    const response = await fetch(runtime.videoAdapter.profile.baseEndpoint + '/tasks', { method: 'POST', body: 'do not persist this prompt' })
    assert.equal(response.status, 401)
    await assert.rejects(readFile(join(root, 'reference-tasks.json')))
    assert.equal(runtime.videoAdapter.profile.allowedDownloadHosts.length, 0)
    assert.equal(runtime.videoAdapter.profile.toolId, alphaVideoTool)
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }) }
})

test('Alpha video persists one accepted task across runtime restart and approve remains separate from adopt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alpha-runtime-workflow-'))
  let runtime = await startAlphaReferenceRuntime(join(root, 'reference'))
  const db = new ProjectDatabase(join(root, 'workspace.sqlite'))
  try {
    const project = db.create({ name: 'Alpha attempt', description: '', genre: '测试', aspectRatio: '16:9', language: 'zh-CN' })
    db.insertEntities(project.id, buildSeed(project.id))
    const shot = db.workspace(project.id).entities.find(item => item.kind === 'shot')!
    const visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(root, 'media')))
    let service = new VideoApiGenerationService(visual, [runtime.videoAdapter])
    const preview = await service.preview({ projectId: project.id, targetId: shot.id, toolId: alphaVideoTool, mode: 'text-to-video', prompt: 'ALPHA_PRIVATE_PROMPT', durationSeconds: 4, fps: 24, resolution: { width: 640, height: 360 }, aspectRatio: '16:9', seed: null, firstFrameAssetVersionId: null, lastFrameAssetVersionId: null, allowAssetUpload: true, localOnly: false })
    const task = service.confirm(project.id, preview.id, 0, true)
    await service.wait(task.id)
    const receipts = await readFile(join(root, 'reference/reference-tasks.json'), 'utf8')
    assert.equal(JSON.parse(receipts).length, 1)
    assert.doesNotMatch(receipts, /ALPHA_PRIVATE_PROMPT|Authorization|Bearer|credential|apiKey/)
    await runtime.close()
    runtime = await startAlphaReferenceRuntime(join(root, 'reference'))
    service = new VideoApiGenerationService(visual, [runtime.videoAdapter])
    const result = await service.query(project.id, task.id)
    assert.equal(result.task.status, 'succeeded')
    assert.equal(JSON.parse(await readFile(join(root, 'reference/reference-tasks.json'), 'utf8')).length, 1)
    const version = result.versions[0]!
    assert.equal(version.mimeType, 'video/mp4')
    assert.equal(version.provider, alphaVideoTool)
    const target = visual.repo.entity(project.id, shot.id)
    const approved = service.review(project.id, version.id, version.revision, false, target.revision)
    assert.equal(approved.status, 'approved')
    assert.equal(db.workspace(project.id).entities.filter(item => item.kind === 'shot').find(item => item.id === shot.id)?.confirmedVideoAssetVersionId, null)
    const adopted = service.review(project.id, version.id, approved.revision, true, visual.repo.entity(project.id, shot.id).revision)
    assert.equal(db.workspace(project.id).entities.filter(item => item.kind === 'shot').find(item => item.id === shot.id)?.confirmedVideoAssetVersionId, adopted.id)
    assert.deepEqual(result.record.actualCost, { amountMicros: 0, currency: 'CNY' })
  } finally { await runtime.close(); db.close(); await rm(root, { recursive: true, force: true }) }
})
