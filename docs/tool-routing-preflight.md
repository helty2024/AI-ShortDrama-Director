# 07-03：工具注册、路由与预检

施工依据：[Architecture Baseline v2](platform-architecture.md)、[Implementation Roadmap v2](implementation-roadmap-v2.md)。本轮基础设施独立存在，尚未连接 Project Core、UI、旧 Provider、Executor 或旧 Production Router。

## 结构与调用顺序

- `electron/main/tools/registry.ts`：受信主进程组合代码显式 register；登记时解析 ToolDescriptor 并冻结身份和能力快照。相同 ID/version 的冲突实例拒绝；同一实例重复登记幂等。get 使用精确版本；list/findByCapability 稳定排序。不扫描目录、安装工具或加载外部代码，也不把 describe.availability 当动态健康结论。
- `electron/main/tools/routing.ts`：纯数据 Candidate + Policy → RouteResult。没有 Adapter、网络、凭据、文件系统或执行调用。调用者传入审计 UUID/时间；二者不参与偏好排序。无候选返回结构化阻塞，不伪造成功 Decision。
- `electron/main/tools/broker.ts`：受控预检、超时/Abort、结果 schema 校验、请求归属、内存输出签发。没有 submit 方法，也没有真实提交重试或 fallback。

Broker preflight：验证 projectId/requestId 与类型化能力快照 → Registry → 静态能力/隐私/运行位置过滤 → 对剩余候选依次 health、validate、estimate → 纯 route → 对选中工具再次 health、validate、estimate → PreflightResult。第二轮取得引用最终 Decision ID 的报价。候选比较报价的 routingDecisionId 为 null，不能用于后续授权。

最终预检失败返回 blocked，不自动改选工具；调用者只能在尚未提交时发起新的 preflight。新预检立即使原预检失效，并发中的旧结果不得覆盖新结果。预检失败的工具不会被当成 ready；健康为 unavailable 时不执行 validate，validation 无效时不执行 estimate。

30 项新增行为测试见 `tests/unit/routing.test.ts`、`tests/unit/tool-broker.test.ts`；`npm run test:unit` 同时运行既有测试。07-02 的两个模拟工具未经修改，通过真实 Broker 调用仍保持 submit/upload/billing 计数为零。无付费调用或真实供应商验收。

## 选路与未知信息

FIXED 沿用契约编码 `fixed`，指定 toolId，可省略 version 和 model。无 version 时在符合条件的该工具版本中按偏好与稳定身份排序；不声称自动选择“最新版”。不存在、不健康、能力不符、隐私冲突、资源不足或超预算时阻塞，不切换其他 toolId。

AUTO 依次检查能力、隐私、local/cloud、可用性、资源、预算，再比较 cost/speed/quality。健康快照需在 60 秒内且不得来自未来；声明能力不表示工具在线。隐私分类为 public/project-private/sensitive-local-only；后者禁止云端。cloudAllowed=false、local-only 和 allowAssetUpload=false 均在调用 Adapter 前过滤云端工具。当前对 upload=false 采取保守行为：不向云端发送项目请求文本或媒体引用。

`policy.unknown` 显式控制 cost/duration/quality/resources 的 allow/reject。旧策略省略该字段时默认 cost/resources=reject、duration/quality=allow。严格预算下，即使 cost=allow，未知费用仍被拒绝；不同币种没有换算依据时不直接比较，预算币种不符被排除。金额沿用整数微单位。预算过滤不是 GenerationApproval。

资源来自外部快照，不探测操作系统。沿用 memoryMB/gpuMemoryMB：已知 GPU 要求 >0 表示需要 GPU，数值表示最小显存；已知 0 表示无要求，unknown/unsupported 不视为足够。GPU/内存仅比较本地工具的要求；云服务不占用本地 GPU。cloud/local-service 需要 networkAvailable；未知按资源策略处理。未新增 disk 约束，因为原契约没有此字段。

