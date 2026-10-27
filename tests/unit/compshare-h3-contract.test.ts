import test from 'node:test'
import assert from 'node:assert/strict'
import { h3RequestBodySchema } from '../../electron/main/tools/adapters/compshare-h3-contract.js'
const text = { type: 'text', text: 'A continuous shot' }
const image = (role: string) => ({ type: 'image_url', role, image_url: { url: 'data:image/png;base64,AQ==' } })
const body = { model: 'MiniMax-H3', resolution: '480P', duration: 5, ratio: '9:16', mute_audio: true, use_context_ir: false }
test('H3 native first/last-frame and multi-reference modes are mutually exclusive; legal shapes pass locally only', () => {
  for (const content of [[text], [text, image('first_frame')], [text, image('first_frame'), image('last_frame')], [text, image('reference_image')]])
    assert(h3RequestBodySchema.safeParse({ ...body, content }).success)
  for (const content of [[image('first_frame'), image('reference_image')], [image('last_frame'), { type: 'video_url', video_url: { url: 'https://example.com/a.mp4' }, role: 'reference_video' }], [image('first_frame'), image('first_frame')], [{ type: 'audio_url', audio_url: { url: 'https://example.com/a.mp3' }, role: 'reference_audio' }]])
    assert.equal(h3RequestBodySchema.safeParse({ ...body, content }).success, false)
  assert.equal(h3RequestBodySchema.safeParse({ ...body, duration: 4.5, content: [text] }).success, false)
})
