import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const output = resolve('.cache/packy-paid-validation.cjs')
await build({
  entryPoints: ['electron/main/tools/packy-paid-validation.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'sharp'],
  logLevel: 'silent',
})
const pipeName = 'director-packy-paid-' + randomUUID()
let channel
let confirmation
const deliver = () => {
  if (channel && confirmation !== undefined) {
    channel.end(confirmation + '\n')
    confirmation = undefined
  }
}
const server = createServer((socket) => {
  channel = socket
  server.close()
  deliver()
})
await new Promise((resolve) =>
  server.listen(
    ['', '', '.', 'pipe', pipeName].join(String.fromCharCode(92)),
    resolve,
  ),
)
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(
  require('electron'),
  [output, '--confirmation-pipe=' + pipeName],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: environment,
  },
)
child.stdout.pipe(process.stdout)
child.stderr.resume()
process.stdin.setEncoding('utf8')
process.stdin.on('data', (data) => {
  confirmation = data.replace(/\r/g, '').split('\n')[0]
  deliver()
  process.stdin.pause()
})
child.on('exit', (code) => process.exit(code ?? 1))
