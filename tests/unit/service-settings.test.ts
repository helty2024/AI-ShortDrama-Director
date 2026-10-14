import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultProviderSettings } from '../../src/shared/visual.js'
import { requestSchema } from '../../src/shared/api.js'
import { loadComfySettings, saveComfySettings } from '../../electron/main/generation/comfy-settings.js'
import { comfyStatus, h3Status } from '../../src/features/visual/service-status.js'

test('Comfy display requires current model/template readiness, rather than saved configuration', () => {
  for (const state of [undefined, 'offline', 'configured-unverified', 'configuration-required']) assert.equal(comfyStatus(state).label, '未连接本地服务')
  assert.equal(comfyStatus('capability-blocked').label, '需要配置')
  assert.equal(comfyStatus('ready-for-configured-template').label, '可用')
})
test('H3 saved credential and read-only auth are distinct and never imply real generation', () => {
  assert.equal(h3Status(false, undefined), '尚未配置密钥')
  assert.equal(h3Status(true, undefined), '密钥已保存')
  assert.equal(h3Status(true, false), '连接检测未通过')
  assert.equal(h3Status(true, true), '连接检测通过')
})
test('Global Comfy configuration persists independently of projects and rejects remote or untrusted templates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'director-service-settings-'))
  const path = join(root, 'comfyui-service-settings.json')
  try {
    assert.equal((await loadComfySettings(path)).provider, 'comfyui')
    const settings = { ...defaultProviderSettings, provider: 'comfyui' as const, checkpoint: 'fixture.safetensors', steps: 24 }
    await saveComfySettings(path, settings)
    assert.deepEqual(await loadComfySettings(path), settings)
    const before = await readFile(path, 'utf8')
    await assert.rejects(saveComfySettings(path, { ...settings, baseUrl: 'https://remote.example' }))
    await assert.rejects(saveComfySettings(path, { ...settings, templateId: 'custom-untrusted' }))
    assert.equal(await readFile(path, 'utf8'), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('Service configuration IPC rejects path, header and executable injection', () => {
  assert.equal(requestSchema.safeParse({ action:'serviceSettings',command:{op:'comfy.configuration',path:'arbitrary'} }).success,false)
  assert.equal(requestSchema.safeParse({ action:'serviceSettings',command:{op:'comfy.save',settings:{...defaultProviderSettings,headers:{},shell:'command'}} }).success,false)
})
