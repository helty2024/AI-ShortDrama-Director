import type { Asset, Episode, Scene, Shot, Workspace } from '../../../src/shared/domain.js'
import type { AssetVersion } from '../../../src/shared/visual.js'
import { isAlphaTestTool } from '../../../src/shared/alpha.js'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Text-only handoff. Never serialize service settings, media URLs, prompts or local paths. */
export function buildStoryboardSheet(workspace: Workspace, versions: AssetVersion[], shotIds?: string[]) {
  const { project, entities } = workspace
  const included = shotIds ? new Set(shotIds) : null
  const scenes = new Map(entities.filter((e): e is Scene => e.kind === 'scene').map(e => [e.id, e]))
  const episodes = new Map(entities.filter((e): e is Episode => e.kind === 'episode').map(e => [e.id, e]))
  const shots = entities.filter((e): e is Shot => e.kind === 'shot' && (!included || included.has(e.id))).toSorted((a, b) => {
    const sa = scenes.get(a.sceneId), sb = scenes.get(b.sceneId)
    return (episodes.get(sa?.episodeId ?? '')?.order ?? 0) - (episodes.get(sb?.episodeId ?? '')?.order ?? 0) ||
      (sa?.order ?? 0) - (sb?.order ?? 0) || a.order - b.order || a.createdAt.localeCompare(b.createdAt)
  })
  const rows = shots.map(shot => {
    const scene = entities.find(e => e.id === shot.sceneId)
    const episode = scene?.kind === 'scene' ? entities.find(e => e.id === scene.episodeId) : undefined
    const asset = entities.find((e): e is Asset => e.kind === 'asset' && e.id === shot.confirmedVideoAssetId)
    const video = asset && versions.find(v => v.assetId === asset.id && v.id === shot.confirmedVideoAssetVersionId && v.mimeType === 'video/mp4')
    const confirmed = video?.status === 'approved' && video.projectId === project.id ? video : undefined
    const state = confirmed ? isAlphaTestTool(confirmed.provider ?? '') ? '模拟视频已确认' : '已确认' : '待确认'
    const cells = [episode?.name ?? '', scene?.name ?? '', shot.plan?.shotNumber ?? shot.order + 1, shot.name,
      shot.description || shot.plan?.action || '', shot.durationSeconds,
      shot.characterIds.map(id => entities.find(e => e.id === id)?.name).filter(Boolean).join('、'),
      shot.plan?.framing || shot.plan?.shotType || '', shot.plan?.cameraMovement || shot.direction.cameraMovement || '',
      shot.plan?.continuityNotes || '', state]
    return '<tr>' + cells.map(c => `<td>${escape(c)}</td>`).join('') + '</tr>'
  }).join('\n')
  const headers = ['分集', '场次', '镜号', '镜头名称', '画面 / 动作', '秒', '角色', '景别', '运镜', '连续性备注', '视频状态']
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(project.name)} · 分镜表</title>
<style>body{font:15px/1.6 system-ui,sans-serif;color:#292436;background:#faf9f6;margin:40px}h1{font-size:32px}p{color:#645b70}.table-wrap{overflow:auto}table{border-collapse:collapse;background:white;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #e8e3ec;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#ede7f6}td:nth-child(5){min-width:180px}@media print{body{margin:0;background:white}thead{display:table-header-group}tr{break-inside:avoid}.table-wrap{overflow:visible}table{font-size:10px}th,td{padding:5px}td:nth-child(5){min-width:0}@page{size:A4 landscape;margin:12mm}}</style></head>
<body><h1>${escape(project.name)} · 分镜表</h1><p>当前导出范围：${shots.length} 个镜头 · 画幅 ${escape(project.aspectRatio)} · 计划总时长 ${shots.reduce((n, s) => n + s.durationSeconds, 0)} 秒</p><p>文字交付表，可离线查看或通过浏览器打印。不含图片、视频文件或生成密钥；计划时长不代表成片时长。批准候选不会自动标记为已确认。</p><div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></body></html>`
  const name = Array.from(project.name, c => c.codePointAt(0)! < 32 ? '_' : c).join('').replace(/[<>:"/\\|?*]/g, '_').slice(0, 60).trim() || '项目'
  return { html, filename: `${name}-分镜表.html`, count: shots.length }
}
