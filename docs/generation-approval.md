# Generation Approval 与 Budget Reservation（07-05）

本步骤仅实现主进程私有授权与预算服务。数据库 schema 为 **8**，应用 package version 仍为 **0.6.0**。没有真实 API 请求、新 UI、授权 IPC 或安装包变更。

## 六个独立步骤

1. `validate` 检查能力、输入、依赖，不授予付费权限。
2. `estimate` 产生有有效期、币种和已知/未知费用的不可变报价，不授予付费权限。
3. `createApproval` 接收独立的 `confirmed: true` 用户确认命令，冻结范围、成员、上限和引用。该字段是受信主进程调用约定，不是可以发给任意 renderer 的权限凭据。
4. `prepareAfterPreflight` 验证 07-03 Broker 的实际预检 token、当前注册实例及请求，再进入 `BEGIN IMMEDIATE`：检查授权 → reserve → 新建 AITask → 新建 GenerationRecord/TaskLink。任何一步失败全部回滚。低层 `prepare` 用于受信本地事务与隔离测试，不替代未来 Adapter 的最后一次 health/validate。
5. `markSubmissionIntent` 再次检查授权与报价，持久化可能收费的边界，然后未来 Adapter 才可以 submit。此步骤不调用供应商。进入该状态后进程崩溃也不能假定请求未发送。
6. `consume` 接受明确的实际费用与账单说明，原子更新账本及 GenerationRecord.actualCost/costStatus。

未来 Runtime 在网络提交前必须保持 Broker/注册版本检查与此授权链同时成立；任何重新报价或重路由都需要对应的新授权。当前没有实现恢复后自动提交。

## 数据结构与边界

`src/shared/approval.ts` 集中定义严格 Zod schema；`generation/approval.ts` 实现规则；`approval-repository.ts` 封装 SQL；`approval-binding.ts` 防止直接从来源 Repository 绕过预算绑定；`approval-history.ts` 处理无执行权限的备份副本。

| 表 | 内容 |
| --- | --- |
| generation_approvals | project、single/batch、单币种、整数 maxAuthorizedCostMicro、冻结 itemIds、单次 requestFingerprint 或 batchFingerprint、批准/到期/失效时间与原因 |
| approval_items | target/type、request fingerprint、decision/estimate、PromptPackage、tool/version/model、source revisions、输入 AssetVersion、明确的单项 ceiling、是否允许未知估价 |
| approval_reservations | approval/item/record/task、固定 reservedAmountMicro、状态、提交意图时间、实际金额、消费/释放时间、billing evidence、历史原状态 |

Reservation 同时是唯一消费账本，不增加重复的 consumption 表。未知 actualAmountMicro 必须是 null；不会以 0 代替。ID 与项目范围有复合外键约束；Record 与 Reservation/TaskLink 使用延迟外键绑定，在一次事务内完成。每次重提使用新 task 和 record，保留父记录；旧预算已经释放且 item/estimate 仍有效时才能重新使用该 item。

Approval 创建后的范围、金额与成员不可修改，active 只能失效为 invalid，不能重新激活；Item 不可修改。Reservation 金额及所有绑定不可修改，状态仅沿允许的路径变化。GenerationRecord.approvalId 只在创建时绑定，不能后来换授权。直接来源费用更新必须与同一 Reservation 的实际费用一致。

## 单次与批次预算

单次也是一个冻结 Item。`assertApprovalCurrent` 检查 project、status/expiry、成员、fingerprint、PromptPackage、source revisions/input versions、decision、estimate ID/expiry、tool/version/model、currency 和额度。输入、提示词、估价、路由或模型改变都不能继续使用旧授权。

批次采用 **总池 + item 累计上限**。新增 Shot/请求不能追加进旧 itemIds；已有成员不能偷偷提高 ceiling。各 item ceiling 之和可以超过总池，但实际并发预留绝不超过总池。已知估价不得超过明确的 item ceiling，预留该 ceiling；未知估价默认拒绝，必须明确 `allowUnknownCost` 并指定 ceiling。不同币种必须分开授权，不做汇率换算。

所有金额为安全范围内的整数微单位（例如 1 USD = 1,000,000 micro USD），累计使用 BigInt，避免浮点和累计整数溢出。事务通过 SQLite `BEGIN IMMEDIATE` 抢先获得写锁，读取账本、判断余额和写入预留在同一连接同一事务内，其他连接不能基于旧余额同时写入。

