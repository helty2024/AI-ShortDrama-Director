# Image API Tool（07-06）

## 实现与验证状态

| 层级 | 状态 |
| --- | --- |
| Image API Reference Adapter、HTTPS transport、授权生产链 | Implemented |
| 本地 HTTP 与 Electron 确认/审核流程 | Simulated validated |
| 指定真实供应商 | PackyAPI / gpt-image-2.5-sunburst |
| Real provider connectivity validated | Yes |
| Real paid generation validated | No |

07-06 的 Reference Adapter 状态仍只代表 loopback fixture。07-06.5 增加独立 Packy 原生 Adapter并验证真实模型列表；07-06.6 共执行三次明确授权的最小生成验证。第三轮在 `/images/generations` 只发送 `model / prompt / n`，HTTP transport 收到 2xx，但返回内容未通过受控输出校验，没有落入 Candidate AssetVersion。三次审计都按不明提交规则冻结，不能写成真实付费生成通过。Reference 协议仍不是 OpenAI、Seedream、Kling 或其他供应商的兼容性承诺。

应用 package version 保持 0.6.0，SQLite schema 保持 v8；不修改已发布 migration。新增 AITask 输入判别 `image-api`，复用现有任务和来源表，不新增调度表。公共 Image Capability 没有添加供应商私有参数。Estimate 新增可选的通用 currency 字段，使未知价格也能有明确币种；旧估价快照保持可读。

## 文件与工具边界

- `electron/main/tools/adapters/image-api.ts`：具体 Reference 协议 v1 映射，实现 image.generate / image.referenceGenerate。
- `image-http.ts`：单一、有限制的 HTTP transport，同时服务生成请求和临时媒体下载。
- `generation/image-service.ts`：Broker → 授权 → 执行 → 候选入库，主进程私有；不把业务 SQL 塞进 Adapter。
- `generation/image-profiles.ts`：安全配置加载、原生对话框文件导入和现有 CredentialStore 桥接。
- `src/shared/image-api.ts`：严格的 Profile 和窄 IPC schema。
- `ImageApiPanel.tsx`：生成页中的最小预览、确认、结果区域，未修改导航或首页。

每个配置有独立 toolId / modelId，Reference 映射版本为 toolVersion 1.0.0。通过 Registry + FIXED RoutingPolicy 选择工具，业务层没有供应商或模型分支。其它具体适配器可以实现 ToolAdapter 与受控 ImageExecutionAccess 接口，在主进程 composition 中注册；核心项目、预算与候选审核无需修改。Reference Profile 不是通用第三方 API 描述语言。

## Reference Profile 与协议

通过“生成 → 图像 API → 安全导入 Profile / Key”依次在原生文件对话框中选择 Profile JSON 与密钥文本。Renderer 不接收文件路径、原始 Key 或任意 endpoint 参数。Profile 示例：

```json
{
  "toolId": "my.image-reference",
  "displayName": "My Image Reference Service",
  "endpoint": "https://images.example.invalid/generate",
  "modelId": "my-model",
  "credentialRef": null,
  "supportedCapabilities": ["image.generate", "image.referenceGenerate"],
  "supportedResolutions": [{"width": 1024, "height": 1024}],
  "supportedAspectRatios": ["1:1"],
  "maxReferences": 4,
  "maxOutputCount": 4,
  "currency": "USD",
  "estimateSupport": "unknown",
  "cancelSupport": false,
  "recoverSupport": false
}
```

示例域名不可用于生成。必须先有明确实现此 Reference 协议的服务，或新增根据正式供应商契约开发的具体 Adapter。不能把任意供应商 endpoint 填进去就声称兼容。

Profile 位于 `app.getPath('userData')/image-api-profiles.json`，不随项目备份恢复；Key 由现有 Electron safeStorage/EncryptedCredentialStore 加密存储。Adapter 仅持有获取该 Profile 单个凭据的闭包，不能访问整个 CredentialStore 或 userData。配置文件和密钥文件分别有大小限制。当前不支持热替换同一 toolId；更改配置使用新 ID，避免已有预览悄悄切换身份。

Reference HTTP POST 的 JSON 内容：

