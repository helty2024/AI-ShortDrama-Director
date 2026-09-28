import { useState } from 'react'
import type { ImageApiPreview } from '../../shared/image-api'
import type { VideoApiPreview } from '../../shared/video-api'
import type { WorkflowSnapshot } from '../../shared/workflow'
import { currencyToMicro } from './cost'

type Preview = ImageApiPreview | VideoApiPreview
export function GenerationConfirm({ preview, workflow, onCancel, onConfirm, busy }: {
  preview: Preview; workflow?: WorkflowSnapshot | null; onCancel: () => void; onConfirm: (micro: number, unknown: boolean) => Promise<void>; busy: boolean
}) {
  const [amount, setAmount] = useState('')
  const [unknown, setUnknown] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const local = 'knownFree' in preview && preview.knownFree && preview.executionMode === 'local-service'
  const micro = local ? 0 : currencyToMicro(amount)
  const upload = 'referenceCount' in preview ? preview.referenceCount > 0 : preview.inputImageCount > 0
  return <div className="creator-generate-confirm-backdrop"><section className="creator-generate-confirm" role="dialog" aria-modal="true" aria-label="确认生成">
    <h2>{local ? '确认本地生成' : '确认生成'}</h2>
    <dl><dt>工具</dt><dd>{preview.tool}</dd><dt>模型</dt><dd>{preview.model}</dd><dt>生成数量</dt><dd>{'count' in preview ? preview.count : 1}</dd><dt>尺寸</dt><dd>{preview.resolution.width}×{preview.resolution.height}</dd>{'durationSeconds' in preview && <><dt>时长</dt><dd>{preview.durationSeconds} 秒</dd></>}<dt>预计费用</dt><dd>{local ? 'API 费用 0' : preview.estimate}</dd><dt>上传参考素材</dt><dd>{upload ? '是' : '否'}</dd></dl>
    <details><summary>高级生成 · 实际编译 Prompt</summary><dl><dt>Prompt</dt><dd>{preview.prompt}</dd><dt>Negative Prompt</dt><dd>{preview.negativePrompt ?? '当前预览未返回'}</dd><dt>Compiler Version</dt><dd>{preview.compilerVersion ?? '当前预览未返回'}</dd><dt>参考素材</dt><dd>{'referenceCount' in preview ? preview.referenceCount : preview.inputImageCount}</dd></dl><p>{preview.disclosure}</p></details>
    {local ? <p>本机 ComfyUI 执行；API 费用为 0，不包含本机电费与 GPU 成本。</p> : <><label>单次费用上限（{preview.currency}）<input aria-label="单次费用上限" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例如 0.50" /></label>{amount && micro === null && <p role="alert">请输入非负金额，最多 6 位小数，且不超过安全范围。</p>}<label><input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} />允许费用未知，但仍受上述单次上限约束</label></>}
    <label><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />我确认本次{local ? '本地执行' : '生成与费用授权'}{upload ? '，并允许发送所选参考素材' : ''}</label>
    {workflow && <small>当前流程：{workflow.run.workflowType === 'shot-keyframe' ? '镜头关键帧' : '镜头视频'}</small>}
    <div className="actions"><button disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy || !accepted || micro === null || (!local && !unknown)} onClick={() => { if (micro !== null) void onConfirm(micro, local ? false : unknown) }}>确认生成</button></div>
  </section></div>
}
