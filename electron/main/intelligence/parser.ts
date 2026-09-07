import {
  emptyScene,
  parsedScriptSchema,
} from '../../../src/shared/intelligence.js'
import type {
  ParsedScript,
  SceneContent,
} from '../../../src/shared/intelligence.js'

export function parseScript(rawText: string): ParsedScript {
  if (!rawText.trim() || rawText.length > 100000)
    throw new Error('剧本文本不能为空且不能超过 100000 字符')
  const episodes: ParsedScript['episodes'] = []
  let episode: ParsedScript['episodes'][number] | undefined
  let scene: SceneContent | undefined
  let recognized = 0
  const ensureEpisode = () => {
    if (!episode) {
      episode = { name: '第 1 集', scenes: [] }
      episodes.push(episode)
    }
    return episode
  }
  const newScene = (heading: string, number: string) => {
    const parent = ensureEpisode()
    scene = structuredClone(emptyScene)
    scene.heading = heading
    scene.sceneNumber = number || String(parent.scenes.length + 1)
    scene.interiorExterior = /内景|\bINT\b/i.test(heading)
      ? /外景|\bEXT\b/i.test(heading)
        ? 'INT/EXT'
        : 'INT'
      : /外景|\bEXT\b/i.test(heading)
        ? 'EXT'
        : 'UNKNOWN'
    scene.timeOfDay = /夜|NIGHT/i.test(heading)
      ? '夜'
      : /黄昏|DUSK/i.test(heading)
        ? '黄昏'
        : /晨|DAWN/i.test(heading)
          ? '清晨'
          : /日|白天|DAY/i.test(heading)
            ? '日'
            : ''
    scene.location = heading
      .replace(
        /^(?:第\s*[\d一二三四五六七八九十百]+\s*场|\d+[-—.]\d+|\d+[.、])/u,
        '',
      )
      .replace(
        /内景|外景|\bINT\.?|\bEXT\.?|白天|黄昏|清晨|日|夜|\bDAY\b|\bNIGHT\b/gi,
        '',
      )
      .replace(/^[\s:：.\-/—]+|[\s:：.\-/—]+$/g, '')
      .trim()
    parent.scenes.push(scene)
    return scene
  }
  const append = (key: 'action' | 'narration' | 'notes', value: string) => {
    const current = scene ?? newScene('未标注场次', '')
    current[key] += (current[key] ? '\n' : '') + value
  }
  for (const original of rawText.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = original.replace(/^\s*#{1,6}\s*/, '').trim()
    if (!line) continue
    if (
      /^(?:第\s*[\d一二三四五六七八九十百]+\s*集|EPISODE\s+\d+)/i.test(line)
    ) {
      episode = { name: line.slice(0, 120), scenes: [] }
      episodes.push(episode)
      scene = undefined
      recognized++
      continue
    }
    if (
      /^(?:第\s*[\d一二三四五六七八九十百]+\s*场|\d+[-—.]\d+\s|(?:INT|EXT)(?:[.\s/])|内景|外景)/i.test(
        line,
      )
    ) {
      newScene(
        line.slice(0, 300),
        line.match(
          /^(?:第\s*)?([\d一二三四五六七八九十百]+(?:[-.]\d+)?)/,
        )?.[1] ?? '',
      )
      recognized++
      continue
    }
    const cast = line.match(/^(?:人物|角色|出场人物)\s*[:：]\s*(.+)$/)
    if (cast) {
      const current = scene ?? newScene('未标注场次', '')
      current.characters = [
        ...new Set([
          ...current.characters,
          ...cast[1]!
            .split(/[、,，/]/)
            .map((v) => v.trim())
            .filter(Boolean),
        ]),
      ]
      recognized++
      continue
    }
    const voice = line.match(
      /^(?:旁白|画外音|NARRATION|VO|V\.O\.)\s*[:：]\s*(.*)$/i,
    )
    if (voice) {
      append('narration', voice[1]!)
      recognized++
      continue
    }
    const action = line.match(/^(?:动作|ACTION)\s*[:：]\s*(.*)$/i)
    if (action) {
      append('action', action[1]!)
      recognized++
      continue
    }
    const note = line.match(/^(?:备注|注|NOTES?)\s*[:：]\s*(.*)$/i)
    if (note) {
      append('notes', note[1]!)
      continue
    }
    const dialogue = line.match(
      /^([^:：()（）]{1,30}?)(?:[（(]([^）)]*)[）)])?\s*[:：]\s*(.*)$/,
    )
    if (dialogue) {
      const current = scene ?? newScene('未标注场次', '')
      const characterName = dialogue[1]!.trim()
      current.dialogue.push({
        characterId: null,
        characterName,
        parenthetical: dialogue[2] ?? '',
        text: dialogue[3]!,
      })
      if (!current.characters.includes(characterName))
        current.characters.push(characterName)
      recognized++
      continue
    }
    append('action', original)
  }
  for (const item of episodes)
    if (!item.scenes.length)
      item.scenes.push({
        ...structuredClone(emptyScene),
        sceneNumber: '1',
        heading: '待整理场次',
      })
  if (!episodes.length) newScene('未标注场次', '1')
  return parsedScriptSchema.parse({
    episodes,
    warnings: recognized
      ? [
          '自动识别为初稿，请核对场次、人物和对白；未识别行已保留在动作中，原文完整保存。',
        ]
      : [
          '未识别到标准剧本标记，全文保留为动作；可修改预览后确认，或修订原文重新解析。',
        ],
  })
}
