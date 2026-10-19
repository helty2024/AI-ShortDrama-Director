import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { CompatibleTextProvider } from '../../electron/main/intelligence/provider.js'
import { applyTextServicePreset } from '../../src/features/visual/text-service-presets.js'

const output = z.strictObject({ ok: z.literal(true) })
const request = () => ({ system: '分析输入数据。', input: { story: '车站的一封旧信。' }, schema: output, schemaName: 'protocol', signal: AbortSignal.timeout(2000) })
const envelope = (content: string, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }))

test('Explicit JSON mode sends its schema in context, preserves token cap and validates the returned object', async () => {
  let calls = 0
  const fetcher: typeof fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body)) as { response_format: unknown; max_tokens: number; max_completion_tokens?: number; messages: { content: string }[] }
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(body.max_tokens, 4000)
    assert.equal(body.max_completion_tokens, undefined)
    assert.match(body.messages[0]!.content, /JSON Schema/)
    assert.match(body.messages[0]!.content, /"const":true/)
    assert.equal(init?.redirect, 'error')
    return envelope('{"ok":true}')
  }
  const provider = new CompatibleTextProvider({ baseUrl: 'https://fixture.example/v1', model: 'fixture-model', outputMode: 'json-object', maxTokens: 4000 }, { retries: 0 }, fetcher)
  assert.deepEqual(await provider.generateStructured(request()), { ok: true })
  assert.equal(calls, 1)
})

test('Old configurations remain strict; rejection never silently switches protocol or repeats the request', async () => {
  let calls = 0
  const fetcher: typeof fetch = async (_url, init) => {
    calls++
    assert.equal(JSON.parse(String(init?.body)).response_format.type, 'json_schema')
    return new Response('{}', { status: 400 })
  }
  const provider = new CompatibleTextProvider({ baseUrl: 'https://fixture.example/v1', model: 'fixture-model' }, { retries: 0 }, fetcher)
  await assert.rejects(provider.generateStructured(request()), /文本服务请求失败/)
  assert.equal(calls, 1)
})

test('Valid JSON with wrong fields is rejected without repair or automatic paid retry', async () => {
  let calls = 0
  const provider = new CompatibleTextProvider({ baseUrl: 'https://fixture.example/v1', model: 'fixture-model', outputMode: 'json-object' }, { retries: 0 }, async () => { calls++; return envelope('{"ok":true,"invented":1}') })
  await assert.rejects(provider.generateStructured(request()), /结构校验/)
  assert.equal(calls, 1)
})

test('Truncated or filtered completions never become accepted results, even when the content parses', async () => {
  for (const reason of ['length', 'content_filter', 'tool_calls']) {
    let calls = 0
    const provider = new CompatibleTextProvider({ baseUrl: 'https://fixture.example/v1', model: 'fixture-model', outputMode: 'json-object' }, { retries: 0 }, async () => { calls++; return envelope('{"ok":true}', reason) })
    await assert.rejects(provider.generateStructured(request()), /未写入结果/)
    assert.equal(calls, 1)
  }
})

test('A service template clears the previous model without guessing account access, and cannot change native adapters', () => {
  const initial = { id: null, kind: 'text' as const, name: '旧服务', baseUrl: 'https://fixture.example/v1', model: 'old-model' }
  const result = applyTextServicePreset(initial, 'deepseek')
  assert.equal(result.baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(result.model, '')
  assert.equal(result.textOutputMode, 'json-object')
  assert.equal(initial.model, 'old-model')
  assert.equal(applyTextServicePreset(initial, 'custom'), initial)
  const native = { ...initial, kind: 'compshare-video' as const }
  assert.equal(applyTextServicePreset(native, 'deepseek'), native)
})
