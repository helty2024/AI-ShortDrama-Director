import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as wait } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { ProjectDatabase, metadata } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { parseScript } from '../../electron/main/intelligence/parser.js'
import { IntelligenceRepository } from '../../electron/main/intelligence/repository.js'
import { confirmDraft } from '../../electron/main/intelligence/review.js'
import { AITaskQueue } from '../../electron/main/intelligence/queue.js'
import { MockTextProvider } from '../../electron/main/intelligence/mock-provider.js'
import {
  AIError,
  CompatibleTextProvider,
} from '../../electron/main/intelligence/provider.js'
import type { TextGenerationProvider } from '../../electron/main/intelligence/provider.js'
import {
  breakdownOutputSchema,
  shotOutputSchema,
  intelligenceDraftSchema,
  emptyScene,
  aiTaskSchema,
} from '../../src/shared/intelligence.js'
import type { AITask, BreakdownItem } from '../../src/shared/intelligence.js'

const raw =
  '# 第1集 雨夜\n第1场 外景 车站 夜\n人物：林夏、陈默\n动作：林夏拿着旧信，黑伞滴着雨水。\n林夏（低声）：你终于来了。\n旁白：雷声渐近。\n第2场 内景 书店 日\n陈默：请进。\n无法识别的说明原样保留。'
