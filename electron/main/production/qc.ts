import type { Shot, Entity } from '../../../src/shared/domain.js'
import type { AssetVersion } from '../../../src/shared/visual.js'
import type {
  ContinuityContext,
  QCOutput,
  QCReport,
} from '../../../src/shared/production.js'
import { qcOutputSchema } from '../../../src/shared/production.js'
export interface MediaQCInput {
  version: AssetVersion
  shot: Shot
  approvedKeyframe: AssetVersion | null
  references: Entity[]
  continuity: ContinuityContext
  media: Uint8Array
}
export interface MediaQCProvider {
  id: string
  evaluate(input: MediaQCInput, signal: AbortSignal): Promise<QCOutput>
}
export class MockMediaQCProvider implements MediaQCProvider {
  id = 'mock-qc'
  async evaluate(input: MediaQCInput, signal: AbortSignal): Promise<QCOutput> {
    if (signal.aborted) throw Error('QC cancelled')
    const issues: QCOutput['issues'] = []
    if (
      input.version.duration !== null &&
      Math.abs(input.version.duration - input.shot.durationSeconds) > 0.5
    )
      issues.push({
        category: 'action',
        severity: 'severe',
        description: '实际视频时长与镜头计划不一致',
        affectedSubject: input.shot.name,
        suggestedFix: '按镜头计划时长安排开始、过程与结束动作',
      })
    if (input.version.width < 256 || input.version.height < 256)
      issues.push({
        category: 'visualIntegrity',
        severity: 'warning',
        description: '素材尺寸偏小，建议检查可用清晰度',
        affectedSubject: input.version.id,
        suggestedFix: '提高输出分辨率并人工核对画面',
      })
    const source = input.version.metadata.continuityFingerprint
    if (typeof source === 'string' && source !== input.continuity.fingerprint)
      issues.push({
        category: 'continuity',
        severity: 'severe',
        description: '生成时连续性快照与当前剧情状态不同',
        affectedSubject: input.shot.name,
        suggestedFix: '以当前连续性状态重新编译 Prompt，人工核对旧版本',
      })
    const score = issues.some((i) => i.severity === 'severe')
      ? 45
      : issues.length
        ? 75
        : 95
    return qcOutputSchema.parse({
      identityScore: 95,
      costumeScore: 95,
      locationScore: 95,
      propScore: 95,
      actionScore: score,
      cameraScore: 95,
      visualIntegrityScore: score,
      continuityScore: score,
      overallScore: score,
      issues,
      suggestions: [
        'Mock 基于元数据和规则，不代表真实视觉身份或动作质量验证。',
        ...issues.map((i) => i.suggestedFix),
      ],
    })
  }
}
export function planRegeneration(report: QCReport) {
  const strategies: Record<QCOutput['issues'][number]['category'], string> = {
    identity: '保持 Character 身份参考，锁定面部、发型与基础身份',
    costume: '遵循当前 costume continuity，固定服装及配饰',
    location: '使用当前地点参考，固定空间、光照与天气',
    prop: '明确道具持有者、可见性和出场状态',
    action: '将动作改写为开始、过程、结束，匹配镜头时长',
    camera: '明确摄影机路径、景别与终点，避免额外运镜',
    visualIntegrity: '保留语义 Prompt，更换 Seed 并人工选择可用替代 Provider',
    continuity: '重新读取剧情连续性快照，保持伤势、持物和环境状态',
  }
  return {
    instructions: [
      ...new Set(report.output.issues.map((i) => strategies[i.category])),
    ],
    newSeed: report.output.issues.some((i) => i.category === 'visualIntegrity'),
  }
}
