import type { AIServiceInput } from '../../shared/ai-services.js'

// Templates describe request settings, not verified account/model availability.
export const textServicePresets = [
  { id: 'sensenova', name: '商汤 SenseNova 6.8', baseUrl: 'https://token.sensenova.cn/v1', textOutputMode: 'json-prompt', model: 'sensenova-6.8-flash-lite' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', textOutputMode: 'json-object' },
  { id: 'qwen', name: '通义千问（百炼·北京）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', textOutputMode: 'json-object' },
  { id: 'ark', name: '火山方舟（北京）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', textOutputMode: 'json-object' },
] as const

export function applyTextServicePreset(input: AIServiceInput, id: string): AIServiceInput {
  const preset = textServicePresets.find(p => p.id === id)
  if (input.kind !== 'text' || !preset) return input
  return { ...input, name: preset.name, baseUrl: preset.baseUrl, model: 'model' in preset ? preset.model : '', textOutputMode: preset.textOutputMode }
}
