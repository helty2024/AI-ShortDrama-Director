import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectDatabase } from '../../electron/main/database.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

test('0.8.0-rc.1 package metadata and database schema remain consistent', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version: string
  }
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as {
    version: string
    packages: Record<string, { version?: string }>
  }
  const builder = await readFile(join(root, 'electron-builder.yml'), 'utf8')
  const database = new ProjectDatabase(':memory:')

  try {
    assert.equal(manifest.version, '0.8.0-rc.1')
    assert.equal(lock.version, manifest.version)
    assert.equal(lock.packages['']?.version, manifest.version)
    assert.match(builder, /^productName: AI ShortDrama Director$/m)
    assert.match(
      builder,
      /^artifactName: AI-ShortDrama-Director-Setup-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m,
    )
    assert.match(builder, /^\s+arch: \[x64\]$/m)
    assert.equal(
      Number(
        database.connection.prepare('PRAGMA user_version').get()?.user_version,
      ),
      10,
    )
  } finally {
    database.close()
  }
})
