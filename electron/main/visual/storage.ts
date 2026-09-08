import { probeVideo, videoThumbnail } from '../video/ffmpeg.js'
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  stat,
  readdir,
  realpath,
} from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { DomainError } from '../database.js'
export interface StoredImage {
  storageKey: string
  thumbnailPath: string
  hash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4'
  duration?: number
  fps?: number | null
  codec?: string | null
  width: number
  height: number
  fileSize: number
}
export class MediaStorage {
  readonly root: string
  constructor(root: string) {
    this.root = resolve(root)
  }
  private path(key: string) {
    if (
      !/^[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+(?:-thumb)?\.(png|jpg|webp|mp4)$/.test(
        key,
      )
    )
      throw new DomainError('FORBIDDEN', '非法素材路径')
    const path = resolve(this.root, key)
    const rel = relative(this.root, path)
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new DomainError('FORBIDDEN', '非法素材路径')
    return path
  }
  private async ensureSafe(path: string) {
    const root = await realpath(this.root)
    const actual = await realpath(path)
    const rel = relative(root, actual)
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new DomainError('FORBIDDEN', '素材不能越过受控目录')
    return actual
  }
  async read(key: string) {
    const path = await this.ensureSafe(this.path(key))
    const info = await stat(path)
    if (info.size > (key.endsWith('.mp4') ? 256 : 30) * 1024 * 1024)
      throw new DomainError('INVALID_INPUT', '图片超过 30 MB')
    return readFile(path)
  }
  async importFile(projectId: string, assetId: string, path: string) {
    const info = await stat(path)
    if (!info.isFile() || info.size > 30 * 1024 * 1024)
      throw new DomainError('INVALID_INPUT', '请选择不超过 30 MB 的图片')
    return this.store(projectId, assetId, await readFile(path))
  }
  async store(
    projectId: string,
    assetId: string,
    bytes: Uint8Array,
  ): Promise<StoredImage> {
    z.uuid().parse(projectId)
    z.uuid().parse(assetId)
    if (!bytes.length || bytes.length > 30 * 1024 * 1024)
      throw new DomainError('INVALID_INPUT', '图片大小无效')
    const input = sharp(bytes, {
      limitInputPixels: 40_000_000,
      failOn: 'error',
    })
    const metadata = await input.metadata()
    if (
      !['png', 'jpeg', 'webp'].includes(metadata.format) ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) > 1
    )
      throw new DomainError('INVALID_INPUT', '仅支持单帧 PNG、JPG、WEBP 图片')
    // Decode all pixels before committing either the original or the thumbnail.
    const thumb = await input
      .clone()
      .rotate()
      .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
      .webp()
      .toBuffer()
    const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format
    const hash = createHash('sha256').update(bytes).digest('hex')
    const folder = join(this.root, projectId, assetId)
    await mkdir(folder, { recursive: true })
    await this.ensureSafe(folder)
    const token = randomUUID(),
      storageKey = `${projectId}/${assetId}/${token}.${ext}`,
      thumbnailPath = `${projectId}/${assetId}/${token}-thumb.webp`
    for (const [key, data] of [
      [storageKey, bytes],
      [thumbnailPath, thumb],
    ] as const) {
      const path = this.path(key),
        temporary = path + '.tmp'
      await writeFile(temporary, data, { flag: 'wx' })
      await rename(temporary, path)
    }
    return {
      storageKey,
      thumbnailPath,
      hash,
      mimeType:
        metadata.format === 'jpeg'
          ? 'image/jpeg'
          : metadata.format === 'png'
            ? 'image/png'
            : 'image/webp',
      width: metadata.width,
      height: metadata.height,
      fileSize: bytes.length,
    }
  }
  async storeVideo(
    projectId: string,
    assetId: string,
    bytes: Uint8Array,
  ): Promise<StoredImage> {
    z.uuid().parse(projectId)
    z.uuid().parse(assetId)
    if (
      bytes.length < 12 ||
      bytes.length > 256 * 1024 * 1024 ||
      Buffer.from(bytes.subarray(4, 8)).toString() !== 'ftyp'
    )
      throw new DomainError('INVALID_INPUT', '仅支持不超过 256 MB 的 MP4')
    const folder = join(this.root, projectId, assetId)
    await mkdir(folder, { recursive: true })
    await this.ensureSafe(folder)
    const token = randomUUID(),
      storageKey = `${projectId}/${assetId}/${token}.mp4`,
      thumbnailPath = `${projectId}/${assetId}/${token}-thumb.webp`,
      path = this.path(storageKey)
    await writeFile(path + '.tmp', bytes, { flag: 'wx' })
    const metadata = await probeVideo(path + '.tmp')
    await videoThumbnail(path + '.tmp', this.path(thumbnailPath))
    await rename(path + '.tmp', path)
    return {
      ...metadata,
      storageKey,
      thumbnailPath,
      mimeType: 'video/mp4',
      hash: createHash('sha256').update(bytes).digest('hex'),
      fileSize: bytes.length,
    }
  }
  async scan(liveKeys: Set<string>): Promise<string[]> {
    const orphan: string[] = []
    const walk = async (folder: string) => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        const path = join(folder, entry.name)
        if (entry.isDirectory()) await walk(path)
        else {
          const key = relative(this.root, path).replaceAll('\\', '/')
          if (!liveKeys.has(key)) orphan.push(key)
        }
      }
    }
    await mkdir(this.root, { recursive: true })
    await walk(this.root)
    return orphan
  }
}
