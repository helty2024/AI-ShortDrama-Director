import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { alphaImageTool, alphaVideoTool } from '../../../src/shared/alpha.js'
import { ImageApiAdapter } from '../tools/adapters/image-api.js'
import { VideoApiAdapter } from '../tools/adapters/video-api.js'
import { ImageHttpTransport } from '../tools/adapters/image-http.js'
import { runMediaTool } from '../video/ffmpeg.js'

const taskSchema = z.strictObject({ id: z.uuid(), reads: z.number().int().nonnegative(), cancelled: z.boolean() })
const tasksSchema = z.array(taskSchema).max(1000)

/** Alpha-only Reference Protocol runtime. Serves fixed labelled test media, never a cloud API. */
export async function startAlphaReferenceRuntime(root: string) {
  await mkdir(root, { recursive: true })
  const store = join(root, 'reference-tasks.json')
  let stored: z.infer<typeof tasksSchema> = []
  try { stored = tasksSchema.parse(JSON.parse(await readFile(store, 'utf8'))) }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw new Error('Alpha test receipts are unreadable')
  }
  const tasks = new Map(stored.map(task => [task.id, task]))
  let writing = Promise.resolve()
  const persist = () => {
    const snapshot = JSON.stringify([...tasks.values()])
    writing = writing.then(async () => {
      await writeFile(store + '.tmp', snapshot)
      await rename(store + '.tmp', store)
    })
    return writing
  }
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#ede7fa"/><circle cx="500" cy="110" r="100" fill="#f9d8c9"/><path d="M0 290 Q160 160 340 290 T640 260 V360 H0" fill="#bcded1"/><rect x="36" y="32" width="248" height="42" rx="21" fill="#fff"/><text x="58" y="60" font-family="sans-serif" font-size="20" fill="#554277">ALPHA TEST / MOCK</text><text x="40" y="180" font-family="sans-serif" font-size="38" fill="#554277">Simulated video</text><text x="42" y="220" font-family="sans-serif" font-size="18" fill="#554277">Workflow test only. No AI footage.</text></svg>')).png().toBuffer()
  const imagePath = join(root, 'test-frame.png'), videoPath = join(root, 'test-video.mp4')
  await writeFile(imagePath, image)
  await runMediaTool('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', imagePath, '-t', '4', '-r', '24', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', videoPath])
  const video = await readFile(videoPath)
  const credential = randomUUID()
  let origin = ''
  const server = createServer(async (request, response) => {
    const json = (status: number, data: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)) }
    try {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const outputId = /^\/outputs\/([a-f0-9-]+)\.mp4$/.exec(path)?.[1]
      if (request.method === 'GET' && outputId && tasks.has(outputId)) {
        response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length }); response.end(video); return
      }
      if (request.headers.authorization !== `Bearer ${credential}`) { json(401, {}); return }
      if (request.method === 'POST' && (path === '/generate' || path === '/tasks')) {
        let length = 0
        for await (const chunk of request) { length += Buffer.byteLength(chunk); if (length > 16 * 1024 * 1024) { json(413, {}); return } }
        if (path === '/generate') { json(200, { images: [{ base64: image.toString('base64'), mime: 'image/png' }], cost: { amountMicro: 0, currency: 'CNY' } }); return }
        if (tasks.size >= 1000) { json(503, {}); return }
        const id = randomUUID()
        tasks.set(id, { id, reads: 0, cancelled: false })
        await persist()
        json(202, { taskId: id }); return
      }
      const match = /^\/tasks\/([a-f0-9-]+)(\/result)?$/.exec(path)
      const task = match && tasks.get(match[1]!)
      if (!task) { json(404, {}); return }
      if (request.method === 'DELETE' && !match![2]) { task.cancelled = true; await persist(); json(200, {}); return }
      if (request.method !== 'GET') { json(405, {}); return }
      if (match![2]) {
        if (task.cancelled || task.reads < 3) { json(409, {}); return }
        json(200, { videos: [{ url: `${origin}/outputs/${task.id}.mp4` }], cost: { amountMicro: 0, currency: 'CNY' } }); return
      }
      task.reads++; await persist()
      json(200, task.cancelled ? { state: 'cancelled' } : task.reads === 1 ? { state: 'queued', progress: 0 } : task.reads === 2 ? { state: 'running', progress: 0.5 } : { state: 'succeeded' })
    } catch { if (!response.headersSent) json(500, {}); else response.destroy() }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Alpha fixture unavailable')
  origin = `http://127.0.0.1:${address.port}`
  const transport = new ImageHttpTransport({ fixtureOrigin: origin })
  const imageAdapter = new ImageApiAdapter({ toolId: alphaImageTool, displayName: '测试图片 · 本地模拟生成', endpoint: origin + '/generate', modelId: 'alpha-reference-image', credentialRef: null, supportedCapabilities: ['image.generate', 'image.referenceGenerate'], supportedResolutions: [{ width: 640, height: 360 }], supportedAspectRatios: ['16:9'], maxReferences: 8, maxOutputCount: 1, currency: 'CNY', estimateSupport: 'unknown', cancelSupport: false, recoverSupport: false }, async () => credential, transport)
  const videoAdapter = new VideoApiAdapter({ toolId: alphaVideoTool, displayName: '测试视频 · 本地模拟生成', baseEndpoint: origin, modelId: 'alpha-reference-video', credentialRef: null, supportedCapabilities: ['video.textToVideo', 'video.imageToVideo'], supportedDurations: [4], supportedAspectRatios: ['16:9'], supportedResolutions: [{ width: 640, height: 360 }], resolutionMode: 'exact', durationToleranceSeconds: 0.2, supportsLastFrame: true, supportsReferenceImages: false, maxOutputCount: 1, polling: { initialIntervalMs: 200, maxIntervalMs: 500, maxWaitMs: 10000 }, maxDownloadBytes: 10 * 1024 * 1024, allowedDownloadHosts: [], allowedDownloadHostSuffixes: [], currency: 'CNY', estimateSupport: 'unknown', cancelSupport: true, recoverSupport: true }, async () => credential, transport)
  return { imageAdapter, videoAdapter, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await writing } }
}
