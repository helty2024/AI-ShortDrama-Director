import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ComfyUIRuntime, validateLocalComfyUrl } from '../../electron/main/tools/adapters/comfyui-runtime.js'
import { comfyServer } from '../fixtures/comfyui-http.js'

test('Comfy runtime permits loopback only and never follows arbitrary endpoints', () => {
  assert.equal(validateLocalComfyUrl('http://127.0.0.1:8188'), 'http://127.0.0.1:8188')
  for (const url of ['https://example.com', 'http://192.168.1.2:8188', 'http://user:x@localhost:8188', 'file:///tmp/x'])
    assert.throws(() => validateLocalComfyUrl(url))
})

test('runtime bridges health, object_info, queue, history, view, upload and cancel', async () => {
  const f = await comfyServer()
  try {
    const runtime = new ComfyUIRuntime(f.origin), signal = new AbortController().signal
    await runtime.systemStats(signal)
    assert.ok((await runtime.objectInfo(signal)).KSampler)
    assert.equal(await runtime.submit({}, signal), f.promptId)
    const entry = await runtime.history(f.promptId, signal)
    assert.ok(entry)
    const output = runtime.outputs(entry!)[0]!
    assert.equal((await runtime.view(output, signal)).bytes.equals(f.bytes), true)
    assert.equal(await runtime.upload(f.bytes, 'image/png', signal), 'director-input/director-reference.png')
    await runtime.cancel(f.promptId, signal)
    assert.deepEqual(f.counts, { health: 1, objectInfo: 1, submit: 1, queue: 0, history: 1, view: 1, upload: 1, cancel: 1 })
  } finally { await f.close() }
})

test('runtime reports malformed responses and history missing without scanning files', async () => {
  const malformed = await comfyServer('malformed')
  try { await assert.rejects(new ComfyUIRuntime(malformed.origin).objectInfo(new AbortController().signal)) }
  finally { await malformed.close() }
  const missing = await comfyServer('history-missing')
  try {
    const runtime = new ComfyUIRuntime(missing.origin), signal = new AbortController().signal
    assert.equal(await runtime.history(missing.promptId, signal), null)
    assert.equal(missing.counts.view, 0)
  } finally { await missing.close() }
})
