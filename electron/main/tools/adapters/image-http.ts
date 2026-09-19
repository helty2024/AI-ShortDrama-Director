import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { normalizeToolError } from '../errors.js'
import type { ToolError } from '../../../../src/shared/tools.js'

export interface ImageHttpDiagnostics {
  status: number | null
  contentType: string | null
  contentLength: number | null
  requestId: string | null
  host: string | null
  redirectCount: number
  redirectHosts: string[]
}
export interface TransportFailure {
  error: ToolError
  sent: boolean
  diagnostics?: ImageHttpDiagnostics
}
export function transportFailure(
  code: ToolError['code'],
  sent: boolean,
  diagnostics?: ImageHttpDiagnostics,
): TransportFailure {
  return {
    error: normalizeToolError({ code }),
    sent,
    ...(diagnostics ? { diagnostics } : {}),
  }
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
    !(n[0] === 192 && n[1] === 88 && n[2] === 99) &&
    !(n[0] === 100 && n[1] >= 64 && n[1] <= 127) &&
    !(n[0] === 198 && (n[1] === 18 || n[1] === 19)) &&
    !(n[0] === 198 && n[1] === 51 && n[2] === 100) &&
    !(n[0] === 203 && n[1] === 0 && n[2] === 113)
  )
}
const header = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
const safeContentLength = (value: string | null): number | null => {
  const parsed = value === null ? Number.NaN : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}
const errorCode = (status: number): ToolError['code'] =>
  status === 401
    ? 'authentication'
    : status === 403
      ? 'authorization'
      : status === 429
        ? 'rate-limit'
        : status >= 500
          ? 'provider'
          : 'validation'

