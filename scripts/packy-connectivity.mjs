import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
// This command performs GET /models only. No secret is passed in argv or environment.
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
const output = resolve('.cache/packy-connectivity.cjs')
await build({
  entryPoints: ['electron/main/tools/packy-connectivity.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'silent',
})
const importing = process.argv.includes('--import-key-stdin')
const pipeName = 'director-packy-' + randomUUID()
let channel
let secret
const deliver = () => {
  if (channel && secret !== undefined) {
    channel.end(secret + '\n')
    secret = undefined
    process.stdout.write('Secret delivered to Electron secure storage.\n')
  }
}
const server = importing
  ? createServer((socket) => {
      channel = socket
      server.close()
      deliver()
    })
  : null
if (server)
  await new Promise((resolve) =>
    server.listen(
      ['', '', '.', 'pipe', pipeName].join(String.fromCharCode(92)),
      resolve,
    ),
  )
const probeEnv = { ...process.env }
delete probeEnv.ELECTRON_RUN_AS_NODE
const child = spawn(
  require('electron'),
  [
    output,
    ...(importing ? ['--import-key-stdin', '--secret-pipe=' + pipeName] : []),
  ],
  {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: probeEnv,
  },
)
child.stdout.pipe(process.stdout)
// Suppress native stderr: only the structured, sanitized main-process report is emitted.
child.stderr.resume()
if (importing) {
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdout.write(
    'Ready for secret input (hidden); only GET /models will be sent.\n',
  )
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (data) => {
    if (data.includes('\u0003')) {
      child.kill()
      return
    }
    buffer += data.replace(/\r/g, '\n')
    if (buffer.length > 8192) {
      child.kill()
      return
    }
    if (buffer.includes('\n')) {
      secret = buffer.slice(0, buffer.indexOf('\n'))
      deliver()
      buffer = ''
      process.stdin.pause()
    }
  })
}
child.on('exit', (code) => {
  if (process.stdin.isTTY && importing) process.stdin.setRawMode(false)
  process.exit(code ?? 1)
})
