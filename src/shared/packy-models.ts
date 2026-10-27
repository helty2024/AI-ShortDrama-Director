export const packyImageModels = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2'] as const
export const packyImageModelNames = {
  'gpt-image-2.5-sunburst': 'PackyAPI · GPT Image 2.5 Sunburst',
  'gpt-image-2.5-flare': 'PackyAPI · GPT Image 2.5 Flare',
  'gpt-image-2': 'PackyAPI · GPT Image 2',
} as const

// Protocol support is distinct from per-account real execution validation.
export const packyTextOnlyModels: readonly string[] = ['gpt-image-2.5-flare']
