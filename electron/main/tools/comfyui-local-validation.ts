import { app } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { ProjectDatabase, metadata } from '../database.js'
import { entitySchema } from '../../../src/shared/domain.js'
import { IntelligenceRepository } from '../intelligence/repository.js'
import { VisualRepository } from '../visual/repository.js'
import { MediaStorage } from '../visual/storage.js'
import { ImageGenerationService } from '../generation/image-service.js'
import { ComfyUIToolAdapter } from './adapters/comfyui.js'
import { ComfyUIRuntime } from './adapters/comfyui-runtime.js'
import { builtinComfyProfile } from './adapters/comfyui-template.js'
import { ComfyValidationTransport } from './comfyui-validation-transport.js'

const checkpoint = 'sd_xl_base_1.0.safetensors'
const prompt = 'A red apple on a white table'
let stage = 'startup'
async function main() {
  await app.whenReady()
  const args = process.argv.slice(1)
  const recoverOnly = args.includes('--recover-only')
  if (!recoverOnly && !args.includes('--confirm-one-local-image'))
    throw new Error('Explicit local execution confirmation required')
  const userData = join(app.getPath('appData'), 'ai-shortdrama-director')
  const diagnostics = join(userData, 'diagnostics')
  await mkdir(diagnostics, { recursive: true })
  const intentPath = join(diagnostics, 'comfyui-07-08-5-intent.json')
  const reportPath = join(diagnostics, 'comfyui-07-08-5-report.json')
  const profile = builtinComfyProfile({ checkpoint })
  const transport = new ComfyValidationTransport(intentPath, profile.baseUrl, checkpoint, recoverOnly)
  const adapter = new ComfyUIToolAdapter(profile, new ComfyUIRuntime(profile.baseUrl, transport.fetch))
  if (!recoverOnly) {
    stage = 'one-shot-guard'
    const exists = await access(intentPath).then(() => true, (error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
      throw error
    })
    assert.equal(exists, false, 'Existing intent: never send another prompt')
    stage = 'read-only-preflight'
    assert.equal((await adapter.health(AbortSignal.timeout(20000))).availability, 'available')
    const info = await adapter.runtime.objectInfo(AbortSignal.timeout(20000))
    const checkpoints = info.CheckpointLoaderSimple?.input?.required?.ckpt_name
    assert.ok(Array.isArray(checkpoints) && Array.isArray(checkpoints[0]) && checkpoints[0].includes(checkpoint))
    for (const node of profile.template.requiredNodes) assert.ok(info[node], `Missing ${node}`)
  }
  const db = new ProjectDatabase(join(userData, 'workspace.sqlite'))
  try {
    const visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(userData, 'media')))
    const service = new ImageGenerationService(visual, [adapter])
    if (recoverOnly) {
      stage = 'restart-recovery'
      const report = z.object({
        projectId: z.uuid(), targetId: z.uuid(), taskId: z.uuid(), promptId: z.string(),
        candidateId: z.uuid(), recordId: z.uuid(), submitCount: z.literal(1),
        review: z.literal(true), adopted: z.literal(true), formalBinding: z.literal(true),
      }).passthrough().parse(JSON.parse(await readFile(reportPath, 'utf8')))
      const before = service.query(report.projectId, report.taskId)
      assert.equal(before.task.status, 'succeeded')
      assert.equal(before.task.providerTaskId, report.promptId)
      assert.equal(before.record.id, report.recordId)
      const record = before.record
      const context = {
        projectId: report.projectId, taskId: report.taskId,
        estimateId: record.estimateId, approvalId: record.approvalId,
        routingDecisionId: record.routingDecisionId, model: record.modelId,
        requestFingerprint: record.requestFingerprint,
      }
      const handle = { toolId: record.toolId, toolVersion: record.toolVersion, externalTaskId: report.promptId }
      const execution = service.broker.restoreExecution(record.parameters, context, record.toolId, record.toolVersion, handle)
      const recovered = await service.broker.recover(context, execution, handle, AbortSignal.timeout(20000))
      assert.equal(recovered.state, 'recovered')
      if (recovered.state !== 'recovered') throw new Error('Recovery failed')
      assert.equal(recovered.status.state, 'succeeded')
      assert.equal(transport.observed.submitCount, 0)
      assert.equal(transport.observed.historyHttpStatus, 200)
      assert.equal(before.versions[0]?.id, report.candidateId)
      assert.equal(before.versions[0]?.status, 'approved')
      const target = visual.repo.entity(report.projectId, report.targetId)
      assert.ok('visualReferences' in target && target.visualReferences.some((ref) => ref.primary && ref.assetId === before.versions[0].assetId))
      const after = service.query(report.projectId, report.taskId)
      assert.deepEqual(after.record, before.record)
      const completed = {
        ...report, restartRecover: true, recoverySubmitCount: 0,
        recoveryHistoryHttpStatus: transport.observed.historyHttpStatus,
        submitCount: 1, realLocalValidated: true,
        recoveryScope: 'completed-task-query-after-process-restart',
      }
      await writeFile(reportPath, JSON.stringify(completed, null, 2))
      process.stdout.write(JSON.stringify(completed) + '\n')
      return
    }
    stage = 'prepare-project'
    const project = db.create({ name: '07-08.5 本机 ComfyUI 真实验证', description: '一次真实生成，保留候选、审核采用与来源审计。', genre: 'validation', language: 'en', aspectRatio: '1:1' })
    const target = entitySchema.parse({ ...metadata(), projectId: project.id, kind: 'character', name: 'Local ComfyUI validation target', description: prompt, appearance: '', assetIds: [] })
    db.insertEntities(project.id, [target])
    await writeFile(join(diagnostics, 'comfyui-07-08-5-profile.json'), JSON.stringify(profile, null, 2))
    stage = 'preview'
    const preview = await service.preview({
      projectId: project.id, targetId: target.id, toolId: profile.toolId,
      routingMode: 'fixed', resolution: { width: 1024, height: 1024 },
      aspectRatio: '1:1', count: 1, references: [], allowAssetUpload: false, localOnly: true,
    }, { positivePrompt: prompt, compilerVersion: 'comfyui-local-validation-07-08-5' })
    assert.equal(preview.knownFree, true)
    assert.equal(preview.executionMode, 'local-service')
    assert.equal(preview.model, checkpoint)
    assert.equal(preview.prompt, prompt)
    process.stdout.write(JSON.stringify({ stage: 'local-execution-confirmed', authorization: 'explicit-user-request', preview }) + '\n')
    stage = 'submit-and-ingest'
    const task = service.confirm(project.id, preview.id, 0, false)
    await service.wait(task.id)
    const result = service.query(project.id, task.id)
    await writeFile(reportPath, JSON.stringify({
      stage, projectId: project.id, targetId: target.id, taskId: task.id,
      recordId: result.record.id, outcome: result.record.outcome,
      error: result.task.error, observations: transport.observed,
      submitCount: transport.observed.submitCount, realLocalValidated: false,
    }, null, 2))
    assert.equal(result.task.status, 'succeeded', JSON.stringify(result.task.error))
    assert.equal(result.versions.length, 1)
    assert.equal(transport.observed.submitCount, 1)
    assert.equal(result.task.providerTaskId, transport.observed.promptId)
    stage = 'verify-candidate'
    const candidate = result.versions[0]
    assert.equal(candidate.status, 'draft')
    const bytes = await visual.storage.read(candidate.storageKey)
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 })
    const decoded = await image.metadata()
    await image.raw().toBuffer()
    assert.equal(decoded.format, 'png')
    assert.equal(decoded.width, 1024)
    assert.equal(decoded.height, 1024)
    assert.equal(candidate.mimeType, 'image/png')
    assert.equal(createHash('sha256').update(bytes).digest('hex'), candidate.hash)
    assert.equal(result.record.outcome, 'succeeded')
    assert.ok(result.record.promptPackageId && result.record.approvalId && result.record.startedAt && result.record.completedAt)
    assert.equal(result.record.modelId, checkpoint)
    assert.equal(result.record.workflowVersion, profile.template.version)
    assert.equal(result.record.outputAssetVersionIds[0], candidate.id)
    assert.equal(result.reservationStatus, 'consumed')
    assert.deepEqual(result.record.actualCost, { amountMicros: 0, currency: 'USD' })
    stage = 'review-and-adopt'
    const reviewed = service.review(project.id, candidate.id, candidate.revision, false, target.revision)
    assert.equal(reviewed.status, 'approved')
    const adopted = service.review(project.id, reviewed.id, reviewed.revision, true, target.revision)
    assert.equal(adopted.status, 'approved')
    const updated = visual.repo.entity(project.id, target.id)
    const formalBinding = 'visualReferences' in updated && updated.visualReferences.some((ref) => ref.primary && ref.assetId === adopted.assetId)
    assert.ok(formalBinding)
    const report = {
      checkedAt: new Date().toISOString(), projectId: project.id, targetId: target.id,
      taskId: task.id, recordId: result.record.id, promptId: result.task.providerTaskId,
      candidateId: candidate.id, assetId: candidate.assetId,
      mime: candidate.mimeType, width: candidate.width, height: candidate.height,
      hash: candidate.hash, decoded: true, review: true, adopted: true, formalBinding,
      outcome: result.record.outcome, generationRecordComplete: true,
      reservationStatus: result.reservationStatus, actualCost: result.record.actualCost,
      workflowTemplateId: profile.template.templateId, workflowVersion: profile.template.version,
      checkpoint, observations: transport.observed, submitCount: transport.observed.submitCount,
      restartRecover: false, realLocalValidated: false,
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2))
    process.stdout.write(JSON.stringify(report) + '\n')
  } finally { db.close() }
}
main().then(() => app.exit(0)).catch(() => {
  process.stderr.write(JSON.stringify({ stage, failed: true, message: 'Validation stopped; existing intent blocks resubmission. No automatic retry.' }) + '\n')
  app.exit(1)
})
