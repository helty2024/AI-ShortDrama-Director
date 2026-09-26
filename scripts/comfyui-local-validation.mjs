import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const recoverOnly = process.argv.includes('--recover-only')
if (!recoverOnly && !process.argv.includes('--confirm-one-local-image')) {
  throw new Error('Pass --confirm-one-local-image only after explicit authorization, or --recover-only for read-only recovery')
}
const output = resolve('.cache/comfyui-local-validation.cjs')
await build({
  entryPoints: ['electron/main/tools/comfyui-local-validation.ts'],
  outfile: output, bundle: true, platform: 'node', format: 'cjs',
  external: ['electron', 'sharp'], logLevel: 'silent',
})
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const electron = createRequire(import.meta.url)('electron')
async function run(flag) {
  const child = spawn(electron, [output, flag], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: environment,
  })
  child.stdout.pipe(process.stdout)
  // Only our structured diagnostics are printed; Electron/native logs can contain paths.
  let pending = ''
  child.stderr.on('data', (chunk) => {
    pending += chunk.toString()
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) if (line.startsWith('{')) process.stderr.write(line + '\n')
  })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}
let code = await run(recoverOnly ? '--recover-only' : '--confirm-one-local-image')
// A genuinely fresh Electron process, no retained adapter/grant/service state.
if (code === 0 && !recoverOnly) code = await run('--recover-only')
process.exitCode = code
