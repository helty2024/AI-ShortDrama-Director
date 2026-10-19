import { useState } from 'react'
import type { ImageApiPreview } from '../../shared/image-api'
import type { VideoApiPreview } from '../../shared/video-api'
import type { WorkflowSnapshot } from '../../shared/workflow'
import { currencyToMicro } from './cost'
import { isAlphaTestTool } from '../../shared/alpha'

type Preview = ImageApiPreview | VideoApiPreview
export function GenerationConfirm({ preview, workflow, onCancel, onConfirm, busy, testToolId }: {
  preview: Preview; workflow?: WorkflowSnapshot | null; onCancel: () => void; onConfirm: (micro: number, unknown: boolean) => Promise<void>; busy: boolean; testToolId?: string
}) {
  const [amount, setAmount] = useState('')
  const [unknown, setUnknown] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const local = 'knownFree' in preview && preview.knownFree && preview.executionMode === 'local-service'
  const test = isAlphaTestTool(workflow?.run.inputSnapshot.generation.toolId ?? testToolId ?? '')
  const micro = local || test ? 0 : currencyToMicro(amount)
  const upload = 'referenceCount' in preview ? preview.referenceCount > 0 : preview.inputImageCount > 0
  const unknownRequired = !/^预估费用 [A-Z]{3} \d+\.\d{4}$/.test(preview.estimate)
  return <div className="creator-generate-confirm-backdrop"><section className="creator-generate-confirm" role="dialog" aria-modal="true" aria-label="确认生成">
    <h2>{test ? '确认模拟生成' : local ? '确认本地生成' : '确认生成'}</h2>
    {test && <p className="alpha-test-notice">测试视频 / 模拟生成。只在本机执行，不调用 CompShare，不消费积分。结果是带测试标记的演示画面。</p>}
    {preview.model === 'gpt-image-2.5-flare' && <p>此图像服务使用自动尺寸，实际结果可能与计划尺寸不同；作品会保留实际尺寸。</p>}
    <dl><dt>生成数量</dt><dd>{'count' in preview ? preview.count : 1}</dd><dt>尺寸</dt><dd>{preview.resolution.width}×{preview.resolution.height}</dd>{'durationSeconds' in preview && <><dt>时长</dt><dd>{preview.durationSeconds} 秒</dd></>}<dt>预计费用</dt><dd>{test ? '测试生成，不收费' : local ? 'API 费用 0' : preview.estimate}</dd><dt>参考素材</dt><dd>{upload ? test ? '仅发送到本机模拟服务' : '将发送所选素材' : '不发送'}</dd></dl>
    <details><summary>高级生成 · 实际编译 Prompt</summary><dl><dt>工具</dt><dd>{preview.tool}</dd><dt>模型</dt><dd>{preview.model}</dd><dt>Prompt</dt><dd>{preview.prompt}</dd><dt>Negative Prompt</dt><dd>{preview.negativePrompt ?? '当前预览未返回'}</dd><dt>Compiler Version</dt><dd>{preview.compilerVersion ?? '当前预览未返回'}</dd><dt>参考素材</dt><dd>{'referenceCount' in preview ? preview.referenceCount : preview.inputImageCount}</dd></dl><p>{preview.disclosure}</p></details>
    {test ? <p>只验证制作流程。确认生成后，仍需单独批准候选并采用。</p> : local ? <p>本机 ComfyUI 执行；API 费用为 0，不包含本机电费与 GPU 成本。</p> : <><label>单次费用上限（{preview.currency}）<input aria-label="单次费用上限" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例如 0.50" /></label>{amount && micro === null && <p role="alert">请输入非负金额，最多 6 位小数，且不超过安全范围。</p>}{unknownRequired && <><label><input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} />允许费用未知，按上述额度保留本地预算</label><p>未知费用不是 0 元。本地授权额度不能保证供应商实际结算封顶；积分不等于货币。请核对供应商价格后确认。</p></>}</>}
    <label><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />我确认本次{local ? '本地执行' : '生成与费用授权'}{upload ? '，并允许发送所选参考素材' : ''}</label>
    {workflow && <small>当前流程：{workflow.run.workflowType === 'shot-keyframe' ? '镜头关键帧' : '镜头视频'}</small>}
    <div className="actions"><button disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy || !accepted || micro === null || (!local && !test && unknownRequired && !unknown)} onClick={() => { if (micro !== null) void onConfirm(micro, test ? true : local ? false : unknownRequired && unknown) }}>确认生成</button></div>
  </section></div>
}
