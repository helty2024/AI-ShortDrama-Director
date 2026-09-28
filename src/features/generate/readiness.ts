export function videoToolReady(profiles: readonly { toolId: string }[], toolId: string): boolean {
  return Boolean(toolId) && profiles.some((profile) => profile.toolId === toolId)
}
