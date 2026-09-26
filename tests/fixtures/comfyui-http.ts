import { createServer } from 'node:http'
import { once } from 'node:events'
import sharp from 'sharp'
import type { AddressInfo } from 'node:net'
import type { ComfyToolProfile } from '../../src/shared/comfyui.js'

export type ComfyFixtureMode =
  | 'ok' | 'missing-model' | 'missing-node' | 'failed' | 'running'
  | 'queued' | 'history-missing' | 'malformed' | 'cancel-unsupported'

export async function comfyServer(mode: ComfyFixtureMode = 'ok', reference = false) {
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#7048e8' } }).png().toBuffer()
  const counts = { health: 0, objectInfo: 0, submit: 0, queue: 0, history: 0, view: 0, upload: 0, cancel: 0 }
  let submitted = false
  const promptId = 'fixture-prompt-1'
  const read = async (request: import('node:http').IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture')
    if (url.pathname === '/system_stats') {
      counts.health++; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ system: {} })); return
    }
    if (url.pathname === '/object_info') {
      counts.objectInfo++
      if (mode === 'malformed') { response.end('{'); return }
      const node = (required: Record<string, unknown> = {}, output_node = false) => ({ input: { required }, output_node })
      const info: Record<string, unknown> = {
        CheckpointLoaderSimple: node({ ckpt_name: [[mode === 'missing-model' ? 'other.safetensors' : 'fixture.safetensors']] }),
        CLIPTextEncode: node({ text: ['STRING'], clip: ['CLIP'] }),
        EmptyLatentImage: node({ width: ['INT'], height: ['INT'], batch_size: ['INT'] }),
        KSampler: node({ seed: ['INT'], model: ['MODEL'], positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'] }),
        VAEDecode: node({ samples: ['LATENT'], vae: ['VAE'] }),
        SaveImage: node({ images: ['IMAGE'], filename_prefix: ['STRING'] }, true),
        LoadImage: node({ image: ['IMAGEUPLOAD'] }),
      }
      if (mode === 'missing-node') delete info.KSampler
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(info)); return
    }
    if (url.pathname === '/prompt' && request.method === 'POST') {
      counts.submit++; submitted = true; await read(request)
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ prompt_id: promptId })); return
    }
    if (url.pathname === '/upload/image' && request.method === 'POST') {
      counts.upload++; await read(request); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ name: 'director-reference.png', subfolder: 'director-input' })); return
    }
    if (url.pathname === '/queue' && request.method === 'POST') {
      counts.cancel++; await read(request)
      if (mode === 'cancel-unsupported') { response.statusCode = 404; response.end(); return }
      response.setHeader('Content-Type', 'application/json'); response.end('{}'); return
    }
    if (url.pathname === '/queue') {
      counts.queue++
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        queue_running: mode === 'running' ? [[0, promptId, {}, {}, []]] : [],
        queue_pending: mode === 'queued' ? [[0, promptId, {}, {}, []]] : [],
      })); return
    }
    if (url.pathname.startsWith('/history/')) {
      counts.history++; response.setHeader('Content-Type', 'application/json')
      if (url.pathname !== `/history/${promptId}`) { response.end('{}'); return }
      if (!submitted || mode === 'history-missing' || mode === 'running' || mode === 'queued') { response.end('{}'); return }
      if (mode === 'failed') { response.end(JSON.stringify({ [promptId]: { status: { status_str: 'error', completed: true }, outputs: {} } })); return }
      response.end(JSON.stringify({ [promptId]: { status: { status_str: 'success', completed: true }, outputs: { '7': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } } } })); return
    }
    if (url.pathname === '/view') {
      counts.view++; response.setHeader('Content-Type', 'image/png'); response.end(bytes); return
    }
    response.statusCode = 404; response.end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const workflow: Record<string, unknown> = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'fixture.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 32, height: 32, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { seed: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'Director' } },
    ...(reference ? { '8': { class_type: 'LoadImage', inputs: { image: '', weight: 1 } } } : {}),
  }
  const profile: ComfyToolProfile = {
    toolId: reference ? 'comfyui.reference' : 'comfyui.local',
    displayName: 'ComfyUI Fixture', baseUrl: origin, modelId: 'fixture.safetensors', currency: 'USD',
    template: {
      templateId: reference ? 'fixture-reference' : 'fixture-image', version: '1.0.0',
      capability: reference ? 'image.referenceGenerate' : 'image.generate', workflow,
      requiredNodes: ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage', ...(reference ? ['LoadImage'] : [])],
      requiredModels: ['fixture.safetensors'],
      inputBindings: {
        prompt: { nodeId: '2', input: 'text' }, negativePrompt: { nodeId: '3', input: 'text' },
        width: { nodeId: '4', input: 'width' }, height: { nodeId: '4', input: 'height' }, seed: { nodeId: '5', input: 'seed' },
        ...(reference ? { referenceImage: { nodeId: '8', input: 'image' }, referenceWeight: { nodeId: '8', input: 'weight' } } : {}),
      },
      outputNode: '7', supportedResolutions: [{ width: 32, height: 32 }], supportedAspectRatios: ['1:1'], maxReferences: reference ? 1 : 0,
    },
  }
  return { origin, profile, counts, bytes, promptId, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}
