import { z } from 'zod'
import { sceneSchema, entitySchema } from '../../../src/shared/domain.js'
import type { BreakdownItem } from '../../../src/shared/intelligence.js'
import { ValidatedTextProvider } from './provider.js'
import type { ProviderOptions, StructuredRequest } from './provider.js'

export class MockTextProvider extends ValidatedTextProvider {
  readonly name = 'mock-text（本地规则演示）'
  private readonly respond?: (input: unknown) => Promise<unknown>
  constructor(
    options?: ProviderOptions,
    respond?: (input: unknown) => Promise<unknown>,
  ) {
    super(options)
    this.respond = respond
  }
  protected async generateRaw<T>(
    request: StructuredRequest<T>,
  ): Promise<unknown> {
    if (this.respond) return this.respond(request.input)
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      }
      const timer = setTimeout(() => {
        request.signal.removeEventListener('abort', abort)
        resolve()
      }, 80)
      request.signal.addEventListener('abort', abort, { once: true })
    })
    const input = z
      .object({
        scene: sceneSchema,
        knownEntities: z.array(entitySchema),
        type: z.string(),
      })
      .parse(request.input)
    const scene = input.scene.content
    const names = [
      ...new Set([
        ...scene.characters,
        ...scene.dialogue.map((line) => line.characterName).filter(Boolean),
      ]),
    ]
    const narrative = [
      scene.action,
      scene.narration,
      scene.notes,
      ...scene.dialogue.map((line) => line.text),
    ].join('\n')
    if (input.type === 'shotPlanning') {
      const characters = input.knownEntities
        .filter(
          (e) =>
            e.kind === 'character' &&
            (names.includes(e.name) ||
              e.bible.aliases.some((alias) => names.includes(alias))),
        )
        .map((e) => e.id)
      const location = input.knownEntities.find(
        (e) =>
          e.kind === 'location' &&
          (e.id === input.scene.locationId || e.name === scene.location),
      )
      const props = input.knownEntities
        .filter((e) => e.kind === 'prop' && narrative.includes(e.name))
        .map((e) => e.id)
      return {
        shots: ['建立空间', '人物动作', '情绪反应'].map((shotType, i) => ({
          shotNumber: i + 1,
          shotType,
          framing: ['全景', '中景', '近景'][i],
          cameraAngle: '平视',
          cameraMovement: i === 0 ? '缓慢推进' : '固定',
          focalLengthSuggestion: i === 0 ? '28mm' : '50mm',
          subject: names.join('、') || scene.location || input.scene.name,
          action: scene.action.slice(0, 500) || '依据场次内容待导演调整',
          emotion: '待导演确认',
          durationSuggestion: 4,
          characterRefs: characters,
          locationRef: location?.id ?? null,
          propRefs: props,
          continuityNotes:
            'Mock 镜头建议：确认轴线、人物位置与道具状态后使用。',
        })),
      }
    }
    const elements: BreakdownItem[] = []
    const add = (
      category: BreakdownItem['category'],
      name: string,
      description: string,
      confidence = 0.8,
    ) => {
      if (name.trim())
        elements.push({
          category,
          name: name.slice(0, 120),
          description,
          confidence,
          reason: 'Mock 规则提取；依据场次文本，需人工核对。',
          attributes: [],
        })
    }
    names.forEach((name) => {
      add('character', name, '在本场角色名单或对白中出现')
      if (input.type === 'characterBible')
        elements.at(-1)!.attributes = [
          {
            field: 'visualPrompt',
            value: `${name}，角色设定参考；外貌与服装待人工明确。`,
          },
          { field: 'continuityNotes', value: `来源场次：${input.scene.name}` },
        ]
    })
    if (input.type !== 'characterBible') {
      add('location', scene.location || input.scene.name, scene.heading)
      const dictionary: [BreakdownItem['category'], string[]][] = [
        [
          'prop',
          [
            '旧信',
            '黑伞',
            '钥匙',
            '手机',
            '手枪',
            '信封',
            '杯子',
            '照片',
            '手表',
          ],
        ],
        ['costume', ['外套', '制服', '长裙', '衬衫']],
        ['makeup', ['口红', '伤痕', '血妆']],
        ['vehicle', ['汽车', '自行车', '火车', '摩托车']],
        ['vfx', ['爆炸', '魔法', '绿幕']],
        ['sfx', ['雷声', '脚步声', '枪声', '电话铃']],
        ['environment', ['雨', '雪', '雾', '风']],
      ]
      for (const [category, words] of dictionary)
        for (const word of words)
          if (narrative.includes(word) || scene.heading.includes(word))
            add(category, word, `文本提及“${word}”`)
      add('timeOfDay', scene.timeOfDay, '场次时间标记', 1)
      if (scene.action)
        add('keyAction', scene.action.slice(0, 60), scene.action)
      if (scene.notes) add('continuityNote', '场次备注', scene.notes)
      for (const mood of ['紧张', '悲伤', '喜悦', '愤怒', '平静'])
        if (narrative.includes(mood)) add('mood', mood, '文本中的情绪词')
    }
    return { elements }
  }
}
