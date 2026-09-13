import {
  toolErrorCodeSchema,
  toolErrorSchema,
} from '../../../src/shared/tools.js'
import type { ToolError } from '../../../src/shared/tools.js'

const messages: Record<ToolError['code'], string> = {
  validation: '工具输入无效',
  authentication: '工具身份认证失败',
  authorization: '工具访问未获授权',
  'rate-limit': '工具请求频率受限',
  network: '工具网络连接失败',
  timeout: '工具等待超时',
  provider: '工具执行失败',
  dependency: '工具依赖未就绪',
  resource: '工具资源不足',
  cancelled: '工具任务已取消',
  'unknown-submission': '提交结果不明确，请先核对外部任务，不能自动重提',
  'malformed-response': '工具返回了无效结果',
}

/** Never copy raw messages, stack traces, headers, URLs or provider response bodies.
 * For submit transport ambiguity the caller must set submissionMayHaveOccurred.
 */
export function normalizeToolError(
  raw: unknown,
  submissionMayHaveOccurred = false,
): ToolError {
  const property =
    raw !== null && typeof raw === 'object'
      ? Object.getOwnPropertyDescriptor(raw, 'code')
      : undefined
  const parsed = toolErrorCodeSchema.safeParse(
    property && 'value' in property ? property.value : undefined,
  )
  const code = submissionMayHaveOccurred
    ? 'unknown-submission'
    : parsed.success
      ? parsed.data
      : 'provider'
  return toolErrorSchema.parse({
    code,
    message: messages[code],
    retryability:
      code === 'unknown-submission'
        ? 'query-only'
        : code === 'cancelled' || code === 'validation'
          ? 'never'
          : 'manual',
    details: {},
  })
}