/** Pins every request hop to a checked public IPv4 address. */
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
    options: {
      body?: string | Buffer
      contentType?: string
      key?: string
      limit: number
      redirects?: {
        max: number
        allowedHosts: readonly string[]
        allowedHostSuffixes?: readonly string[]
      }
    },
  ): Promise<{ bytes: Buffer; mime: string; diagnostics: ImageHttpDiagnostics }> {
    const caller = signal
    signal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
    let sent = false
    const redirectHosts: string[] = []
    const diagnostic = (
      target: URL | null,
      status: number | null = null,
      headers: import('node:http').IncomingHttpHeaders = {},
    ): ImageHttpDiagnostics => ({
      status,
      contentType: header(headers['content-type'])?.split(';')[0] ?? null,
      contentLength: safeContentLength(header(headers['content-length'])),
      requestId:
        header(headers['x-request-id']) ??
        header(headers['request-id']) ??
        header(headers['x-correlation-id']) ??
        header(headers['cf-ray']),
      host: target?.hostname ?? null,
      redirectCount: redirectHosts.length,
      redirectHosts: [...redirectHosts],
    })
    const validate = async (value: string): Promise<{
      url: URL
      fixture: boolean
      addresses: { address: string; family: 4 }[]
    }> => {
      const target = new URL(value)
      const fixture =
        this.fixtureOrigin === target.origin &&
        target.hostname === '127.0.0.1' &&
        target.protocol === 'http:'
      if (
        target.username ||
        target.password ||
        target.hash ||
        (!fixture && target.protocol !== 'https:') ||
        (options.redirects &&
          !fixture &&
          !options.redirects.allowedHosts.includes(target.hostname.toLowerCase()) &&
          !(options.redirects.allowedHostSuffixes ?? []).some(
            (suffix) =>
              target.hostname.toLowerCase() === suffix.toLowerCase() ||
              target.hostname.toLowerCase().endsWith(`.${suffix.toLowerCase()}`),
          ))
      )
        throw transportFailure('validation', false, diagnostic(target))
      if (!fixture && isIP(target.hostname) !== 0)
        throw transportFailure('authorization', false, diagnostic(target))
      const addresses = fixture
        ? [{ address: '127.0.0.1', family: 4 as const }]
        : await Promise.race([
            lookup(target.hostname, { all: true, family: 4 }),
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
        (!fixture && addresses.some((address) => !publicIPv4(address.address)))
      )
        throw transportFailure('authorization', false, diagnostic(target))
      return {
        url: target,
        fixture,
        addresses: addresses.map((address) => ({
          address: address.address,
          family: 4 as const,
        })),
      }
    }
    const requestOne = async (
      value: string,
    ): Promise<
      | { kind: 'bytes'; bytes: Buffer; diagnostics: ImageHttpDiagnostics }
      | { kind: 'redirect'; location: string; diagnostics: ImageHttpDiagnostics }
    > => {
      const target = await validate(value)
      signal.throwIfAborted()
      return new Promise((resolve, reject) => {
        const send = target.url.protocol === 'https:' ? httpsRequest : httpRequest
        const req = send(
          target.url,
          {
            method: options.body === undefined ? 'GET' : 'POST',
            signal,
            lookup: (_host, lookupOptions, done) =>
              lookupOptions.all
                ? done(
                    null,
                    target.addresses.map((address) => ({
                      address: address.address,
                      family: 4,
                    })),
                  )
                : done(null, target.addresses[0].address, 4),
            headers: {
              ...(options.body !== undefined
                ? { 'Content-Type': options.contentType ?? 'application/json' }
                : {}),
              ...(options.key
                ? { Authorization: `Bearer ${options.key}` }
                : {}),
            },
          },
          (res) => {
            const status = res.statusCode ?? 0
            const details = diagnostic(target.url, status, res.headers)
            if ([301, 302, 303, 307, 308].includes(status)) {
              const location = header(res.headers.location)
              res.resume()
              if (!options.redirects || !location) {
                reject(transportFailure('validation', sent, details))
                return
              }
              try {
                resolve({
                  kind: 'redirect',
                  location: new URL(location, target.url).toString(),
                  diagnostics: details,
                })
              } catch {
                reject(transportFailure('validation', sent, details))
              }
              return
            }
            if (status < 200 || status >= 300) {
              res.destroy()
              reject(transportFailure(errorCode(status), sent, details))
              return
            }
            if ((details.contentLength ?? 0) > options.limit) {
              res.destroy()
              reject(transportFailure('malformed-response', sent, details))
              return
            }
            const chunks: Buffer[] = []
            let size = 0
            res.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > options.limit) {
                res.destroy()
                reject(transportFailure('malformed-response', sent, details))
              } else chunks.push(chunk)
            })
            res.on('end', () =>
              resolve({
                kind: 'bytes',
                bytes: Buffer.concat(chunks),
                diagnostics: details,
              }),
            )
            res.on('error', () =>
              reject(transportFailure('network', sent, details)),
            )
          },
        )
        const timer = setTimeout(() => {
          req.destroy()
          reject(transportFailure('timeout', sent, diagnostic(target.url)))
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
              diagnostic(target.url),
            ),
          ),
        )
        sent = true
        req.end(options.body)
      })
    }
    try {
      let current = url
      for (;;) {
        const result = await requestOne(current)
        if (result.kind === 'bytes') {
          return {
            bytes: result.bytes,
            mime: result.diagnostics.contentType ?? '',
            diagnostics: result.diagnostics,
          }
        }
        if (
          !options.redirects ||
          redirectHosts.length >= options.redirects.max ||
          options.body !== undefined ||
          options.key !== undefined
        )
          throw transportFailure('validation', sent, result.diagnostics)
        const next = await validate(result.location)
        redirectHosts.push(next.url.hostname)
        current = next.url.toString()
      }
    } catch (raw) {
      if (raw && typeof raw === 'object' && 'sent' in raw) throw raw
      throw transportFailure(
        caller.aborted ? 'cancelled' : signal.aborted ? 'timeout' : 'network',
        sent,
      )
    }
  }
}