可用额度 = 授权金额 − reserved/submitted/pending-unknown 持有金额 − consumed/requires-review 实际金额。

实际费用超过授权时可用额度可以为负数，用于暴露超额事实；不会伪装为获得了额外授权。测试通过多个独立 Node 进程、独立 SQLite 连接、共同启动屏障验证 100 额度下：60+60 只成功一个；40+60 均成功；50+50 并发成功后额外 1 失败。

## 提交、取消与消费

| 状态/操作 | 预算处理 |
| --- | --- |
| reserved，尚未进入提交区间 | 取消或本地最终校验失败可以释放 |
| submitted | 表示已进入可能收费区间；不等同于供应商确认 accepted，继续持有 |
| pending-unknown | 未知提交结果继续持有；禁止自动释放、重提 |
| 已 accepted 后用户取消 | cancel 成功不证明未收费；继续持有 |
| 有明确未收费证据 | submitted/pending-unknown 可通过 remote-no-charge 释放 |
| consume ≤ reservation | 消费实际金额，差额自动回到可用额度 |
| consume > reservation | 保存真实费用并标记 requires-review / cost-overrun；不自动补充授权，即使总池仍有余额 |
| consumed/released/cancelled-before-submit/requires-review | 终态，不能重新激活或覆盖账单 |

远端未知时，超时只能结束本地等待，不能被当作退款证明。授权过期/失效阻止新 reserve/submit，但不会释放在途预算，也不阻止之后按真实账单结算。人工复核超额费用与追加授权的 UI 不在本轮范围。

`reconcileSubmissionReceipt` 兼容原视频回执 `{state: 'submitting' | 'submitted', id: string | null}`，将已经确认的远端 ID 桥接到现有 `AITask.providerTaskId`。无 ID 的意图记录进入 pending-unknown；已有不同远端 ID 时拒绝替换。它不创建第二套远端任务表，不扫描任意文件，也不触发网络调用。07-06/07-07 Runtime 必须按 task 所有权加载回执后调用；原 video executor 的文件回执流程保持原样。

## 迁移与备份

追加 `approval-migration.ts` v8，不修改已发布 v1–v7。为移除 v7 Record 的 approvalId=null 约束，v8 在事务中重建该表并恢复原索引/触发器与历史数据。仅迁移时在事务外暂时关闭连接外键检查，提交前执行 foreign_key_check，finally 恢复检查；任何 v8 DDL 失败回滚为完整 v7。v6 按 v7、v8 顺序升级。

新备份使用 **format 3 / schema 8**，继续读 format 1/schema 6 与 format 2/schema 7。备份副本即将 Approval/Item/Reservation 转为 historical，保留原 reservation 状态、固定金额、实际消费、时间、证据与引用。原项目的授权与余额不会改变。

恢复时重新映射 project、approval、item、reservation、record、task、decision、estimate、prompt、target 和输入版本 ID；所有授权仍为 historical，所有预留仍为不可执行历史。原指纹保留为原授权摘要，不被重新计算成新的有效权限。历史账本不参与新项目可执行预算；必须创建新授权。凭据继续清除，providerTaskId 清除，不恢复远端轮询或付费权限。

## 错误与测试

复用 DomainError / ToolError，DomainError.message 提供稳定的 reason：approval-required、approval-expired、approval-invalid、estimate-expired、fingerprint-mismatch、routing-mismatch、currency-mismatch、budget-exceeded、item-not-authorized、reservation-conflict、unknown-cost-not-authorized。超额结算必须落库，因此返回 `issue: cost-overrun`，而非抛错回滚后丢失真实收费。

运行 `npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run build`、`npm run test:smoke`。新增测试覆盖独立授权、变更/过期、未知费用、跨进程并发、准备与结算回滚、不可变绑定、重试、回执、真实旧 schema 升级及无权限备份恢复。

## 07-06/07-07 接入前

**当前旧付费入口仍是 legacy path，尚未自动受到新 Approval 约束。** 本轮没有修改 visual executor、video executor、production router 或真实 Provider。不能宣称整个应用已经统一付费授权。

下一步才为新 Image / Video Tool 接入受信用户确认入口、提交前最终 Broker 检查、持久化意图与 Adapter、远端账单证据/核对、输出登记及人工审核。真实付费验证另行取得用户授权。继续禁止 UI 大改、真实 ComfyUI/Blender 集成以及 WorkflowRun/StepRun 的提前实施。
