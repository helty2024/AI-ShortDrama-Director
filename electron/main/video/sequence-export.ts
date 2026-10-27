import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DomainError, metadata } from '../database.js'
import type { VisualRepository } from '../visual/repository.js'
import { runMediaTool, probeVideo } from './ffmpeg.js'
import { videoTimelineClipSchema, type VideoTimelineClip } from '../../../src/shared/video-batch.js'
import { orderedShots } from '../../../src/shared/shot-order.js'
import { sequenceDraftClipsSchema, sequenceDraftSchema } from '../../../src/shared/video-sequence.js'

/** A filename suggestion only; the native dialog still chooses the output path. */
export function sequenceExportFilename(projectName: string, clipCount: number) {
  let name = Array.from(projectName, c => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127 ? '_' : c).join('').replace(/[<>:"/\\|?*]/g, '_')
  name = Array.from(name).slice(0, 60).join('').trim().replace(/[. ]+$/u, '') || '项目'
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = `_${name}`
  return `${name}-成片-${clipCount}镜头.mp4`
}

export function saveSequenceDraft(visual: VisualRepository, projectId: string, expectedRevision: number, raw: VideoTimelineClip[]) {
  const clips = sequenceDraftClipsSchema.parse(raw)
  const db = visual.repo.database
  return db.transaction(() => {
    const project = db.get(projectId)
    if ((project.sequenceDraft?.revision ?? 0) !== expectedRevision)
      throw new DomainError('CONFLICT', '时间线草稿已在其他窗口更新，请重新进入页面后编辑')
    if (new Set(clips.map(c => c.shotId)).size !== clips.length)
      throw new DomainError('INVALID_INPUT', '时间线不能包含重复镜头')
    for (const clip of clips) {
      const shot = visual.repo.entity(projectId, clip.shotId)
      const version = visual.version(projectId, clip.versionId)
      if (shot.kind !== 'shot' || version.mimeType !== 'video/mp4')
        throw new DomainError('INVALID_INPUT', '草稿只能引用项目内的镜头和 MP4 视频版本')
    }
    const draft = sequenceDraftSchema.parse({ schemaVersion: 1, revision: expectedRevision + 1, updatedAt: new Date().toISOString(), clips })
    // Keep project editing revisions independent; normal project updates spread
    // the stored record and therefore preserve this project-owned draft too.
    db.connection.prepare("UPDATE projects SET data=json_set(data,'$.sequenceDraft',json(?)) WHERE id=?")
      .run(JSON.stringify(draft), projectId)
    return draft
  })
}

export function validateTimeline(visual: VisualRepository, projectId: string, shotIds: string[], raw: VideoTimelineClip[]) {
  const clips = raw.map(c => videoTimelineClipSchema.parse(c))
  if (clips.length !== shotIds.length || new Set(clips.map(c => c.shotId)).size !== clips.length || clips.some(c => !shotIds.includes(c.shotId)))
    throw new DomainError('CONFLICT', '时间线必须完整且仅包含所选镜头')
  const ordered = orderedShots(visual.repo.database.workspace(projectId).entities).filter(shot => shotIds.includes(shot.id))
  if (ordered.length !== clips.length || clips.some((clip, i) => clip.shotId !== ordered[i].id))
    throw new DomainError('CONFLICT', '时间线顺序必须与正式分镜一致')
  for (const clip of clips) {
    const shot = visual.repo.entity(projectId, clip.shotId)
    const version = visual.version(projectId, clip.versionId)
    const asset = visual.asset(projectId, version.assetId)
    if (shot.kind !== 'shot' || shot.confirmedVideoAssetVersionId !== version.id || shot.confirmedVideoAssetId !== asset.id || asset.approvedVersionId !== version.id || version.status !== 'approved' || version.mimeType !== 'video/mp4' || !version.duration || clip.outSeconds > version.duration)
      throw new DomainError('CONFLICT', '时间线顺序、采用版本、批准状态或剪辑区间无效')
  }
  return clips
}

/** Only explicitly adopted project videos are assembled, in immutable shot order.
 * Inputs are registered local files, checked by hash. No shell or remote protocol. */
export async function exportVideoSequence(visual: VisualRepository, projectId: string, shotIds: string[], timeline?: VideoTimelineClip[]) {
  if (!shotIds.length || shotIds.length > 100 || new Set(shotIds).size !== shotIds.length)
    throw new DomainError('INVALID_INPUT', '导出镜头范围无效')
  const shots = shotIds.map(id => {
    const shot = visual.repo.entity(projectId, id)
    if (shot.kind !== 'shot' || !shot.confirmedVideoAssetVersionId || !shot.confirmedVideoAssetId)
      throw new DomainError('CONFLICT', '请先人工审核并采用每个镜头的视频')
    return shot
  })
  const formalOrder = orderedShots(visual.repo.database.workspace(projectId).entities).map(shot => shot.id)
  shots.sort((a, b) => formalOrder.indexOf(a.id) - formalOrder.indexOf(b.id))
  const versions = shots.map(shot => {
    const version = visual.version(projectId, shot.confirmedVideoAssetVersionId!)
    if (version.assetId !== shot.confirmedVideoAssetId || version.status !== 'approved' || version.mimeType !== 'video/mp4' || !version.duration)
      throw new DomainError('CONFLICT', '采用状态或视频关联无效')
    return version
  })
  const clips = validateTimeline(visual, projectId, shotIds, timeline ?? shots.map((shot, i) => ({ shotId: shot.id, versionId: versions[i].id, inSeconds: 0, outSeconds: versions[i].duration! })))
  const duration = clips.reduce((sum, clip) => sum + clip.outSeconds - clip.inSeconds, 0)
  if (duration > 600) throw new DomainError('CONFLICT', '当前成片导出最长 600 秒')
  const inputs: string[] = []
  for (const version of versions) {
    const bytes = await visual.storage.read(version.storageKey)
    if (createHash('sha256').update(bytes).digest('hex') !== version.hash)
      throw new DomainError('CONFLICT', '视频完整性校验失败，请从素材诊断定位')
    inputs.push(await visual.storage.resolveRegisteredFile(version.storageKey))
  }
  const folder = await mkdtemp(join(tmpdir(), 'director-sequence-'))
  try {
    const path = join(folder, 'sequence.mp4')
    const width = versions[0].width, height = versions[0].height
    const filters = inputs.map((_, i) => `[${i}:v:0]trim=start=${clips[i].inSeconds}:end=${clips[i].outSeconds},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v${i}]`)
    filters.push(`${inputs.map((_, i) => `[v${i}]`).join('')}concat=n=${inputs.length}:v=1:a=0[out]`)
    await runMediaTool('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error',
      ...inputs.flatMap(input => ['-protocol_whitelist', 'file,pipe', '-i', input]),
      '-filter_complex', filters.join(';'), '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', path])
    const media = await probeVideo(path)
    if (Math.abs(media.duration - duration) > inputs.length / 24 + 0.1)
      throw new DomainError('CONFLICT', '成片实际时长与选片不一致，未入库')
    // Detect a concurrent human selection change before committing an obsolete assembly.
    validateTimeline(visual, projectId, shotIds, clips)
    const assetId = metadata().id
    const stored = await visual.storage.storeVideo(projectId, assetId, await readFile(path))
    return visual.repo.database.transaction(() => {
      validateTimeline(visual, projectId, shotIds, clips)
      visual.repo.database.insertEntities(projectId, [{ ...metadata(), id: assetId, projectId, kind: 'asset', name: `成片 · ${clips.length} 镜头`, description: '按正式镜头顺序与剪辑区间合成的无声视频', mediaType: 'video', uri: null, status: 'placeholder', source: null, previousVersionId: null }])
      return visual.commitVersion(projectId, assetId, stored, { sourceType: 'imported', provider: null, model: null, prompt: '', negativePrompt: '', generationTaskId: null,
        sourceAssetIds: [...new Set(versions.map(v => v.assetId))], metadata: { localAssembly: true, audio: 'none', expectedDuration: duration,
          sequence: shots.map((shot, i) => ({ ...clips[i], shotNumber: shot.plan?.shotNumber ?? shot.order, duration: clips[i].outSeconds - clips[i].inSeconds })) } })
    })
  } finally { await rm(folder, { recursive: true, force: true }) }
}