function setup(provider: TextGenerationProvider = new MockTextProvider()) {
  const db = new ProjectDatabase(':memory:')
  const project = db.seed(buildSeed)
  const repo = new IntelligenceRepository(db)
  const queue = new AITaskQueue(repo, provider)
  const entities = db.workspace(project.id).entities
  const scene = entities.find((e) => e.kind === 'scene')!
  const episode = entities.find((e) => e.kind === 'episode')!
  return {
    db,
    project,
    repo,
    queue,
    scene,
    episode,
    close: () => {
      queue.close()
      db.close()
    },
  }
}
async function settled(repo: IntelligenceRepository, task: AITask) {
  for (let n = 0; n < 300; n++) {
    const current = repo.task(task.projectId, task.id)
    if (!['queued', 'running'].includes(current.status)) return current
    await wait(10)
  }
  throw new Error('Task did not settle')
}
const item: BreakdownItem = {
  category: 'character',
  name: '新角色',
  description: '目击者',
  confidence: 0.8,
  reason: '对白角色名',
  attributes: [{ field: 'voiceDescription', value: '低声' }],
}
test('parser identifies episodes, locations, time, dialogue and retains unrecognized text', () => {
  const result = parseScript(raw)
  assert.equal(result.episodes.length, 1)
  const scenes = result.episodes[0]!.scenes
  assert.equal(scenes.length, 2)
  assert.equal(scenes[0]!.location, '车站')
  assert.equal(scenes[0]!.interiorExterior, 'EXT')
  assert.equal(scenes[0]!.timeOfDay, '夜')
  assert.equal(scenes[0]!.dialogue[0]!.parenthetical, '低声')
  assert.equal(scenes[0]!.dialogue[0]!.characterName, '林夏')
  assert.match(scenes[1]!.action, /无法识别的说明原样保留/)
  assert.match(
    parseScript('只有未标记的原文').episodes[0]!.scenes[0]!.action,
    /只有未标记的原文/,
  )
  assert.throws(() => parseScript('  '))
})
test('import queue creates preview only; confirmation atomically creates structured records once', async () => {
  const app = setup()
  try {
    const before = app.db.workspace(app.project.id).entities.length
    const task = await settled(
      app.repo,
      app.queue.start(app.project.id, {
        type: 'parse',
        name: '导入',
        rawText: '  ' + raw + '\n',
      }),
    )
    assert.equal(task.status, 'succeeded')
    assert.equal(app.db.workspace(app.project.id).entities.length, before)
    const preview = app.repo.snapshot(app.project.id, 'mock').imports[0]!
    assert.equal(preview.rawText, '  ' + raw + '\n')
    const script = app.repo.confirmImport(
      app.project.id,
      preview.id,
      preview.revision,
      preview.parsed,
    )
    assert.equal(
      app.repo.confirmImport(
        app.project.id,
        preview.id,
        preview.revision,
        preview.parsed,
      ).id,
      script.id,
    )
    assert.equal(app.db.workspace(app.project.id).entities.length, before + 4)
  } finally {
    app.close()
  }
})
test('import foreign character reference is rejected and transaction leaves preview/raw intact', async () => {
  const app = setup()
  try {
    await settled(
      app.repo,
      app.queue.start(app.project.id, {
        type: 'parse',
        name: '测试',
        rawText: raw,
      }),
    )
    const preview = app.repo.snapshot(app.project.id, 'mock').imports[0]!
    const parsed = structuredClone(preview.parsed)
    parsed.episodes[0]!.scenes[0]!.dialogue[0]!.characterId = randomUUID()
    const count = app.db.workspace(app.project.id).entities.length
    assert.throws(
      () => app.repo.confirmImport(app.project.id, preview.id, 1, parsed),
      /关联对象/,
    )
    assert.equal(app.db.workspace(app.project.id).entities.length, count)
    assert.equal(
      app.repo.snapshot(app.project.id, 'mock').imports[0]!.confirmedScriptId,
      null,
    )
    assert.equal(
      app.repo.snapshot(app.project.id, 'mock').imports[0]!.rawText,
      raw,
    )
  } finally {
    app.close()
  }
})
test('breakdown and shot schemas reject bad confidence, invalid references and missing fields', () => {
  assert.equal(
    breakdownOutputSchema.safeParse({
      elements: [{ ...item, confidence: 1.1 }],
    }).success,
    false,
  )
  assert.equal(
    breakdownOutputSchema.safeParse({
      elements: [{ ...item, category: 'arbitrary' }],
    }).success,
    false,
  )
  assert.equal(
    shotOutputSchema.safeParse({ shots: [{ shotNumber: 1 }] }).success,
    false,
  )
})
test('breakdown batch creates only drafts; review creates and merges a multi-scene Character', async () => {
  const app = setup(
    new MockTextProvider({}, async () => ({ elements: [item] })),
  )
  try {
    const original = app.db.workspace(app.project.id).entities.length
    const task = await settled(
      app.repo,
      app.queue.start(app.project.id, {
        type: 'breakdown',
        targetId: app.episode.id,
      }),
    )
    assert.equal(task.status, 'succeeded')
    const drafts = app.repo.snapshot(app.project.id, 'mock').drafts
    assert.equal(drafts.length, 2)
    assert.equal(app.db.workspace(app.project.id).entities.length, original)
    const first = confirmDraft(
      app.repo,
      app.project.id,
      drafts[0]!.id,
      1,
      null,
      null,
    )
    const target = app.repo.entity(app.project.id, first.targetId!)
    assert.equal(target.kind, 'character')
    assert.equal(
      confirmDraft(app.repo, app.project.id, drafts[0]!.id, 1, null, null)
        .targetId,
      target.id,
    )
    confirmDraft(
      app.repo,
      app.project.id,
      drafts[1]!.id,
      1,
      target.id,
      target.revision,
    )
    assert.equal(app.db.workspace(app.project.id).entities.length, original + 1)
    const updated = app.repo.entity(app.project.id, target.id)
    if (updated.kind === 'character') {
      assert.equal(updated.bible.voiceDescription, '低声')
      assert.match(updated.bible.continuityNotes, /车站/)
      assert.match(updated.bible.continuityNotes, /书店/)
    }
  } finally {
    app.close()
  }
})
test('review supports edit/ignore, protects source revision and rejects cross-project merge', async () => {
  const app = setup(
    new MockTextProvider({}, async () => ({
      elements: [item, { ...item, name: '另一个角色' }],
    })),
  )
  try {
    await settled(
      app.repo,
      app.queue.start(app.project.id, {
        type: 'breakdown',
        targetId: app.scene.id,
      }),
    )
    const [first, second] = app.repo.snapshot(app.project.id, 'mock').drafts
    const edited = app.repo.editDraft(app.project.id, first!.id, 1, {
      type: 'breakdown',
      item: { ...item, name: '修改后的名字' },
    })
    assert.equal(edited.revision, 2)
    assert.throws(
      () => app.repo.editDraft(app.project.id, first!.id, 1, null),
      /数据已更新/,
    )
    app.repo.editDraft(app.project.id, second!.id, 1, null)
    assert.throws(
      () => confirmDraft(app.repo, app.project.id, second!.id, 2, null, null),
      /已忽略/,
    )
    const other = app.db.create({
      name: '其他',
      description: '',
      genre: '剧情',
      aspectRatio: '9:16',
      language: 'zh-CN',
    })
    const character = app.db.createDraft({
      projectId: other.id,
      kind: 'character',
      name: '其他人',
    })
    assert.throws(
      () =>
        confirmDraft(app.repo, app.project.id, first!.id, 2, character.id, 1),
      /不属于/,
    )
    app.repo.saveScene(app.project.id, app.scene.id, app.scene.revision, {
      ...emptyScene,
      action: '修改原文',
    })
    assert.throws(
      () => confirmDraft(app.repo, app.project.id, first!.id, 2, null, null),
      /来源场次已改变/,
    )
  } finally {
    app.close()
  }
})
test('other production categories can be confirmed and merged without fake Character rows', async () => {
  const app = setup(
    new MockTextProvider({}, async () => ({
      elements: [{ ...item, category: 'costume', name: '制服' }],
    })),
  )
  try {
    await settled(
      app.repo,
      app.queue.start(app.project.id, {
        type: 'breakdown',
        targetId: app.episode.id,
      }),
    )
    const [first, second] = app.repo.snapshot(app.project.id, 'mock').drafts
    const confirmed = confirmDraft(
      app.repo,
      app.project.id,
      first!.id,
      1,
      null,
      null,
    )
    confirmDraft(app.repo, app.project.id, second!.id, 1, confirmed.targetId, 1)
    const element = app.repo.snapshot(app.project.id, 'mock').production[0]!
    assert.equal(element.sceneIds.length, 2)
    assert.equal(element.category, 'costume')
    assert.equal(
      app.db
        .workspace(app.project.id)
        .entities.filter((e) => e.kind === 'character').length,
      3,
    )
  } finally {
    app.close()
  }
})
test('Shot Planner creates drafts and only confirm writes a Shot with a full plan', async () => {
  const app = setup()
  try {
    const before = app.db
      .workspace(app.project.id)
      .entities.filter((e) => e.kind === 'shot').length
    const task = await settled(
      app.repo,
      app.queue.start(app.project.id, {
        type: 'shotPlanning',
        targetId: app.scene.id,
      }),
    )
    assert.equal(task.status, 'succeeded')
    assert.equal(
      app.db.workspace(app.project.id).entities.filter((e) => e.kind === 'shot')
        .length,
      before,
    )
    const draft = app.repo.snapshot(app.project.id, 'mock').drafts[0]!
    const confirmed = confirmDraft(
      app.repo,
      app.project.id,
      draft.id,
      draft.revision,
      null,
      null,
    )
    const shot = app.repo.entity(app.project.id, confirmed.targetId!)
    if (shot.kind !== 'shot') throw new Error('Expected shot')
    assert.equal(shot.plan?.cameraAngle, '平视')
    assert.ok(shot.characterIds.length)
    assert.equal(
      app.db.workspace(app.project.id).entities.filter((e) => e.kind === 'shot')
        .length,
      before + 1,
    )
  } finally {
    app.close()
  }
})
test('malformed AI output fails without draft or formal writes, and failed task can retry', async () => {
  let invalid = true
  const app = setup(
    new MockTextProvider({}, async () =>
      invalid ? { bad: true } : { elements: [item] },
    ),
  )
  try {
    const task = await settled(
      app.repo,
      app.queue.start(app.project.id, {
        type: 'breakdown',
        targetId: app.scene.id,
      }),
    )
    assert.equal(task.status, 'failed')
    assert.equal(task.error?.code, 'INVALID_OUTPUT')
    assert.equal(app.repo.snapshot(app.project.id, 'mock').drafts.length, 0)
    invalid = false
    const retried = await settled(
      app.repo,
      app.queue.retry(app.project.id, task.id),
    )
    assert.equal(retried.status, 'succeeded')
    assert.equal(retried.attempt, 2)
  } finally {
    app.close()
  }
})
test('running and queued cancellation prevent late provider writes', async () => {
  const app = setup(
    new MockTextProvider({}, async () => {
      await wait(90)
      return { elements: [item] }
    }),
  )
  try {
    const running = app.queue.start(app.project.id, {
      type: 'breakdown',
      targetId: app.scene.id,
    })
    const queued = app.queue.start(app.project.id, {
      type: 'characterBible',
      targetId: app.scene.id,
    })
    app.queue.cancel(app.project.id, queued.id)
    await wait(40)
    app.queue.cancel(app.project.id, running.id)
    await wait(130)
    assert.equal(app.repo.task(app.project.id, running.id).status, 'cancelled')
    assert.equal(app.repo.task(app.project.id, queued.id).status, 'cancelled')
    assert.equal(app.repo.snapshot(app.project.id, 'mock').drafts.length, 0)
  } finally {
    app.close()
  }
})
test('source edits during AI execution discard all batch results', async () => {
  const app = setup(
    new MockTextProvider({}, async () => {
      await wait(70)
      return { elements: [item] }
    }),
  )
  try {
    const task = app.queue.start(app.project.id, {
      type: 'breakdown',
      targetId: app.scene.id,
    })
    await wait(40)
    app.repo.saveScene(app.project.id, app.scene.id, app.scene.revision, {
      ...emptyScene,
      action: '更新后的动作',
    })
    const result = await settled(app.repo, task)
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'STALE_SOURCE')
    assert.equal(app.repo.snapshot(app.project.id, 'mock').drafts.length, 0)
  } finally {
    app.close()
  }
})
test('text provider validates, times out, aborts and retries transient failures', async () => {
  const schema = z.strictObject({ value: z.string() })
  const request = {
    system: 'test',
    input: {},
    schema,
    schemaName: 'test',
    signal: new AbortController().signal,
  }
  await assert.rejects(
    new MockTextProvider({ timeoutMs: 5, retries: 0 }, async () => {
      await wait(40)
      return { value: 'late' }
    }).generateStructured(request),
    (e: unknown) => e instanceof AIError && e.code === 'TIMEOUT',
  )
  let attempts = 0
  const provider = new MockTextProvider(
    { retries: 1, retryDelayMs: 1 },
    async () => {
      if (++attempts === 1) throw new AIError('NETWORK', 'temporary')
      return { value: 'ok' }
    },
  )
  assert.deepEqual(await provider.generateStructured(request), { value: 'ok' })
  assert.equal(attempts, 2)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    provider.generateStructured({ ...request, signal: controller.signal }),
    (e: unknown) => e instanceof AIError && e.code === 'CANCELLED',
  )
})
test('compatible adapter supplies JSON schema and normalizes errors without leaking keys', async () => {
  let body: Record<string, unknown> = {}
  const fetcher: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"value":"ok"}' } }] }),
    )
  }
  const provider = new CompatibleTextProvider(
    {
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-test',
      apiKey: 'secret-test',
    },
    { retries: 0 },
    fetcher,
  )
  const request = {
    system: 'test',
    input: {},
    schema: z.strictObject({ value: z.string() }),
    schemaName: 'test',
    signal: new AbortController().signal,
  }
  assert.equal((await provider.generateStructured(request)).value, 'ok')
  assert.ok(body.response_format)
  const bad = new CompatibleTextProvider(
    {
      baseUrl: 'https://example.test/v1',
      model: 'test',
      apiKey: 'secret-test',
    },
    { retries: 0 },
    async () => new Response('secret-test', { status: 401 }),
  )
  await assert.rejects(
    bad.generateStructured(request),
    (e: unknown) =>
      e instanceof AIError &&
      e.code === 'AUTH' &&
      !e.message.includes('secret-test'),
  )
})
test('scene revision, reorder transaction and subtree deletion preserve unrelated Bible entities', () => {
  const app = setup()
  try {
    const scenes = app.repo.selectedScenes(app.project.id, app.episode.id)
    const updated = app.repo.saveScene(app.project.id, app.scene.id, 1, {
      ...emptyScene,
      action: '新的动作',
      dialogue: [
        {
          characterId: null,
          characterName: '临时人',
          parenthetical: '轻声',
          text: '你好',
        },
      ],
    })
    assert.equal(updated.revision, 2)
    assert.throws(
      () => app.repo.saveScene(app.project.id, app.scene.id, 1, emptyScene),
      /数据已更新/,
    )
    assert.throws(
      () =>
        app.repo.reorder(app.project.id, app.episode.id, 1, [
          scenes[0]!.id,
          scenes[0]!.id,
        ]),
      /不能重复/,
    )
    const reordered = app.repo.reorder(
      app.project.id,
      app.episode.id,
      1,
      scenes.map((s) => s.id).reverse(),
    )
    assert.equal(reordered.revision, 2)
    assert.equal(
      app.repo.selectedScenes(app.project.id, app.episode.id)[0]!.id,
      scenes[1]!.id,
    )
    app.repo.deleteTree(app.project.id, app.episode.id, reordered.revision)
    const entities = app.db.workspace(app.project.id).entities
    assert.equal(
      entities.filter((e) => e.kind === 'scene' || e.kind === 'shot').length,
      0,
    )
    assert.equal(entities.filter((e) => e.kind === 'character').length, 3)
  } finally {
    app.close()
  }
})
test('Phase 1 migration preserves UUIDs, timestamps, revisions, raw scripts and seed relationships', () => {
  const directory = mkdtempSync(join(tmpdir(), 'director-migrate-'))
  const path = join(directory, 'old.sqlite')
  try {
    const rawDb = new DatabaseSync(path)
    rawDb.exec(
      readFileSync(new URL('../fixtures/phase1.sql', import.meta.url), 'utf8'),
    )
    const project = {
      ...metadata(),
      name: '旧项目',
      description: '',
      genre: '悬疑',
      aspectRatio: '9:16',
      language: 'zh-CN',
      lastOpenedAt: null,
    }
    rawDb
      .prepare('INSERT INTO projects VALUES (?, ?)')
      .run(project.id, JSON.stringify(project))
    const records = buildSeed(project.id)
    for (const entity of records) {
      const old: Record<string, unknown> = { ...entity }
      if (entity.kind === 'scene') delete old.content
      delete old.bible
      delete old.plan
      rawDb
        .prepare('INSERT INTO entities VALUES (?, ?, ?, ?)')
        .run(entity.id, project.id, entity.kind, JSON.stringify(old))
    }
    rawDb.close()
    const upgraded = new ProjectDatabase(path)
    assert.equal(
      upgraded.connection.prepare('PRAGMA user_version').get()?.user_version,
      6,
    )
    const data = upgraded.workspace(project.id).entities
    assert.deepEqual(
      data.map((e) => e.id),
      records.map((e) => e.id),
    )
    assert.equal(data[0]!.createdAt, records[0]!.createdAt)
    assert.equal(data[0]!.revision, records[0]!.revision)
    const scene = data.find((e) => e.kind === 'scene')!
    assert.equal(scene.kind === 'scene' && scene.content.heading, scene.name)
    assert.equal(data.find((e) => e.kind === 'script')?.kind, 'script')
    upgraded.close()
    const reopened = new ProjectDatabase(path)
    assert.equal(reopened.workspace(project.id).entities.length, records.length)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('queue recovery marks interrupted tasks as failed for explicit retry', () => {
  const db = new ProjectDatabase(':memory:'),
    project = db.seed(buildSeed),
    repo = new IntelligenceRepository(db)
  const task = aiTaskSchema.parse({
    ...metadata(),
    projectId: project.id,
    input: { type: 'parse', name: '导入', rawText: raw },
    status: 'running',
    attempt: 1,
    error: null,
    resultIds: [],
    sourceRevisions: {},
  })
  repo.putTask(task)
  const queue = new AITaskQueue(repo, new MockTextProvider())
  assert.equal(repo.task(project.id, task.id).error?.code, 'INTERRUPTED')
  queue.close()
  db.close()
})
test('draft schema rejects fabricated source metadata', () => {
  assert.equal(
    intelligenceDraftSchema.safeParse({
      ...metadata(),
      projectId: randomUUID(),
      sceneId: 'invalid',
    }).success,
    false,
  )
})

test('closing immediately after deleting a project with an active task is safe', async () => {
  const app = setup(
    new MockTextProvider({}, async () => {
      await wait(100)
      return { elements: [item] }
    }),
  )
  const task = app.queue.start(app.project.id, {
    type: 'breakdown',
    targetId: app.scene.id,
  })
  for (
    let n = 0;
    n < 100 && app.repo.task(app.project.id, task.id).status === 'queued';
    n++
  )
    await wait(5)
  assert.equal(app.repo.task(app.project.id, task.id).status, 'running')
  app.queue.cancelProject(app.project.id)
  app.db.delete(app.project.id)
  assert.doesNotThrow(() => app.close())
  await wait(150)
})
