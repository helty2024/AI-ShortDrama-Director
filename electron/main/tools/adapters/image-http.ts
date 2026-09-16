import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { normalizeToolError } from '../errors.js'
import type { ToolError } from '../../../../src/shared/tools.js'
export interface TransportFailure {
  error: ToolError
  sent: boolean
}
export function transportFailure(
  code: ToolError['code'],
  sent: boolean,
): TransportFailure {
  return { error: normalizeToolError({ code }), sent }
}
const publicIPv4 = (a: string) => {
  const n = a.split('.').map(Number)
  return (
    n.length === 4 &&
    ![0, 10, 127].includes(n[0]) &&
    n[0] < 224 &&
    !(n[0] === 169 && n[1] === 254) &&
    !(n[0] === 172 && n[1] >= 16 && n[1] <= 31) &&
    !(n[0] === 192 && (n[1] === 168 || n[1] === 0)) &&
    !(n[0] === 100 && n[1] >= 64 && n[1] <= 127) &&
    !(n[0] === 198 && (n[1] === 18 || n[1] === 19))
  )
}
/** Pins DNS to a checked IPv4 address. IPv6 and all redirects are conservatively refused. */
export class ImageHttpTransport {
  readonly fixtureOrigin: string | null
  readonly timeoutMs: number
  constructor(options: { fixtureOrigin?: string; timeoutMs?: number } = {}) {
    this.fixtureOrigin = options.fixtureOrigin ?? null
    this.timeoutMs = options.timeoutMs ?? 30000
  }
  async bytes(
    url: string,
    signal: AbortSignal,
    options: { body?: string; key?: string; limit: number },
  ): Promise<{ bytes: Buffer; mime: string }> {
    const caller = signal
    signal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
    let sent = false
    try {
      const u = new URL(url)
      const fixture =
        this.fixtureOrigin === u.origin &&
        u.hostname === '127.0.0.1' &&
        u.protocol === 'http:'
      if (
        u.username ||
        u.password ||
        u.hash ||
        (!fixture && (u.protocol !== 'https:' || isIP(u.hostname) === 6))
      )
        throw transportFailure('validation', false)
      const addresses = fixture
        ? [{ address: '127.0.0.1', family: 4 }]
        : await Promise.race([
            lookup(u.hostname, { all: true, family: 4 }),
            new Promise<never>((_resolve, reject) => {
              if (signal.aborted) reject(new Error('aborted'))
              else
                signal.addEventListener(
                  'abort',
                  () => reject(new Error('aborted')),
                  { once: true },
                )
            }),
          ])
      if (
        !addresses.length ||
        (!fixture && addresses.some((a) => !publicIPv4(a.address)))
      )
        throw transportFailure('authorization', false)
      signal.throwIfAborted()
      return await new Promise((resolve, reject) => {
        const send = u.protocol === 'https:' ? httpsRequest : httpRequest
        const req = send(
          u,
          {
            method: options.body === undefined ? 'GET' : 'POST',
            signal,
            lookup: (_host, opts, done) =>
              opts.all
                ? done(
                    null,
                    addresses.map((a) => ({ address: a.address, family: 4 })),
                  )
                : done(null, addresses[0].address, 4),
            headers: {
              ...(options.body !== undefined
                ? { 'Content-Type': 'application/json' }
                : {}),
              ...(options.key
                ? { Authorization: `Bearer ${options.key}` }
                : {}),
            },
          },
          (res) => {
            const status = res.statusCode ?? 0
            if (status < 200 || status >= 300) {
              res.destroy()
              reject(
                transportFailure(
                  status === 401
                    ? 'authentication'
                    : status === 403
                      ? 'authorization'
                      : status === 429
                        ? 'rate-limit'
                        : status >= 500
                          ? 'provider'
                          : 'validation',
                  sent,
                ),
              )
              return
            }
            if (Number(res.headers['content-length'] ?? 0) > options.limit) {
              res.destroy()
              reject(transportFailure('malformed-response', sent))
              return
            }
            const chunks: Buffer[] = []
            let size = 0
            res.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > options.limit) {
                res.destroy()
                reject(transportFailure('malformed-response', sent))
              } else chunks.push(chunk)
            })
            res.on('end', () =>
              resolve({
                bytes: Buffer.concat(chunks),
                mime: String(res.headers['content-type'] ?? '').split(';')[0],
              }),
            )
            res.on('error', () => reject(transportFailure('network', sent)))
          },
        )
        const timer = setTimeout(() => {
          req.destroy()
          reject(transportFailure('timeout', sent))
        }, this.timeoutMs)
        req.on('close', () => clearTimeout(timer))
        req.on('error', () =>
          reject(
            transportFailure(
              caller.aborted
                ? 'cancelled'
                : signal.aborted
                  ? 'timeout'
                  : 'network',
              sent,
            ),
          ),
        )
        // From this point onward, the server may receive headers/body. No absence of response proves no charge.
        sent = true
        req.end(options.body)
      })
    } catch (raw) {
      if (raw && typeof raw === 'object' && 'sent' in raw) throw raw
      throw transportFailure(
        caller.aborted ? 'cancelled' : signal.aborted ? 'timeout' : 'network',
        sent,
      )
    }
  }
}
