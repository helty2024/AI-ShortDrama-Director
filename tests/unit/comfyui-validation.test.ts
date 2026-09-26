import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { builtinComfyProfile } from '../../electron/main/tools/adapters/comfyui-template.js'
import { ComfyValidationTransport } from '../../electron/main/tools/comfyui-validation-transport.js'
import { ComfyUIToolAdapter } from '../../electron/main/tools/adapters/comfyui.js'
import { comfyServer } from '../fixtures/comfyui-http.js'
import { requestFingerprint } from '../../electron/main/tools/fingerprint.js'

test('trusted built-in profile resolves checkpoint, steps and cfg without template placeholders', () => {
  const profile = builtinComfyProfile({ checkpoint: 'sd_xl_base_1.0.safetensors' })
  assert.doesNotMatch(JSON.stringify(profile.template.workflow), /\{\{/)
  assert.equal(profile.template.version, '1.0.1')
  assert.equal(profile.modelId, 'sd_xl_base_1.0.safetensors')
  assert.throws(() => builtinComfyProfile({ checkpoint: 'x', steps: 0 }))
  assert.throws(() => builtinComfyProfile({ checkpoint: 'x', cfg: NaN }))
  assert.throws(() => builtinComfyProfile({ checkpoint: 'x', templateId: 'untrusted' }))
})

test('validation gate persists before send, blocks second process submit and permits query-only recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'comfy-one-shot-'))
  try {
    const origin = 'http://127.0.0.1:8188', intent = join(dir, 'intent.json')
    const checkpoint = 'sd_xl_base_1.0.safetensors'
    const graph = builtinComfyProfile({ checkpoint }).template.workflow
    const node = graph['2'] as { inputs: Record<string, unknown> }
    node.inputs.text = 'A red apple on a white table'
    const body = JSON.stringify({ prompt: graph })
    let submits = 0
    const promptId = randomUUID()
    const fetcher: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        assert.equal(JSON.parse(await readFile(intent, 'utf8')).state, 'submission-intent')
        submits++
        return Response.json({ prompt_id: promptId, number: 1, node_errors: {} })
      }
      return Response.json({ [promptId]: {
        prompt: ['PRIVATE WORKFLOW MUST NOT BE RECORDED'],
        outputs: { '7': { images: [{ filename: 'PRIVATE.png', subfolder: 'PRIVATE', type: 'output' }] } },
        status: { completed: true, status_str: 'success' },
      } })
    }
    const first = new ComfyValidationTransport(intent, origin, checkpoint, false, fetcher)
    await first.fetch(origin + '/prompt', { method: 'POST', body })
    const second = new ComfyValidationTransport(intent, origin, checkpoint, false, fetcher)
    await assert.rejects(second.fetch(origin + '/prompt', { method: 'POST', body }))
    const recovery = new ComfyValidationTransport(intent, origin, checkpoint, true, fetcher)
    await assert.rejects(recovery.fetch(origin + '/prompt', { method: 'POST', body }))
    await recovery.fetch(origin + '/history/' + promptId)
    assert.equal(submits, 1)
    assert.equal(recovery.observed.submitCount, 0)
    assert.deepEqual(recovery.observed.historyEnvelopeFields, ['outputs', 'prompt', 'status'])
    assert.doesNotMatch(JSON.stringify(recovery.observed), /PRIVATE|safetensors|filename.*PRIVATE/)
    assert.deepEqual(recovery.observed.outputImageFields, ['filename', 'subfolder', 'type'])
    await assert.rejects(first.fetch(origin + '/upload/image', { method: 'POST', body }))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('sampler placeholders fail preflight before real submit', async () => {
  const f = await comfyServer()
  try {
    const node = f.profile.template.workflow['5'] as { inputs: Record<string, unknown> }
    node.inputs.steps = '{{steps}}'
    const adapter = new ComfyUIToolAdapter(f.profile)
    const input = { prompt: 'apple', negativePrompt: '', resolution: { width: 32, height: 32 }, aspectRatio: '1:1' as const, seed: 1, count: 1, outputMime: 'image/png' as const }
    const ctx = {
      projectId: randomUUID(), model: f.profile.modelId, routingDecisionId: null,
      requestFingerprint: requestFingerprint({
        fingerprintVersion: '1', snapshot: { capability: 'image.generate', contractVersion: '1.0.0', input },
        toolId: f.profile.toolId, toolVersion: '1.0.0', model: f.profile.modelId, sourceRevisions: {}, routing: null,
      }),
    }
    const validation = await adapter.validate('image.generate', input, ctx, new AbortController().signal)
    assert.equal(validation.valid, false)
    assert.ok(validation.issues.some((issue) => issue.field === 'workflow'))
    assert.equal(f.counts.submit, 0)
  } finally { await f.close() }
})

for (const mode of ['queued', 'running'] as const)
  test(`real queue envelope maps ${mode} by exact prompt id, not property-name substring`, async () => {
    const f = await comfyServer(mode)
    try {
      const adapter = new ComfyUIToolAdapter(f.profile)
      const handle = { toolId: f.profile.toolId, toolVersion: '1.0.0', externalTaskId: f.promptId }
      assert.equal((await adapter.status(handle, new AbortController().signal)).state, mode)
      const absent = await adapter.status({ ...handle, externalTaskId: f.promptId.slice(0, -1) }, new AbortController().signal)
      assert.equal(absent.state, 'unknown')
    } finally { await f.close() }
  })
