import { z } from 'zod'

export const compatibilityCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('lineage'), projectId: z.uuid(), versionId: z.uuid() }),
  z.strictObject({ op: z.literal('generation'), projectId: z.uuid(), recordId: z.uuid() }),
  z.strictObject({ op: z.literal('readiness') }),
])
export const lineageSchema = z.strictObject({
  source: z.enum(['Generated', 'Imported', 'Legacy / provenance unavailable']),
  versionId: z.uuid().nullable(), status: z.string(), createdAt: z.string(),
  // Read projection only: source tables remain authoritative.
  fields: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  links: z.strictObject({
    outputId: z.uuid().nullable(), recordId: z.uuid().nullable(), taskId: z.uuid().nullable(),
    routingDecisionId: z.uuid().nullable(), promptPackageId: z.uuid().nullable(), importId: z.uuid().nullable(),
    stepRunId: z.uuid().nullable(), workflowRunId: z.uuid().nullable(),
  }),
})
export type Lineage = z.infer<typeof lineageSchema>
export const readinessSchema = z.array(z.strictObject({
  toolId: z.string(), name: z.string(),
  validation: z.enum(['implemented', 'simulated-validated', 'real-local-validated', 'real-connectivity-validated', 'real-generation-partially-validated', 'real-e2e-validated', 'not-validated', 'unavailable']),
  runtime: z.enum(['offline', 'capability-blocked', 'ready-for-configured-template', 'configuration-required', 'configured-unverified', 'development-test-only', 'unavailable']),
  capabilities: z.array(z.string()), detail: z.string(), checkedAt: z.iso.datetime(),
}))
export type Readiness = z.infer<typeof readinessSchema>
export const productionMessages: Record<string, string> = {
  'tool-unavailable': '工具当前不可用，请检查服务状态。',
  'capability-blocked': '工具在线，但当前能力或模板依赖不满足。',
  'missing-model': '缺少所需模型。', 'missing-node': '缺少所需节点。',
  validation: '输入或能力校验失败，请检查生成参数。',
  'validation-failed': '输入或能力校验失败，请检查生成参数。',
  'unknown-submission': '请求已发出，但无法确认远端是否已建立任务。为避免重复扣费，系统不会自动重试。',
  'remote-task-missing': '远端任务不存在；不会自动重新提交。',
  'malformed-output': '结果处理失败；请核对输出诊断与账单，不会自动重提。',
  'output-ingestion-failed': '结果入库失败；请核对输出诊断与账单。',
  'billing-pending': '费用未知，等待人工核对。',
  'pending-unknown': '费用未知，预算继续持有，等待人工核对。',
  'requires-review': '费用需要人工核对。',
  'waiting-user': '等待人工确认。', 'stopped-by-user': '用户已停止后续步骤。',
  'legacy-provenance-unavailable': 'Legacy / provenance unavailable',
}
export function productionMessage(code: string) { return productionMessages[code] ?? '任务尚未完成，请查看生产记录。' }
export function moneyLabel(value: { amountMicros: number; currency: string } | null) {
  return value === null ? 'unknown / 费用未知' : `${value.currency} ${(value.amountMicros / 1_000_000).toFixed(6)} · ${value.amountMicros === 0 ? 'known zero' : 'known non-zero'}`
}
