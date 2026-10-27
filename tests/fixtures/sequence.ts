import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectDatabase } from '../../electron/main/database.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { buildSeed } from '../../electron/main/seed.js'
import { runMediaTool } from '../../electron/main/video/ffmpeg.js'

/** Local files only: no provider, credentials or HTTP server. */
export async function sequenceFixture(root: string) {
  const db = new ProjectDatabase(join(root, 'workspace.sqlite'))
  try {
    const project = db.seed(buildSeed)
    db.open(project.id)
    const repo = new IntelligenceRepository(db)
    const visual = new VisualRepository(repo, new MediaStorage(join(root, 'media')))
    const shots = db.workspace(project.id).entities.filter(e => e.kind === 'shot')
    const targets = [shots[0], shots[3]].map((s, i) => {
      // Two scenes restart their local order, so sorting only Shot.order is wrong.
      const updated = repo.updateEntity(project.id, s.id, s.revision, { order: i === 0 ? 2 : 0, name: `离线镜头${i + 1}`, description: `离线镜头${i + 1}` })
      if (updated.kind !== 'shot') throw new Error('fixture shot')
      return updated
    })
    const versions = []
    const files = []
    for (const [i, shot] of targets.entries()) {
      const file = join(root, `source-${i + 1}.mp4`)
      files.push(file)
      await runMediaTool('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${i ? 'blue' : 'red'}:s=64x64:r=24:d=1`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file])
      const asset = db.createDraft({ projectId: project.id, kind: 'asset', name: `离线素材 ${i + 1}` })
      repo.updateEntity(project.id, asset.id, asset.revision, { mediaType: 'video' })
      const stored = await visual.storage.storeVideo(project.id, asset.id, await readFile(file))
      versions.push(visual.commitVersion(project.id, asset.id, stored, { sourceType: 'imported', provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: { targetId: shot.id } }))
    }
    return { db, repo, visual, project, shots: targets, versions, files }
  } catch (cause) { db.close(); throw cause }
}
