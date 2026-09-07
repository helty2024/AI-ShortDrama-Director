import { metadata } from './database.js'
import type { Entity } from '../../src/shared/domain.js'

export function buildSeed(projectId: string): Entity[] {
  const base = (name: string) => ({
    ...metadata(),
    projectId,
    name,
    description: '',
  })
  const assets = ['雨夜车站概念图', '旧书店概念图'].map((name) => ({
    ...base(name),
    kind: 'asset' as const,
    mediaType: 'image' as const,
    uri: null,
    status: 'placeholder' as const,
    source: null,
    previousVersionId: null,
  }))
  const locations = ['雨夜车站', '旧书店'].map((name, i) => ({
    ...base(name),
    kind: 'location' as const,
    assetIds: [assets[i]!.id],
  }))
  const characters = ['林夏', '陈默', '周伯'].map((name) => ({
    ...base(name),
    kind: 'character' as const,
    appearance: '',
    assetIds: [],
  }))
  const props = ['旧信', '黑伞'].map((name) => ({
    ...base(name),
    kind: 'prop' as const,
    assetIds: [],
  }))
  const script = {
    ...base('雨夜来信'),
    kind: 'script' as const,
    content:
      '雨夜，林夏在车站收到一封旧信。陈默带她来到周伯的书店，揭开信中的秘密。',
    previousVersionId: null,
  }
  const episode = {
    ...base('第 1 集 · 来信'),
    kind: 'episode' as const,
    scriptId: script.id,
    order: 0,
  }
  const scenes = locations.map((location, i) => ({
    ...base(i === 0 ? '车站重逢' : '书店揭密'),
    kind: 'scene' as const,
    episodeId: episode.id,
    locationId: location.id,
    order: i,
  }))
  const board = {
    ...base('第 1 集分镜'),
    kind: 'storyboard' as const,
    episodeId: episode.id,
    previousVersionId: null,
  }
  const shots = [
    '雨中车站全景',
    '林夏打开旧信',
    '陈默撑伞出现',
    '书店门口',
    '周伯辨认笔迹',
    '三人沉默对视',
  ].map((name, i) => ({
    ...base(name),
    kind: 'shot' as const,
    storyboardId: board.id,
    sceneId: scenes[i < 3 ? 0 : 1]!.id,
    order: i,
    durationSeconds: 5,
    characterIds: characters.slice(0, i < 3 ? 2 : 3).map((c) => c.id),
    locationId: locations[i < 3 ? 0 : 1]!.id,
    propIds: props.map((p) => p.id),
    assetIds: [assets[i < 3 ? 0 : 1]!.id],
    imagePrompt: name + '，电影质感，竖屏',
    videoPrompt: '缓慢推进，保持角色一致性',
    previousVersionId: null,
  }))
  return [
    ...assets,
    ...locations,
    ...characters,
    ...props,
    script,
    episode,
    ...scenes,
    board,
    ...shots,
  ]
}
