import {
  capabilityContracts,
  type CapabilityOutput,
} from '../../src/shared/capabilities/index.js'
import type { ImageCapability } from '../../electron/main/tools/adapters/image-api.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { imageServer, type ImageFixtureMode } from '../fixtures/image-http.js'
import { ProjectDatabase } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { VisualRepository } from '../../electron/main/visual/repository.js'
import { MediaStorage } from '../../electron/main/visual/storage.js'
import { ImageApiAdapter } from '../../electron/main/tools/adapters/image-api.js'
import { ImageHttpTransport } from '../../electron/main/tools/adapters/image-http.js'
import { ImageGenerationService } from '../../electron/main/generation/image-service.js'
import { imageApiCommandSchema } from '../../src/shared/image-api.js'
async function fixture(mode: ImageFixtureMode = 'ok') {
  const dir = await mkdtemp(join(tmpdir(), 'image-api-')),
    path = join(dir, 'db.sqlite'),
    db = new ProjectDatabase(path),
    p = db.create({
      name: 'Image API',
      description: '',
      genre: 'drama',
      language: 'zh-CN',
      aspectRatio: '9:16',
    })
  db.insertEntities(p.id, buildSeed(p.id))
  const target = db
    .workspace(p.id)
    .entities.find((e) => e.kind === 'character')!
  const visual = new VisualRepository(
    new IntelligenceRepository(db),
    new MediaStorage(join(dir, 'media')),
  )
  const server = await imageServer(mode, () => {
    const r = db.connection
      .prepare('SELECT data FROM approval_reservations WHERE project_id=?')
      .get(p.id)
    assert.ok(r)
    assert.equal(JSON.parse(String(r.data)).status, 'submitted')
    assert.ok(
      db.connection
        .prepare('SELECT id FROM generation_records WHERE project_id=?')
        .get(p.id),
    )
    assert.ok(
      db.connection
        .prepare('SELECT id FROM ai_tasks WHERE project_id=?')
        .get(p.id),
    )
  })
  const adapter = new ImageApiAdapter(
      server.profile,
      async () => 'FIXTURE_SECRET',
      new ImageHttpTransport({ fixtureOrigin: server.origin, timeoutMs: 200 }),
    ),
    service = new ImageGenerationService(visual, [adapter])
  const input = {
    projectId: p.id,
    targetId: target.id,
    toolId: server.profile.toolId,
    resolution: { width: 32, height: 32 },
    aspectRatio: '1:1' as const,
    count: 1,
    references: [],
    allowAssetUpload: true,
    localOnly: false,
  }
  return {
    dir,
    path,
    db,
    p,
    target,
    visual,
    server,
    adapter,
    service,
    input,
    close: async () => {
      db.close()
      await server.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
for (const count of [1, 4])
  test(`HTTP ${count} outputs: preview, explicit approval, candidates, review/adopt and restart`, async () => {
    const f = await fixture()
    try {
      const preview = await f.service.preview({ ...f.input, count })
      assert.equal(f.server.counts.submit, 0)
      assert.equal(f.server.counts.billing, 0)
      assert.throws(
        () => f.service.confirm(f.p.id, randomUUID(), 20, true),
        /预览/,
      )
      const task = f.service.confirm(f.p.id, preview.id, 20, true)
      await f.service.wait(task.id)
      const q = f.service.query(f.p.id, task.id)
      assert.equal(q.task.status, 'succeeded', JSON.stringify(q.task.error))
      assert.equal(q.versions.length, count)
      assert.equal(q.record.outputAssetVersionIds.length, count)
      assert.equal(q.record.actualCost!.amountMicros, 3)
      assert.equal(f.server.counts.submit, 1)
      assert.equal(f.server.counts.billing, 1)
      assert.equal(
        q.versions.every((v) => v.status === 'draft'),
        true,
      )
      assert.equal(
        f.visual.repo.entity(f.p.id, f.target.id).revision,
        f.target.revision,
      )
      assert.throws(
        () => f.service.confirm(f.p.id, preview.id, 20, true),
        /预览/,
      )
      const v = f.service.review(
        f.p.id,
        q.versions[0].id,
        q.versions[0].revision,
        true,
        f.target.revision,
      )
      assert.equal(v.status, 'approved')
      const reopen = new ProjectDatabase(f.path),
        visual = new VisualRepository(
          new IntelligenceRepository(reopen),
          new MediaStorage(join(f.dir, 'media')),
        ),
        service = new ImageGenerationService(visual, [])
      try {
        const after = service.query(f.p.id, task.id)
        assert.equal(after.versions[0].status, 'approved')
        const target = visual.repo.entity(f.p.id, f.target.id)
        assert.ok(
          'visualReferences' in target &&
            target.visualReferences.some(
              (r) => r.primary && r.assetId === v.assetId,
            ),
        )
        assert.deepEqual(
          after.record.outputAssetVersionIds,
          q.record.outputAssetVersionIds,
        )
      } finally {
        reopen.close()
      }
      assert.equal(JSON.stringify(q).includes('FIXTURE_SECRET'), false)
    } finally {
      await f.close()
    }
  })
test('reference images are controlled bytes; privacy gates before HTTP and no provider field escapes', async () => {
  const f = await fixture()
  try {
    const path = join(f.dir, 'ref.png')
    await (await import('node:fs/promises')).writeFile(path, f.server.bytes)
    const version = await f.visual.importFile(f.p.id, path, 'ref', null),
      input = {
        ...f.input,
        references: [
          { assetVersionId: version.id, role: 'identity' as const, weight: 1 },
        ],
      }
    await assert.rejects(
      f.service.preview({ ...input, allowAssetUpload: false }),
    )
    await assert.rejects(f.service.preview({ ...input, localOnly: true }))
    assert.equal(f.server.counts.submit, 0)
    const preview = await f.service.preview(input)
    assert.equal(preview.referenceCount, 1)
    const task = f.service.confirm(f.p.id, preview.id, 20, true)
    await f.service.wait(task.id)
    assert.equal(f.service.query(f.p.id, task.id).task.status, 'succeeded')
    assert.equal(f.server.counts.reference, 1)
    assert.match(JSON.stringify(f.server.body()), /base64/)
    assert.doesNotMatch(
      JSON.stringify(f.server.body()),
      /storageKey|file:\/\/|FIXTURE_SECRET/,
    )
  } finally {
    await f.close()
  }
})
for (const [mode, code] of [
  ['400', 'validation'],
  ['401', 'authentication'],
  ['403', 'authorization'],
  ['429', 'rate-limit'],
  ['500', 'provider'],
  ['timeout', 'timeout'],
  ['drop', 'network'],
  ['json', 'malformed-response'],
  ['invalid-image', 'malformed-response'],
  ['wrong-mime', 'malformed-response'],
  ['wrong-size', 'malformed-response'],
  ['oversized', 'malformed-response'],
  ['redirect', 'validation'],
  ['private-url', 'authorization'],
] as const)
  test(`HTTP ${mode}: normalized error, no candidates or retry, budget held`, async () => {
    const f = await fixture(mode)
    try {
      const preview = await f.service.preview(f.input),
        task = f.service.confirm(f.p.id, preview.id, 20, true)
      await f.service.wait(task.id)
      const q = f.service.query(f.p.id, task.id)
      assert.equal(q.task.status, 'failed')
      assert.equal(q.task.error!.code, code)
      assert.equal(q.versions.length, 0)
      assert.equal(f.server.counts.submit, 1)
      assert.equal(
        f.service.approvals.repository.used(f.p.id, q.record.approvalId!),
        20n,
      )
      const reopen = new ProjectDatabase(f.path),
        service = new ImageGenerationService(
          new VisualRepository(
            new IntelligenceRepository(reopen),
            f.visual.storage,
          ),
          [f.adapter],
        )
      try {
        assert.equal(
          service.query(f.p.id, task.id).record.outcome,
          'unknown-submission',
        )
        assert.equal(
          service.approvals.repository.used(f.p.id, q.record.approvalId!),
          20n,
        )
      } finally {
        reopen.close()
      }
      assert.equal(f.server.counts.submit, 1)
      assert.doesNotMatch(JSON.stringify(q), /FIXTURE_SECRET|DO_NOT_LOG/)
    } finally {
      await f.close()
    }
  })
test('temporary provider URL ingests bytes, stores hash, never stores signed URL', async () => {
  const f = await fixture('url')
  try {
    const preview = await f.service.preview(f.input),
      task = f.service.confirm(f.p.id, preview.id, 20, true)
    await f.service.wait(task.id)
    const q = f.service.query(f.p.id, task.id)
    assert.equal(q.task.status, 'succeeded')
    assert.equal(f.server.counts.download, 1)
    assert.match(q.versions[0].hash, /^[a-f0-9]{64}$/)
    assert.doesNotMatch(JSON.stringify(q), /token=|DO_NOT_LOG/)
    assert.equal(q.record.actualCost, null)
    assert.equal(
      f.service.approvals.repository.used(f.p.id, q.record.approvalId!),
      20n,
    )
  } finally {
    await f.close()
  }
})
test('credentials missing after preview prove unsent and release; unknown cost requires explicit authorization', async () => {
  const f = await fixture()
  try {
    let key = true
    f.service.registry.unregister(f.adapter.profile.toolId, '1.0.0')
    const adapter = new ImageApiAdapter(
      f.server.profile,
      async () => {
        if (!key) throw new Error('missing')
        return 'SECRET'
      },
      f.adapter.transport,
    )
    f.service.register(adapter)
    let preview = await f.service.preview(f.input)
    assert.throws(
      () => f.service.confirm(f.p.id, preview.id, 20, false),
      /unknown-cost-not-authorized/,
    )
    preview = await f.service.preview(f.input)
    key = false
    const task = f.service.confirm(f.p.id, preview.id, 20, true)
    await f.service.wait(task.id)
    const q = f.service.query(f.p.id, task.id)
    assert.equal(q.task.status, 'failed')
    assert.equal(f.server.counts.submit, 0)
    assert.equal(
      f.service.approvals.repository.used(f.p.id, q.record.approvalId!),
      0n,
    )
  } finally {
    await f.close()
  }
})
test('IPC schema rejects arbitrary endpoint, record, reservation and cross-project preview', async () => {
  assert.equal(
    imageApiCommandSchema.safeParse({
      op: 'preview',
      endpoint: 'http://localhost',
      input: {},
    }).success,
    false,
  )
  assert.equal(
    imageApiCommandSchema.safeParse({ op: 'createApproval', confirmed: true })
      .success,
    false,
  )
  const f = await fixture()
  try {
    const preview = await f.service.preview(f.input)
    assert.throws(
      () => f.service.confirm(randomUUID(), preview.id, 20, true),
      /不属于/,
    )
    assert.equal(f.server.counts.submit, 0)
  } finally {
    await f.close()
  }
})

test('async accepted service lifecycle persists remote handle and uses status/result without a second submit', async () => {
  const f = await fixture()
  try {
    const original = f.adapter
    let completed: Awaited<ReturnType<typeof original.submit>> | null = null
    let polls = 0
    const adapter: import('../../electron/main/tools/adapters/image-api.js').ImageApiTool =
      {
        profile: original.profile,
        describe: () => original.describe(),
        health: (s) => original.health(s),
        validate: (c, i, x, s) => original.validate(c, i, x, s),
        estimate: (c, i, x, s) => original.estimate(c, i, x, s),
        authorizeInputs: (c, a) => original.authorizeInputs(c, a),
        submit: async (c, i, x, s) => {
          completed = await original.submit(c, i, x, s)
          return {
            state: 'accepted',
            handle: {
              toolId: original.profile.toolId,
              toolVersion: '1.0.0',
              externalTaskId: 'fixture-async',
            },
          }
        },
        status: async () => {
          polls++
          return { state: 'succeeded' }
        },
        result: async <C extends ImageCapability>(c: C) => {
          if (!completed || completed.state !== 'completed') throw new Error()
          return {
            state: 'completed' as const,
            output: capabilityContracts[c].output.parse(
              completed.output,
            ) as CapabilityOutput<C>,
          }
        },
        cancel: async () => ({ state: 'unsupported' }),
        recover: async () => ({ state: 'unsupported' }),
      }
    f.service.registry.unregister(original.profile.toolId, '1.0.0')
    f.service.register(adapter)
    const preview = await f.service.preview(f.input),
      task = f.service.confirm(f.p.id, preview.id, 20, true)
    await f.service.wait(task.id)
    const q = f.service.query(f.p.id, task.id)
    assert.equal(q.task.status, 'succeeded', JSON.stringify(q.task.error))
    assert.equal(q.task.providerTaskId, 'fixture-async')
    assert.equal(polls, 1)
    assert.equal(f.server.counts.submit, 1)
  } finally {
    await f.close()
  }
})
test('source revision / registry change invalidates confirmation before any HTTP', async () => {
  const f = await fixture()
  try {
    let preview = await f.service.preview(f.input)
    f.visual.repo.updateEntity(f.p.id, f.target.id, f.target.revision, {
      name: 'Changed',
    })
    assert.throws(
      () => f.service.confirm(f.p.id, preview.id, 20, true),
      /fingerprint-mismatch/,
    )
    preview = await f.service.preview(f.input)
    f.service.registry.unregister(f.adapter.profile.toolId, '1.0.0')
    assert.throws(() => f.service.confirm(f.p.id, preview.id, 20, true))
    assert.equal(f.server.counts.submit, 0)
    assert.equal(f.service.approvals.listApprovals(f.p.id).length, 0)
  } finally {
    await f.close()
  }
})

test('transport proves pre-send network failure: no HTTP or billing and reservation released', async () => {
  const f = await fixture()
  try {
    class BeforeSendFailure extends ImageHttpTransport {
      override async bytes(): Promise<{ bytes: Buffer; mime: string }> {
        // Fault injection at the transport boundary, before any socket/request exists.
        throw {
          sent: false,
          error: (
            await import('../../electron/main/tools/errors.js')
          ).normalizeToolError({ code: 'network' }),
        }
      }
    }
    f.service.registry.unregister(f.adapter.profile.toolId, '1.0.0')
    f.service.register(
      new ImageApiAdapter(
        f.server.profile,
        async () => 'FIXTURE_SECRET',
        new BeforeSendFailure({ fixtureOrigin: f.server.origin }),
      ),
    )
    const preview = await f.service.preview(f.input)
    const task = f.service.confirm(f.p.id, preview.id, 20, true)
    await f.service.wait(task.id)
    const q = f.service.query(f.p.id, task.id)
    assert.equal(q.task.error?.code, 'network')
    assert.equal(q.record.outcome, 'failed')
    assert.equal(q.versions.length, 0)
    assert.equal(f.server.counts.submit, 0)
    assert.equal(f.server.counts.billing, 0)
    assert.equal(
      f.service.approvals.repository.used(f.p.id, q.record.approvalId!),
      0n,
    )
  } finally {
    await f.close()
  }
})

test('actual cost over authorization is preserved for review without a second charge or approval', async () => {
  const f = await fixture()
  try {
    const preview = await f.service.preview(f.input)
    const task = f.service.confirm(f.p.id, preview.id, 2, true)
    await f.service.wait(task.id)
    const q = f.service.query(f.p.id, task.id)
    assert.equal(q.task.status, 'succeeded')
    assert.equal(q.record.actualCost?.amountMicros, 3)
    const reservation = f.service.approvals.repository.list(
      'approval_reservations',
      f.p.id,
    )[0]
    assert.equal(reservation.status, 'requires-review')
    assert.equal(f.service.approvals.listApprovals(f.p.id).length, 1)
    assert.equal(f.server.counts.submit, 1)
    assert.equal(f.server.counts.billing, 1)
    assert.equal(q.versions.length, 1)
  } finally {
    await f.close()
  }
})
