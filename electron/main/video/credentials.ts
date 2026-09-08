import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { AIError } from '../intelligence/provider.js'
export interface CredentialStore {
  get(reference: string): Promise<string>
  set(reference: string, secret: string): Promise<void>
  has(reference: string): Promise<boolean>
}
export interface SecretEncryption {
  available: () => boolean
  encrypt: (value: string) => Buffer
  decrypt: (value: Buffer) => string
}
export class EncryptedCredentialStore implements CredentialStore {
  private root: string
  private encryption: SecretEncryption
  constructor(root: string, encryption: SecretEncryption) {
    this.root = root
    this.encryption = encryption
  }
  private path(reference: string) {
    z.uuid().parse(reference)
    return join(this.root, reference + '.bin')
  }
  async set(reference: string, secret: string) {
    if (!this.encryption.available())
      throw new AIError('AUTH', '系统安全存储不可用，拒绝明文保存密钥')
    if (!secret.trim() || secret.length > 8192)
      throw new AIError('AUTH', '密钥为空或过长')
    await mkdir(this.root, { recursive: true })
    const path = this.path(reference),
      temp = path + '.tmp'
    await writeFile(temp, this.encryption.encrypt(secret.trim()), {
      mode: 0o600,
    })
    await rename(temp, path)
  }
  async get(reference: string) {
    if (!this.encryption.available())
      throw new AIError('AUTH', '系统安全存储不可用')
    try {
      return this.encryption.decrypt(await readFile(this.path(reference)))
    } catch {
      throw new AIError('AUTH', '找不到有效凭据，请在设置重新导入')
    }
  }
  async has(reference: string) {
    try {
      return (await stat(this.path(reference))).isFile()
    } catch {
      return false
    }
  }
}