质量必须有匹配 policy evaluationId/version 的 evidence 与 score，否则保持 unknown。Broker 当前未连接评价服务，准备的质量均 unknown。只有所有合格候选在某偏好维度都有可比证据时，才使用该维度排序；费用还要求同币种。未知耗时、质量不会被赋予高低分；这也避免混合 unknown 的两两比较产生不传递排序。最终按 toolId + version + model 稳定打破平局。

## 决策与预检有效性

RoutingDecision 沿用 07-01 schema，增加可选 policySnapshot、candidateEvidence 和 rejectedCandidates.code/toolVersion。结构化排除原因包含 capability-mismatch、privacy-conflict、execution-mode-conflict、unavailable、resource-insufficient、budget-exceeded、unknown-not-allowed、fixed-tool-unusable、preflight-invalid。旧 reason 字符串仍兼容。

Decision、策略、排除原因及证据都解析为独立数据并递归 freeze。候选报价 ID、费用、最大预计耗时、适用质量证据与健康检查时间进入审计快照。重新路由生成新的 ID，不修改既有 Decision。

assertCurrent 检查 Broker 原始结果身份、请求归属、当前 Registry 实例、工具/版本/模型、策略、能力输入指纹、validation 指纹、estimate 的决策引用及有效期。健康超过 60 秒也阻塞继续准备。过期报价在比较阶段退回 unknown，但最终预检始终拒绝过期报价。

本轮指纹包含能力输入与输入素材版本 ID、工具身份/版本和模型；尚未接 Project Core，因此 sourceRevisions 为空、routing semantic 为 null。策略及 Decision 身份另外精确绑定；策略变化必须重新预检。后续领域接入时应提供冻结来源 revision 与必要路由语义，并继续保持 Decision ID 不进入语义哈希。不得把当前空来源当成完整生产来源记录。

## Ownership 与输出签发

openExecution 与 markUnknownSubmission 是受信 Runtime 的集成接口，不是 renderer/IPC API，不实施或批准付费提交。前者在外部已明确执行后绑定 projectId、taskId、requestFingerprint、Decision、工具/版本与可选外部任务；同步执行传 null，不虚构远端任务。后者锁定提交状态不明的请求。两者都会阻止该请求再次 preflight；纯 route 同样拒绝 accepted/unknown-submission/completed 的重选。

status/result/cancel/recover 逐次验证调用上下文和外部 handle。另一项目、同项目另一任务、另一工具或版本不能混用；外部身份不能绑定给第二个执行。工具被卸载/替换后旧会话也拒绝继续使用。

宿主可信 ingestion 调用 issueOutput 签发随机句柄；输出记录通过 executionId 关联 project/task/fingerprint/tool，并保存校验后的 MIME、尺寸和视频时长。Adapter 可在内部处理私有地址或临时路径，但必须使用宿主签发的句柄返回公开结果。acceptOutput 支持同步结果；result 对异步结果执行同样检查：对应 Capability schema、签发归属、元数据一致性及请求尺寸/MIME/数量/时长。路径、URL、格式合法但未签发的字符串都拒绝。没有实现下载、文件暂存或正式 AssetVersion 绑定；非媒体结果的 ingestion 尚未开放。

cancel 区分 cancelled、waiting-stopped、unsupported。等待停止后远端仍可报告 succeeded，但 Broker 不接受其迟到输出。Abort 只停止等待，不隐式 cancel。异常映射至既有 ToolError code；Broker 自身使用固定 reason 消息标识 tool-not-registered、ownership-mismatch 等原因，Adapter 原始异常统一脱敏。

## 下一步边界

所有 Registry、Decision、ownership、output 与提交锁均为内存状态，不提供重启恢复。受信 Adapter 的无副作用承诺由协议与测试保证；本轮没有隔离任意恶意代码的沙盒。07-04 才增加来源持久化与迁移，后续授权/真实 API 步骤完成前，不将本模块接入收费入口。版本仍为 0.6.0，未更改数据库、UI、既有 Provider 或任务调度。
