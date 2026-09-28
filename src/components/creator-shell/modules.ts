export const primaryModules = ['story', 'scripts', 'assetsHub', 'storyboard', 'generation', 'shotVideos'] as const
export type CreatorModule = typeof primaryModules[number] | 'settings' | 'operations'
export const creatorLabels: Record<CreatorModule, string> = {
  story: '故事', scripts: '剧本', assetsHub: '资产', storyboard: '分镜',
  generation: '生成', shotVideos: '分镜视频', settings: '项目设置', operations: '验收与维护',
}
const legacyOwner: Record<string, CreatorModule> = {
  characters: 'assetsHub', locations: 'assetsHub', props: 'assetsHub', assets: 'assetsHub',
  production: 'generation',
  legacyGeneration: 'generation',
}
export function creatorModuleOf(module: string): CreatorModule {
  return (legacyOwner[module] ?? (module in creatorLabels ? module : 'story')) as CreatorModule
}
