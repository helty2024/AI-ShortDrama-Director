import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { videoApiProfileSchema } from '../../src/shared/video-api.js'

const execute = promisify(execFile)
export type VideoFixtureMode =
  | 'ok'
  | 'always-running'
  | 'failed'
  | 'cancelled'
  | 'unknown-submit'
  | 'unknown-status'
  | 'status-401'
  | 'status-429'
  | 'status-500'
  | 'malformed-status'
  | 'redirect'
  | 'unsafe-redirect'
  | 'octet-stream'
  | 'html'
  | 'truncated'
  | 'wrong-duration'
  | 'wrong-resolution'
  | 'multiple'
  | 'missing-remote'

async function makeVideo(path: string, size: string, duration: number) {
  await execute(
    process.env.DIRECTOR_FFMPEG || 'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=red:s=${size}:r=12:d=${duration}`,
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      path,
    ],
    { windowsHide: true, timeout: 30000 },
  )
  return readFile(path)
}

export async function videoServer(initial: VideoFixtureMode = 'ok') {
  const directory = await mkdtemp(join(tmpdir(), 'video-api-fixture-'))
  const valid = await makeVideo(join(directory, 'valid.mp4'), '32x32', 1)
  const wrongDuration = await makeVideo(join(directory, 'duration.mp4'), '32x32', 2)
  const wrongResolution = await makeVideo(join(directory, 'resolution.mp4'), '48x32', 1)
  let mode = initial
  let origin = ''
  let submittedBody: unknown = null
  let taskExists = false
  let statusReads = 0
  const counts = { submit: 0, status: 0, result: 0, download: 0, cancel: 0 }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', origin || 'http://127.0.0.1')
    if (request.method === 'POST' && url.pathname === '/tasks') {
      counts.submit++
      let text = ''
      for await (const chunk of request) text += String(chunk)
      submittedBody = JSON.parse(text) as unknown
      taskExists = true
      if (mode === 'unknown-submit') {
        request.socket.destroy()
        return
      }
      response.writeHead(202, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ taskId: 'remote-video-1' }))
      return
    }
    if (request.method === 'DELETE' && url.pathname === '/tasks/remote-video-1') {
      counts.cancel++
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{}')
      return
    }
    if (request.method === 'GET' && url.pathname === '/tasks/remote-video-1') {
      counts.status++
      statusReads++
      if (!taskExists || mode === 'missing-remote') {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end('{}')
        return
      }
      const errorStatus =
        mode === 'status-401' ? 401 : mode === 'status-429' ? 429 : mode === 'status-500' ? 500 : 0
      if (errorStatus) {
        response.writeHead(errorStatus, { 'Content-Type': 'application/json' })
        response.end('{}')
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      if (mode === 'malformed-status') response.end('{bad json')
      else if (mode === 'always-running')
        response.end(JSON.stringify({ state: 'running', progress: 0.5 }))
      else if (mode === 'failed')
        response.end(JSON.stringify({ state: 'failed', code: 'fixture', message: 'fixture failed' }))
      else if (mode === 'cancelled') response.end(JSON.stringify({ state: 'cancelled' }))
      else if (mode === 'unknown-status') response.end(JSON.stringify({ state: 'unknown' }))
      else if (statusReads === 1)
        response.end(JSON.stringify({ state: 'queued', progress: 0 }))
      else if (statusReads === 2)
        response.end(JSON.stringify({ state: 'running', progress: 0.5 }))
      else response.end(JSON.stringify({ state: 'succeeded' }))
      return
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/tasks/remote-video-1/result'
    ) {
      counts.result++
      response.writeHead(200, { 'Content-Type': 'application/json' })
      const amount = mode === 'multiple' ? 2 : 1
      response.end(
        JSON.stringify({
          videos: Array.from({ length: amount }, (_, index) => ({
            url: `${origin}/outputs/${index}.mp4?signature=DO_NOT_LOG`,
          })),
          cost: { amountMicro: 7, currency: 'USD' },
        }),
      )
      return
    }
    if (request.method === 'GET' && url.pathname === '/redirected-1.mp4') {
      response.writeHead(302, {
        Location: `${origin}/redirected-2.mp4?token=DO_NOT_LOG`,
      })
      response.end()
      return
    }
    if (request.method === 'GET' && url.pathname === '/redirected-2.mp4') {
      counts.download++
      response.writeHead(200, { 'Content-Type': 'video/mp4' })
      response.end(valid)
      return
    }
    if (request.method === 'GET' && url.pathname.startsWith('/outputs/')) {
      counts.download++
      if (mode === 'redirect') {
        response.writeHead(302, { Location: `${origin}/redirected-1.mp4?token=DO_NOT_LOG` })
        response.end()
        return
      }
      if (mode === 'unsafe-redirect') {
        response.writeHead(302, { Location: 'http://127.0.0.1:1/private.mp4' })
        response.end()
        return
      }
      const bytes =
        mode === 'html'
          ? Buffer.from('<html>not video</html>')
          : mode === 'truncated'
            ? valid.subarray(0, 32)
            : mode === 'wrong-duration'
              ? wrongDuration
              : mode === 'wrong-resolution'
                ? wrongResolution
                : valid
      response.writeHead(200, {
        'Content-Type':
          mode === 'octet-stream' ? 'application/octet-stream' : mode === 'html' ? 'video/mp4' : 'video/mp4',
        'Content-Length': String(bytes.length),
      })
      response.end(bytes)
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture listen failed')
  origin = `http://127.0.0.1:${address.port}`
  const profile = videoApiProfileSchema.parse({
    toolId: 'reference.video',
    displayName: 'Local Reference Video Fixture',
    baseEndpoint: origin,
    modelId: 'reference-video-v1',
    credentialRef: null,
    supportedCapabilities: ['video.textToVideo', 'video.imageToVideo'],
    supportedDurations: [1],
    supportedAspectRatios: ['1:1'],
    supportedResolutions: [{ width: 32, height: 32 }],
    resolutionMode: 'exact',
    durationToleranceSeconds: 0.2,
    supportsLastFrame: true,
    supportsReferenceImages: false,
    maxOutputCount: 4,
    polling: { initialIntervalMs: 50, maxIntervalMs: 75, maxWaitMs: 300 },
    maxDownloadBytes: 10 * 1024 * 1024,
    allowedDownloadHosts: [],
    allowedDownloadHostSuffixes: [],
    currency: 'USD',
    estimateSupport: 'unknown',
    cancelSupport: true,
    recoverSupport: true,
  })
  return {
    origin,
    profile,
    valid,
    counts,
    body: () => submittedBody,
    setMode(value: VideoFixtureMode) {
      mode = value
      statusReads = 0
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await rm(directory, { recursive: true, force: true })
    },
  }
}