```json
{
  "protocol": "director-image-reference-v1",
  "model": "my-model",
  "prompt": "compiled prompt",
  "negativePrompt": "",
  "resolution": {"width": 1024, "height": 1024},
  "aspectRatio": "1:1",
  "seed": null,
  "count": 1,
  "outputMime": "image/png"
}
```

referenceGenerate 额外含 references：assetVersionId、role、weight、mime、base64。role 沿用 identity/style/composition/subject。当前最小 UI 提供 identity 参考选择；其它角色可通过同一受控输入契约调用。参考媒体必须由 Core 根据项目内 AssetVersion 解析、检查大小/内容 hash 并读取受控 bytes，Adapter 不能读取任意文件路径。

认证为 `Authorization: Bearer <key>`。成功响应必须是 application/json，格式为：

```json
{
  "images": [{"base64": "...", "mime": "image/png"}],
  "cost": {"amountMicro": 1000, "currency": "USD"}
}
```

images 元素也可以是 `{"url":"https://trusted-public-cdn.example.invalid/temporary"}`。响应 count 必须匹配请求。cost 可省略；存在时表示这个明确协议下的实际费用，而非估价。Reference v1 不支持 provider file ID，未明确实现的响应字段会被拒绝。参考协议为同步 completed，不伪造远端轮询 ID。

## Preflight 与明确确认

health 只判断本地 Profile/安全凭据是否可用，不联网、不生成，available 的含义限于本地调用准备就绪。validate 返回远端未验证的说明，检查能力、模型、分辨率、画幅、数量、参考数量、指纹、配置和凭据；不上传参考媒体。estimate 返回 unknown，并记录 model/currency/basis、fingerprint、validUntil，不猜测定价。

预览通过 Broker 的隐私与 locality 过滤后才检查工具；local-only、sensitive-local-only、cloudAllowed=false 或 allowAssetUpload=false 会阻止 cloud 工具。为兼容现有保守策略，allowAssetUpload=false 也阻止发送文本生成描述。UI 显示 Cloud 发送说明、目标、Tool、Model、图片数、尺寸、参考数、估价、币种与到期时间。

页面加载和参数变化不会提交。用户必须填写整数微单位费用上限并明确勾选允许未知估价，再点击“确认生成（可能收费）”。确认只接受 projectId、主进程签发的 previewId、上限和 unknown-cost 选择；不能传入 Record、Reservation、路由、报价、endpoint 或 shell/path。

主进程将预览消费一次；重复、过期、跨项目、来源 revision 或 Registry 身份变化都会拒绝。授权、预算预留、AITask 和 GenerationRecord 创建在同一事务；失败全部回滚。确认返回任务，网络执行不阻塞 renderer。现有任务中心仍读取同一 AITask；新路径禁止从旧队列原地 retry/cancel，不引入第二个自动调度器或扫描重提循环。

## Submit、费用与不明提交

顺序：PromptPackage → Broker preflight → 不可变 RoutingDecision/Estimate → 独立 Approval → Reservation → AITask → GenerationRecord → markSubmissionIntent → 最终 Broker/Registry/Tool 检查 → Adapter.submit。

提交前意图已持久化。只有本地门禁尚未调用 Adapter，或 transport 明确证明没有发送生成请求，才释放预算。连接中断、超时、模糊响应保留 unknown-submission / pending-unknown；即使只是在下载图片时发生未发送错误，也不能将其当作生成请求未发送来退款。不会自动重试、换供应商或释放。

400/401/403/429/5xx 分别规范化为 validation/authentication/authorization/rate-limit/provider，网络与超时有独立错误。HTTP 状态本身不是“未创建任务、未收费”的供应商证明，首版仍保留预算等待核对。没有把原始 provider body、认证头或签名 URL 放入错误、日志和来源记录。

有明确结构化实际费用时，沿用 07-05 consume 原子写入 Reservation 和 Record，低于预留释放差额，超出预留进入 requires-review/cost-overrun；不自动补授权。无实际费用时即使图片成功，actualCost 仍为 null，预算仍持有。本 Reference 协议没有账单回查能力或面向用户的结算核对 UI，不能自动核实或解除这部分预算。

