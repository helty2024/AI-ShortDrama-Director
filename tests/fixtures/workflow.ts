import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { ImageGenerationService } from '../../electron/main/generation/image-service.js'
import { VideoApiGenerationService } from '../../electron/main/generation/video-api-service.js'
import { ComfyUIToolAdapter } from '../../electron/main/tools/adapters/comfyui.js'
import { VideoApiAdapter } from '../../electron/main/tools/adapters/video-api.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'
import { WorkflowService } from '../../electron/main/workflow/service.js'
import { workflowSnapshotSchema, type WorkflowInput, type WorkflowCommand } from '../../src/shared/workflow.js'
import { comfyServer } from './comfyui-http.js'
import { videoServer } from './video-http.js'

export async function workflowFixture(video = false) {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-test-')), path = join(dir, 'db.sqlite')
  let db = new ProjectDatabase(path)
  const project = db.create({ name: 'Workflow test', description: '', genre: 'test', language: 'en', aspectRatio: '1:1' })
  db.insertEntities(project.id, buildSeed(project.id))
  const target = db.workspace(project.id).entities.find(e => e.kind === 'shot')!
  const imageServer = await comfyServer(), videos = video ? await videoServer() : null
  const services = () => {
    const visual = new VisualRepository(new IntelligenceRepository(db), new MediaStorage(join(dir, 'media')))
    const image = new ImageGenerationService(visual, [new ComfyUIToolAdapter(imageServer.profile)])
    const video = new VideoApiGenerationService(visual, videos ? [new VideoApiAdapter(videos.profile, async () => 'FIXTURE', new ImageHttpTransport({ fixtureOrigin: videos.origin }))] : [])
    return { visual, image, video, workflow: new WorkflowService(image, video) }
  }
  let current = services()
  const input: WorkflowInput = video && videos ? { workflowType: 'shot-video', generation: {
    projectId: project.id, targetId: target.id, toolId: videos.profile.toolId, mode: 'text-to-video', prompt: 'rain on a window',
    durationSeconds: 1, fps: 12, resolution: { width: 32, height: 32 }, aspectRatio: '1:1', seed: 42,
    firstFrameAssetVersionId: null, lastFrameAssetVersionId: null, allowAssetUpload: true, localOnly: false,
  } } : { workflowType: 'shot-keyframe', generation: {
    projectId: project.id, targetId: target.id, toolId: imageServer.profile.toolId, routingMode: 'fixed', resolution: { width: 32, height: 32 },
    aspectRatio: '1:1', count: 1, references: [], allowAssetUpload: false, localOnly: true,
  } }
  const get = (id: string) => current.workflow.repository.get(project.id, id)
  const settle = async (id: string) => { await current.workflow.runner.wait(id); return get(id) }
  const create = async () => {
    const result = workflowSnapshotSchema.parse(current.workflow.execute({ op: 'createWorkflowRun', input }))
    return settle(result.run.id)
  }
  const decide = async (id: string, decision: Extract<WorkflowCommand, { op: 'submitWorkflowUserDecision' }>['decision']) => {
    current.workflow.execute({ op: 'submitWorkflowUserDecision', projectId: project.id, runId: id, expectedRevision: get(id).run.revision, decision })
    return settle(id)
  }
  const confirm = (id: string) => decide(id, { action: 'confirm-generation', previewId: get(id).steps[1].outputSnapshot.preview!.id, maxCostMicro: video ? 100 : 0, allowUnknownCost: video })
  const review = (id: string, action: 'approve-candidate' | 'reject-candidate' | 'adopt-candidate') => {
    const candidate = current.visual.version(project.id, get(id).steps[1].relatedAssetVersionId!)
    return decide(id, { action, versionId: candidate.id, versionRevision: candidate.revision, targetRevision: current.visual.repo.entity(project.id, target.id).revision })
  }
  return { dir, project, target, input, imageServer, videos, create, get, settle, decide, confirm, review,
    get db() { return db }, get services() { return current },
    restart: (from = path) => { db.close(); db = new ProjectDatabase(from); current = services(); return current },
    close: async () => { db.close(); await imageServer.close(); await videos?.close(); await rm(dir, { recursive: true, force: true }) },
  }
}
