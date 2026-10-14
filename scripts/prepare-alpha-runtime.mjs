import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const execute = promisify(execFile)
const output = resolve('build/alpha-runtime')
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
if (process.platform !== 'win32' || manifest.version !== '0.9.0-alpha.1') throw new Error('Alpha Windows build only')
await mkdir(output, { recursive: true })
const report = { version: manifest.version, tools: [] }
for (const tool of ['ffmpeg', 'ffprobe']) {
  const configured = process.env[tool === 'ffmpeg' ? 'DIRECTOR_FFMPEG' : 'DIRECTOR_FFPROBE']
  const source = configured || (await execute('where.exe', [tool], { windowsHide: true })).stdout.trim().split(/\r?\n/)[0]
  if (!source) throw new Error('Media runtime not found')
  const version = (await execute(source, ['-version'], { windowsHide: true })).stdout.split(/\r?\n/)[0]
  await copyFile(source, join(output, tool + '.exe'))
  report.tools.push({ name: tool, version, sha256: createHash('sha256').update(await readFile(source)).digest('hex') })
  if (tool === 'ffmpeg') {
    // Preserve the original binary distribution's license and source/build notices.
    const distribution = dirname(dirname(source))
    await copyFile(join(distribution, 'LICENSE'), join(output, 'FFmpeg-LICENSE.txt'))
    await copyFile(join(distribution, 'README.txt'), join(output, 'FFmpeg-distribution-README.txt'))
  }
}
await writeFile(join(output, 'runtime-manifest.json'), JSON.stringify(report, null, 2) + '\n')
console.log('Alpha media runtime prepared with original license and notices.')