Service 也能处理实现了 async 生命周期的 Image Tool：绑定 accepted handle → 写现有 AITask.providerTaskId → Broker status/result → 同一 ingestion/审核链。已结算的尝试也可补齐已验证远端 handle，不改变预算。此分支使用测试 Adapter 验证；Reference HTTP Profile 本身没有宣称 async/cancel/recover 支持。

## Output ingestion 与人工采用

供应商临时 URL 只在 Adapter/transport 的短期内存中出现。下载使用 HTTPS；测试例外仅是注入的精确 127.0.0.1 HTTP origin。检查 DNS 的 IPv4 地址并将连接固定到已检查地址，防止再次解析时转入私网；首版保守拒绝 IPv6。拒绝 file URL、认证 URL、内网/保留网段、重定向（上限为 0），限制 DNS/请求等待、Content-Length、流式字节数、JSON 总大小和每张图片 30 MiB。

Core 使用 sharp 验证真实 MIME、完整解码、单帧、像素上限及请求尺寸；不接受 HTML 冒充图片或尺寸不一致。然后复用现有 MediaStorage 计算 SHA-256、保存原图和缩略图，Broker 签发 output handle。原视频下载器属于 legacy 路径，其实现不满足本路径的 DNS 固定和统一字节边界，所以没有复用其宽松的 URL 检查；本路径的 API 和媒体下载共用一个 transport。

所有输出都验证成功后，在一次 SQLite 事务内创建 Asset、N 个 draft AssetVersion、GenerationOutputs，并完成原 Record/Task。任何输出失败都不会部分发布候选。已写到磁盘但未入库的文件交给原有 orphan scan 处理，不直接删除用户媒体。

一笔 count=4 请求只产生一个 GenerationRecord 和四个候选版本。用户通过现有 VisualRepository.review / saveReferences / Shot keyframe 语义审核和采用，不能自动替换正式引用。最小区域提供“审核批准版本”和“审核并采用到目标”，原素材库继续支持完整版本审核、拒绝、归档与比较。

同步任务完成后重启，候选、审核状态、正式引用和来源记录均从原数据库读取。启动遇到尚未进入提交区间的本地预留会归档失败并释放；可能已经收费的记录归档为未知且继续持有。没有远端任务 ID 的同步请求无法自动找回丢失响应，不能伪造恢复；已知 async ID 保留供后续具体 Adapter 的核对流程使用，当前不自动恢复轮询。

## 测试与范围

单元测试通过真正 HTTP fixture 测试正常 base64/URL、1/4 输出、参考图片、400/401/403/429/500、超时、连接中断、非法 JSON、图像解码、MIME、尺寸、超大 Content-Length、redirect、私网地址、审批/来源变化、费用、重启和凭据脱敏。服务器在收到 POST 时断言 Reservation 已 submitted 且 Task/Record 已存在。

Electron smoke 使用独立临时 userData，真实点击预览、填写上限、确认、审核采用并重启验证。测试 composition 仅在 unpackaged + DIRECTOR_TEST_USER_DATA + 显式 DIRECTOR_TEST_IMAGE_ORIGIN（严格 loopback）同时成立时注入；不会进入安装包或读取真实凭据。

运行 typecheck、lint、test:unit、build、test:smoke。没有删除或改写旧 Image Provider / executor，没有接 Video API、ComfyUI 新路径、Blender、WorkflowRun/StepRun、Canvas，未生成安装包。

07-07 前仍需明确具体供应商正式契约、可靠账单语义、远端核对/恢复方式，以及另行批准的真实付费验收。不能把本地模拟通过写成真实供应商已验证。

补充边界验证：发送前网络故障使用 transport 边界故障注入，明确 sent=false，断言 HTTP/计费计数均为零、预算释放；发送后的断连使用真实 HTTP socket 中断验证。超授权实际费用进入 requires-review，并在结果区明确提示人工核对，不补授权或自动再收费。

## 07-06.5 后续状态

PackyAPI 已新增独立原生 Adapter，未改用 Reference 协议。真实模型列表连通性验证已完成。第三轮在正确 path 上得到 2xx，但适配器最终记录 `malformed-response`；无图片、候选版本或可核实 actual cost。三次 `unknown-submission` 与预留额度均保留，未自动重试。具体限制与安全配置见 [Packy Image 2.5](packy-image-25.md)。
