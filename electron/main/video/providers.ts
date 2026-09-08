import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { lookup } from 'node:dns/promises'
import { z } from 'zod'
import type {
  VideoGenerationRequest,
  VideoProfile,
} from '../../../src/shared/video.js'
import { AIError, normalizeAIError } from '../intelligence/provider.js'
import type { CredentialStore } from './credentials.js'
import { runMediaTool } from './ffmpeg.js'
import { renderVideoPrompt } from './compiler.js'
export type RemoteVideoStatus = {
  status:
    'submitted' | 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  videoUrl?: string
  billing?: Record<string, z.infer<ReturnType<typeof z.json>>>
}
export interface VideoInputs {
  start: Uint8Array
  startMime: string
  end?: Uint8Array
  endMime?: string
}
export interface VideoGenerationProvider {
  id: string
  displayName: string
  capabilities: VideoProfile['capabilities']
  healthCheck(): Promise<string>
  submit(
    request: VideoGenerationRequest,
    inputs: VideoInputs,
    signal: AbortSignal,
  ): Promise<string>
  getStatus(id: string, signal: AbortSignal): Promise<RemoteVideoStatus>
  cancel(id: string): Promise<void>
  fetchResult(
    id: string,
    status: RemoteVideoStatus,
    request: VideoGenerationRequest,
    inputs: VideoInputs,
    signal: AbortSignal,
  ): Promise<Uint8Array>
  normalizeError(error: unknown): AIError
}
const cancelledMocks = new Set<string>()
export class MockVideoProvider implements VideoGenerationProvider {
  id = 'mock-video'
  displayName = 'Mock Video'
  capabilities: VideoProfile['capabilities']
  private root: string
  constructor(root: string, capabilities: VideoProfile['capabilities']) {
    this.root = root
    this.capabilities = capabilities
  }
  normalizeError = normalizeAIError
  async healthCheck() {
    await runMediaTool('ffmpeg', ['-version'])
    await runMediaTool('ffprobe', ['-version'])
    return 'Mock Video Ready：FFmpeg / FFprobe 可用'
  }
  async submit(
    request: VideoGenerationRequest,
    _inputs: VideoInputs,
    signal: AbortSignal,
  ) {
    if (signal.aborted) throw new AIError('CANCELLED', '已取消')
    return `mock-${Date.now()}-${createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 12)}-${randomUUID()}`
  }
  async getStatus(id: string, signal: AbortSignal): Promise<RemoteVideoStatus> {
    if (signal.aborted) throw new AIError('CANCELLED', '已取消')
    if (cancelledMocks.has(id)) return { status: 'cancelled', progress: 0 }
    if (!/^mock-\d+-/.test(id))
      throw new AIError('INVALID_OUTPUT', 'Mock 任务 ID 无效')
    const done = Date.now() - Number(id.split('-')[1]) >= 150
    return {
      status: done ? 'succeeded' : 'processing',
      progress: done ? 1 : 0.5,
    }
  }
  async cancel(id: string) {
    cancelledMocks.add(id)
  }
  async fetchResult(
    _id: string,
    _status: RemoteVideoStatus,
    request: VideoGenerationRequest,
    inputs: VideoInputs,
    signal: AbortSignal,
  ) {
    await mkdir(this.root, { recursive: true })
    const dir = await mkdtemp(join(this.root, 'mock-'))
    try {
      const start = join(dir, 'start.png'),
        output = join(dir, 'video.mp4')
      await writeFile(start, inputs.start)
      const size =
        request.resolution === '1080p'
          ? 1080
          : request.resolution === '720p'
            ? 720
            : 480
      const even = (v: number) => Math.round(v / 2) * 2
      const [w, h] =
        request.prompt.aspectRatio === '9:16'
          ? [even((size * 9) / 16), size]
          : request.prompt.aspectRatio === '1:1'
            ? [size, size]
            : request.prompt.aspectRatio === '4:3'
              ? [even((size * 4) / 3), size]
              : [even((size * 16) / 9), size]
      await runMediaTool(
        'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-loop',
          '1',
          '-i',
          start,
          '-t',
          String(request.prompt.duration),
          '-vf',
          `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,drawbox=x=10:y=10:w=40:h=40:color=white@0.4:t=fill`,
          '-r',
          '12',
          '-c:v',
          'libx264',
          '-threads',
          '1',
          '-pix_fmt',
          'yuv420p',
          '-fflags',
          '+bitexact',
          '-flags:v',
          '+bitexact',
          '-movflags',
          '+faststart',
          '-y',
          output,
        ],
        signal,
      )
      return await readFile(output)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}
export function validateVideoUrl(value: string) {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    )
  )
    throw new AIError(
      'PROVIDER',
      '视频服务必须使用 HTTPS 或本机 HTTP，URL 不得含认证信息',
    )
  return url.href.replace(/\/$/, '')
}
export async function validateDownloadUrl(value: string, profileUrl: string) {
  const u = new URL(value),
    base = new URL(profileUrl)
  const loop = ['127.0.0.1', 'localhost', '[::1]']
  if (u.username || u.password || u.hash)
    throw new AIError('INVALID_OUTPUT', '视频下载 URL 无效')
  if (
    loop.includes(base.hostname) &&
    u.hostname === base.hostname &&
    u.protocol === base.protocol
  )
    return u.href
  if (u.protocol !== 'https:')
    throw new AIError('INVALID_OUTPUT', '云视频下载必须为 HTTPS')
  const addresses = await lookup(u.hostname, { all: true })
  if (
    !addresses.length ||
    addresses.some(({ address: a }) =>
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::|fc|fd|fe80)/i.test(
        a,
      ),
    )
  )
    throw new AIError('INVALID_OUTPUT', '拒绝内网视频下载地址')
  return u.href
}
export class SeedanceVideoProvider implements VideoGenerationProvider {
  id = 'seedance'
  displayName = 'Seedance'
  capabilities: VideoProfile['capabilities']
  private profile: VideoProfile
  private credentials: CredentialStore
  private fetcher: typeof fetch
  constructor(
    profile: VideoProfile,
    credentials: CredentialStore,
    fetcher: typeof fetch = fetch,
  ) {
    this.profile = { ...profile, baseUrl: validateVideoUrl(profile.baseUrl) }
    this.credentials = credentials
    this.fetcher = fetcher
    this.capabilities = profile.capabilities
  }
  normalizeError = normalizeAIError
  private async api(
    path: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ) {
    if (!this.profile.credentialRef)
      throw new AIError('AUTH', '请先通过安全凭据层配置 Seedance 密钥')
    const key = await this.credentials.get(this.profile.credentialRef)
    let response: Response
    try {
      response = await this.fetcher(
        this.profile.baseUrl + this.profile.taskPath + path,
        {
          method,
          redirect: 'error',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      )
    } catch {
      throw new AIError(
        'NETWORK',
        '视频服务请求失败；提交结果可能未知，请勿自动重交',
      )
    }
    if (response.status === 401 || response.status === 403)
      throw new AIError('AUTH', '视频 Provider 认证失败')
    if (!response.ok)
      throw new AIError(
        response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER',
        `视频服务 HTTP ${response.status}，请核对 endpoint、模型和能力`,
      )
    if (response.status === 204) return {}
    return response.json() as Promise<unknown>
  }
  async healthCheck() {
    if (
      !this.profile.credentialRef ||
      !(await this.credentials.has(this.profile.credentialRef))
    )
      throw new AIError('AUTH', '尚未配置安全凭据')
    await this.api('?page_size=1', 'GET', undefined)
    return 'Seedance Ready：任务查询接口与凭据可用（未提交付费任务）'
  }
  async submit(
    request: VideoGenerationRequest,
    inputs: VideoInputs,
    signal: AbortSignal,
  ) {
    const p = request.prompt,
      content: unknown[] = [
        { type: 'text', text: renderVideoPrompt(p) },
        {
          type: 'image_url',
          image_url: {
            url: `data:${inputs.startMime};base64,${Buffer.from(inputs.start).toString('base64')}`,
          },
          role: 'first_frame',
        },
      ]
    if (p.optionalEndFrameAssetVersionId) {
      if (!this.capabilities.endFrame || !inputs.end)
        throw new AIError('INVALID_OUTPUT', '此 Provider 不支持尾帧')
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${inputs.endMime};base64,${Buffer.from(inputs.end).toString('base64')}`,
        },
        role: 'last_frame',
      })
    }
    const response = z.object({ id: z.string().min(1).max(200) }).parse(
      await this.api(
        '',
        'POST',
        {
          model: this.profile.model,
          content,
          duration: p.duration,
          ratio: p.aspectRatio,
          resolution: request.resolution,
          ...(this.capabilities.seed ? { seed: request.seed } : {}),
        },
        signal,
      ),
    )
    return response.id
  }
  async getStatus(id: string, signal: AbortSignal): Promise<RemoteVideoStatus> {
    const r = z
      .object({
        status: z.enum([
          'submitted',
          'queued',
          'running',
          'processing',
          'succeeded',
          'failed',
          'cancelled',
          'canceled',
          'expired',
        ]),
        content: z
          .object({ video_url: z.string().max(8000).optional() })
          .optional(),
        usage: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(
        await this.api('/' + encodeURIComponent(id), 'GET', undefined, signal),
      )
    return {
      status:
        r.status === 'running'
          ? 'processing'
          : r.status === 'canceled'
            ? 'cancelled'
            : r.status === 'expired'
              ? 'failed'
              : r.status,
      progress:
        r.status === 'succeeded'
          ? 1
          : r.status === 'running' || r.status === 'processing'
            ? 0.5
            : 0,
      videoUrl: r.content?.video_url,
      billing: Object.fromEntries(
        Object.entries(r.usage ?? {}).filter(
          (entry): entry is [string, number | boolean] =>
            (typeof entry[1] === 'number' && Number.isFinite(entry[1])) ||
            typeof entry[1] === 'boolean',
        ),
      ),
    }
  }
  async cancel(id: string) {
    if (this.capabilities.cancel)
      await this.api('/' + encodeURIComponent(id), 'DELETE', undefined)
  }
  async fetchResult(
    _id: string,
    status: RemoteVideoStatus,
    _request: VideoGenerationRequest,
    _inputs: VideoInputs,
    signal: AbortSignal,
  ) {
    if (!status.videoUrl)
      throw new AIError('INVALID_OUTPUT', '任务成功但没有视频 URL')
    const url = await validateDownloadUrl(status.videoUrl, this.profile.baseUrl)
    let response: Response
    try {
      response = await this.fetcher(url, {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
      })
    } catch {
      throw new AIError('NETWORK', '视频下载失败，可按远端任务 ID 重试下载')
    }
    if (
      !response.ok ||
      !/^video\/mp4(?:;|$)/i.test(response.headers.get('content-type') ?? '')
    )
      throw new AIError('INVALID_OUTPUT', '视频响应不是 MP4')
    const reader = response.body?.getReader()
    if (!reader) throw new AIError('INVALID_OUTPUT', '视频内容为空')
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      for (;;) {
        const c = await reader.read()
        if (c.done) break
        size += c.value.length
        if (size > 256 * 1024 * 1024)
          throw new AIError('INVALID_OUTPUT', '视频超过 256 MB')
        chunks.push(c.value)
      }
    } finally {
      await reader.cancel()
    }
    return Buffer.concat(chunks)
  }
}
