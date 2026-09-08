import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { VisualRepository } from './visual/repository.js'

/** Capabilities are issued by trusted IPC, never interpreted as filesystem paths. */
export class MediaBroker {
  private tokens = new Map<string, { projectId: string; versionId: string }>()
  private readonly visual: VisualRepository
  constructor(visual: VisualRepository) {
    this.visual = visual
  }
  issue(projectId: string, versionId: string) {
    this.visual.version(projectId, versionId)
    const token = randomUUID()
    if (this.tokens.size >= 4096)
      this.tokens.delete(this.tokens.keys().next().value ?? '')
    this.tokens.set(token, { projectId, versionId })
    return `director-media://asset/${token}`
  }
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const target =
      url.protocol === 'director-media:' &&
      url.hostname === 'asset' &&
      !url.search &&
      !url.hash
        ? this.tokens.get(url.pathname.slice(1))
        : undefined
    if (!target) return new Response(null, { status: 404 })
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405 })
    try {
      // Revalidate registration on every range request, including after deletion.
      const version = this.visual.version(target.projectId, target.versionId)
      if (version.mimeType !== 'video/mp4')
        return new Response(null, { status: 403 })
      const path = await this.visual.storage.resolveRegisteredFile(
        version.storageKey,
      )
      const file = await open(path, 'r')
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > 256 * 1024 * 1024)
          throw new Error('Invalid media')
        const range = parseRange(request.headers.get('range'), info.size)
        const headers = new Headers({
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        if (!range) {
          await file.close()
          headers.set('Content-Range', `bytes */${info.size}`)
          return new Response(null, { status: 416, headers })
        }
        headers.set('Content-Length', String(range.end - range.start + 1))
        if (range.partial)
          headers.set(
            'Content-Range',
            `bytes ${range.start}-${range.end}/${info.size}`,
          )
        if (request.method === 'HEAD') {
          await file.close()
          return new Response(null, {
            status: range.partial ? 206 : 200,
            headers,
          })
        }
        const stream = file.createReadStream({
          start: range.start,
          end: range.end,
          autoClose: true,
        })
        return new Response(
          Readable.toWeb(stream) as ReadableStream<Uint8Array>,
          { status: range.partial ? 206 : 200, headers },
        )
      } catch (error) {
        await file.close()
        throw error
      }
    } catch {
      return new Response(null, { status: 404 })
    }
  }
}
export function parseRange(value: string | null, size: number) {
  if (size <= 0) return null
  if (value === null) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]))
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null
  return { start, end, partial: true }
}
