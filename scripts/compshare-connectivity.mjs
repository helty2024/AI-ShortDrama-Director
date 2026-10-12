import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const valid = args.length === 0 || (args.length === 1 && args[0] === '--configure') ||
  (args.length === 2 && args[0] === '--import-key-file' && Boolean(args[1]) && !args[1].startsWith('--'))
if (!valid) {
  process.stderr.write('用法：npm run validate:compshare [-- --configure | -- --import-key-file <本机文件路径>]\n')
  process.exit(2)
}
const output = resolve('.cache/compshare-connectivity.cjs')
await build({ entryPoints: ['electron/main/tools/compshare-connectivity.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' })
const env = { ...process.env }
for (const key of ['ELECTRON_RUN_AS_NODE', 'DIRECTOR_TEST_USER_DATA', 'DIRECTOR_TEST_COMPSHARE_ORIGIN']) delete env[key]
const child = spawn(require('electron'), [output, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env })
child.stdout.pipe(process.stdout)
// Provider/native messages are not copied to logs. Emit only sanitized reports.
child.stderr.resume()
child.on('error', () => { process.stderr.write('无法启动本机 CompShare 检测工具。\n'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
