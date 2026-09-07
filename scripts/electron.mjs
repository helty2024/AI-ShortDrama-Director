import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (!['dev', 'preview'].includes(mode)) throw new Error('Expected dev or preview')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const cli = fileURLToPath(new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url))
const child = spawn(process.execPath, [cli, mode], { stdio: 'inherit', env: environment })
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
