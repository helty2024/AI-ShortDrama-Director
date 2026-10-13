import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type CompShareMode = 'ok' | 'queued' | 'running' | 'failed' | 'cancelled' | 'unknown-submit' | 'malformed-submit' | 'malformed-status' | 'wrong-id' | 'missing-url' | 'status-401' | 'status-429' | 'status-500' | 'html' | 'truncated' | 'unsafe-url' | 'cancel-running' | 'probe-401' | 'probe-malformed' | 'probe-empty' | 'probe-over-reserved'
export async function compshareServer() {
  const directory = await mkdtemp(join(tmpdir(), 'compshare-fixture-'))
  const file = join(directory, 'output.mp4')
  await promisify(execFile)(process.env.DIRECTOR_FFMPEG || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=480x480:r=24:d=4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { windowsHide: true, timeout: 30000 })
  const video = await readFile(file)
  let origin = '', mode: CompShareMode = 'ok'
  let body: unknown = null
  const counts = { submit: 0, query: 0, download: 0, cancel: 0, probe: 0 }
  const submitKeys: (string | null)[] = []
  const downloadAuthorizationPresent: boolean[] = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, origin)
    const json = (data: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)) }
    if (url.pathname === '/output.mp4') {
      counts.download++; downloadAuthorizationPresent.push(request.headers.authorization !== undefined)
      response.writeHead(200, { 'Content-Type': mode === 'html' ? 'video/mp4' : 'application/octet-stream' })
      response.end(mode === 'html' ? Buffer.from('<html>SECRET</html>') : mode === 'truncated' ? video.subarray(0, 32) : video)
      return
    }
    if (request.headers.authorization !== 'Bearer sk-ml-FIXTURE_ONLY') { json({}, 401); return }
    if (request.method === 'GET' && url.pathname === '/minimax/v2/query/point_usage_summary') {
      counts.probe++
      json(mode === 'probe-malformed' ? { token: 'SECRET', total_points: 100, reserved_points: 150, available_points: 1 }
        : mode === 'probe-empty' ? { total_points: 0, reserved_points: 0, available_points: 0 }
          : mode === 'probe-over-reserved' ? { total_points: 100, reserved_points: 150, available_points: 0 }
            : { total_points: 100, reserved_points: 20, available_points: 80 }, mode === 'probe-401' ? 401 : 200)
      return
    }
    if (request.method === 'POST' && url.pathname === '/minimax/v2/video_generation') {
      counts.submit++
      const idempotencyKey = request.headers['idempotency-key']
      submitKeys.push(typeof idempotencyKey === 'string' ? idempotencyKey : null)
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (mode === 'unknown-submit') { request.socket.destroy(); return }
      json(mode === 'malformed-submit' ? { task_id: null, secret: 'SECRET' } : { task_id: 'remote-h3-1' })
      return
    }
    if (request.method === 'DELETE' && url.pathname === '/minimax/v2/video_generation/remote-h3-1') {
      counts.cancel++
      json({ task_id: 'remote-h3-1', action: 'delete', status: mode === 'cancel-running' ? 'running' : 'cancelled' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/minimax/v2/query/video_generation/remote-h3-1') {
      counts.query++
      if (mode.startsWith('status-')) { json({ secret: 'SECRET' }, Number(mode.slice(7))); return }
      if (mode === 'malformed-status') { json({ task: { status: 'running', secret: 'SECRET' } }); return }
      const status = ['queued', 'running', 'failed', 'cancelled'].includes(mode) ? mode : 'succeeded'
      json({ task: { id: mode === 'wrong-id' ? 'outsider' : 'remote-h3-1', model: 'MiniMax-H3', status,
        ...(mode === 'missing-url' ? {} : { content: { url: mode === 'unsafe-url' ? 'http://127.0.0.1:1/private' : `${origin}/output.mp4?signature=SECRET` } }),
        usage: { total_seconds: 4, output_seconds: 4, points: 20 }, error: { code: 'remote', message: 'SECRET' },
      } })
      return
    }
    json({}, 404)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable')
  origin = `http://127.0.0.1:${address.port}`
  return { origin, counts, submitKeys, downloadAuthorizationPresent, body: () => body, setMode: (value: CompShareMode) => { mode = value },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }) },
  }
}
