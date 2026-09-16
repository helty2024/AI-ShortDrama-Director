import { createServer } from 'node:http'
import sharp from 'sharp'
import { imageApiProfileSchema } from '../../src/shared/image-api.js'
export type ImageFixtureMode =
  | 'ok'
  | 'url'
  | '400'
  | '401'
  | '403'
  | '429'
  | '500'
  | 'timeout'
  | 'drop'
  | 'json'
  | 'invalid-image'
  | 'wrong-mime'
  | 'wrong-size'
  | 'oversized'
  | 'redirect'
  | 'private-url'
export async function imageServer(
  mode: ImageFixtureMode = 'ok',
  onSubmit = () => {},
) {
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#568abc' },
  })
    .png()
    .toBuffer()
  const counts = { submit: 0, billing: 0, download: 0, reference: 0 }
  let origin = ''
  let body: unknown = null
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      counts.download++
      if (mode === 'redirect') {
        res.writeHead(302, { Location: 'http://127.0.0.1:1/private' })
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': mode === 'wrong-mime' ? 'text/html' : 'image/png',
        ...(mode === 'oversized'
          ? { 'Content-Length': String(40 * 1024 * 1024) }
          : {}),
      })
      res.end(bytes)
      return
    }
    counts.submit++
    onSubmit()
    let text = ''
    for await (const chunk of req) text += String(chunk)
    const input = JSON.parse(text) as { count: number; references?: unknown[] }
    body = input
    counts.reference += input.references?.length ?? 0
    if (/^\d+$/.test(mode)) {
      res.writeHead(Number(mode), { 'Content-Type': 'application/json' })
      res.end('{"secret":"DO_NOT_LOG"}')
      return
    }
    if (mode === 'timeout') return
    if (mode === 'drop') {
      req.socket.destroy()
      return
    }
    counts.billing++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (mode === 'json') {
      res.end('{not json SECRET')
      return
    }
    const image = ['url', 'oversized', 'redirect', 'wrong-mime'].includes(mode)
      ? { url: origin + '/image?token=DO_NOT_LOG' }
      : mode === 'private-url'
        ? { url: 'https://127.0.0.1/private' }
        : {
            base64: (mode === 'invalid-image'
              ? Buffer.from('<html>not an image</html>')
              : mode === 'wrong-size'
                ? await sharp(bytes).resize(16, 16).png().toBuffer()
                : bytes
            ).toString('base64'),
            mime: 'image/png',
          }
    res.end(
      JSON.stringify({
        images: Array.from({ length: input.count }, () => image),
        ...(mode === 'ok' ? { cost: { amountMicro: 3, currency: 'USD' } } : {}),
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error()
  origin = `http://127.0.0.1:${address.port}`
  const profile = imageApiProfileSchema.parse({
    toolId: 'reference.image',
    displayName: 'Local HTTP reference fixture',
    endpoint: origin + '/generate',
    modelId: 'reference-v1',
    credentialRef: null,
    supportedCapabilities: ['image.generate', 'image.referenceGenerate'],
    supportedResolutions: [{ width: 32, height: 32 }],
    supportedAspectRatios: ['1:1'],
    maxReferences: 8,
    maxOutputCount: 4,
    currency: 'USD',
    estimateSupport: 'unknown',
    cancelSupport: false,
    recoverSupport: false,
  })
  return {
    origin,
    profile,
    bytes,
    counts,
    body: () => body,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
