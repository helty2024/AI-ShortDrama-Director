# Implementation Roadmap v2

状态：Approved for implementation · 2026-09-13。

唯一架构依据：[Architecture Baseline v2](platform-architecture.md)。目标是从当前 0.6.0 渐进迁移；本文件不再讨论产品定位。本轮只规划，不实施下列代码、迁移、UI 或工具变更。旧 tool-protocol-phase-a.md 草案被本路线取代，不作为并行施工计划。

## 1. 当前基线与保留比例

检查基线：0.6.0，现有发布提交 e482bea2e42e3030ad71db87c976b9746816967f；数据库迁移到 v6。真实接口是否可用必须单独验收，现有 Mock 和协议测试不是供应商生产验收。

以下按 12 个责任模块统计，互斥分类：6 个直接保留、4 个保留主体并桥接、2 个重点重构。直接保留为 50%；计入桥接后主体沿用为 10/12，约 83%。这是**模块分类比例，不是代码行复用率、工作量比例或零改动承诺**。重点重构的队列和路由也保留历史数据兼容及测试，不能理解为整块删除。

| 编号/当前责任模块 | 当前文件/目录 | 分类 | 迁移处理 |
| --- | --- | --- | --- |
| 1 领域与 SQLite | src/shared/domain.ts；electron/main/database.ts、seed.ts | 直接保留 | 保留 ID、对象关系、CRUD、revision；未来仅追加迁移入口 |
| 2 媒体与凭据 | visual/storage.ts、visual/repository.ts；media-broker.ts；video/credentials.ts、ffmpeg.ts（均在 electron/main） | 直接保留 | 复用存储、受控播放、系统加密及 FFmpeg 调用；新增来源关联由核心负责 |
| 3 剧本与领域智能 | electron/main/intelligence/parser.ts、review.ts、service.ts、prompts.ts；visual/prompt-compiler.ts；video/compiler.ts | 直接保留 | 保留解析、人工确认和编译规则；逐步登记 PromptPackage 版本 |
| 4 连续性与 QC | electron/main/production/continuity.ts、qc.ts、status.ts | 直接保留 | 保持绑定具体版本与严格/建议审核，不把 Mock QC 变成真实视觉检测 |
| 5 现有 React 编辑器与状态 | src/App.tsx；src/features/{workspace,script,visual,video,production,operations} | 直接保留 | 0.7 仅为工具流程增加必要入口；六阶段全面重构在 0.8 |
| 6 桌面构建与现有测试 | electron-builder.yml、scripts/、tests/unit/、tests/electron.spec.ts | 直接保留 | 保留打包身份、安全基线和回归样例；追加测试，不删除旧测试让新协议通过 |
| 7 主进程装配与 IPC | electron/main/index.ts、ipc.ts；electron/preload/；src/shared/api.ts、desktop.ts | 桥接 | 增量注入工具服务，新增窄 action，保留旧 action 与安全校验 |
| 8 公开 schema/客户端 | src/shared/{intelligence,visual,video,production,operations}.ts；src/services/ | 桥接 | 保留既有业务 schema；新增独立 Capability、工具和来源契约，不合并成万能请求 |
| 9 Provider 与业务提交服务 | electron/main/intelligence/{provider,mock-provider}.ts；visual/{providers,service,workflows,diagnostics}.ts；video/{providers,service}.ts | 桥接 | 旧 Provider 外包 adapter；新 API 经工具路径提交，业务服务仍负责目标范围和候选审核 |
| 10 生产操作与备份 | electron/main/production/service.ts；operations/{service,backup}.ts | 桥接 | 旧批次/付费预览转向统一授权；同步备份表、脱敏和 ID 重映射 |
| 11 执行调度 | electron/main/intelligence/queue.ts、repository.ts；visual/executor.ts；video/executor.ts | 重构 | 抽离 Provider 选择到 Broker，保留唯一 AITask 调度器和既有远端回执恢复 |
| 12 路由与费用预览 | electron/main/production/router.ts | 重构 | 从 VideoProfile 特定推荐改为 RoutingPolicy；原有币种分组等纯函数可复用 |

所有 electron/main 下已发布 migration.ts 直接冻结保留，不纳入可淘汰代码。当前画像：图片 executor 在工厂中选择 Mock/ComfyUI，video executor 使用 VideoFactory，queue 构造时恢复部分 running，production/router.ts 面向 VideoProfile，operations/backup.ts 使用显式表清单。这些是需要桥接的实际耦合点。

## 2. 新增文件与责任（均为计划）

| 计划位置 | 责任 |
| --- | --- |
| src/shared/tools.ts | 生命周期描述/结果、执行上下文、错误；不含 UniversalToolRequest |
| src/shared/capabilities/{text,image,video,scene,media}.ts | 按业务能力独立定义输入输出、版本和限制；首期只实现 text/image/video 需要的部分 |
| src/shared/routing.ts | RoutingPolicy、不可变 RoutingDecision、候选排除理由 |
| src/shared/generation.ts | Estimate、GenerationApproval、GenerationRecord、Import Provenance |
| electron/main/tools/protocol.ts、registry.ts | 接口及受信 adapter 注册，不扫描执行任意插件目录 |
| electron/main/tools/broker.ts | 输入授权、预检调用、提交边界、输出校验与规范化错误 |
| electron/main/tools/routing.ts | 纯决策，不执行工具或获取凭据 |
| electron/main/tools/adapters/{legacy-text,legacy-image,legacy-video,image-api,video-api,comfyui}.ts | Provider 桥接与新工具接入；具体供应商在接入任务开始时确定 |
| electron/main/generation/{service,repository,approval}.ts | 核心来源记录、费用预检和原子预算预留 |
| electron/main/workflows/{repository,service}.ts | 最小 WorkflowRun/StepRun，关联 AITask，不建第二个 scheduler |
| electron/main/platform/migrations/{v7,v8,v9}.ts | 依次追加迁移；最终编号以施工时最高已发布版本为准 |
| electron/main/tools/runtime.ts | 后期可信本地工具启动、就绪、退出、日志、资源占用 |
| tests/unit/{tools,routing,generation,platform-migration}.test.ts | 契约、路由、权限、追踪、迁移和事务测试 |
| tests/fixtures/tools/ | 模拟同步 Image API 和异步 Video API 的本地服务与异常样例 |

PromptPackage 先用现有编译器产出快照，不在 0.7 同时建设 Skill 市场。Blender adapter 在 0.9，Canvas 在 0.8 可选，任意第三方插件加载不进入本清单的首期实现。

## 3. Provider → ToolAdapter 桥接策略

1. 为旧 Provider 定义 adapter 包装层，保留原协议实现、错误处理、媒体解析和回执。不得仅用名称把供应商判定为健康。
2. 新平台使用 Capability Contract；包装层把通过 schema 校验的输入转换为旧 Provider 输入。供应商参数和 Comfy graph 留在 adapter 内，不进入所有能力的公共必填字段。
3. 当前文本 generateStructured、图像 generate、视频 submit/status/result 分别转换到统一生命周期；同步结果可直接返回完成句柄，异步任务返回外部 ID。不支持 cancel/recover/estimate 必须返回明确不支持/unknown。
4. 旧 AITask 仍按旧版本输入读取。新任务带明确的协议/能力版本、工具版本及 GenerationRecord 关联。迁移期间以主进程内部开关按能力切换，不双重提交，同一任务只能有一个执行所有者。
5. 新 API 验证顺序为 Image API → Video API。之后再将 ComfyUI 实际执行入口迁到新 Broker；提前保留 legacy 包装层不算先用 ComfyUI 定义协议。
6. 每个 adapter 都验证 validate/estimate 无生成副作用，预检不静默上传素材。真实供应商选择后核对官方请求/响应及费用语义；真实付费生成单独授权。
7. UI 固定工具选项映射到 RoutingPolicy；不再在 UI 或业务服务里用 Provider 字符串直接选择执行器。Simple Mode 可查看决策依据，Advanced 固定工具不能静默回退。

## 4. 任务、步骤和来源的数据关系

- WorkflowRun 1:N StepRun；StepRun 通过执行关联表连接多个历史尝试，不覆盖失败任务。
- 新路径每次实际执行尝试对应一个 AITask 和一个 GenerationRecord；一个 StepRun 可串行产生多次尝试。独立生成可以没有 WorkflowRun/StepRun。
- GenerationRecord 引用 RoutingDecision、Estimate、可选 GenerationApproval、PromptPackage、目标对象、输入版本；一个记录对应 0:N 输出 AssetVersion。
- 文本结果用独立类型化 Draft 引用；不为其创建虚假媒体。
- status/poll/recover/download 只更新同一执行尝试；实际重提产生新 task/record，并填写 parentGenerationRecordId 和 attemptType。
- 旧 AITask 内的 attempt 字段原样保留。旧素材不能恢复的历史信息标为 legacy，不反向制造 GenerationRecord 或付费授权。
- 导入流程只写 Import Provenance；GenerationRecord 不混入 import 类型。
- StepRun 管编排位置；AITask 管执行；GenerationRecord 管来源。GenerationRecord.outcome 由执行结果归档，不驱动调度。

提交意图、预算预留、任务和记录在本地事务内建立后才进行外部 submit；远端回执保留现有“提交不明不能重试”的保护。成功时版本关联、结果摘要及任务成功状态同一数据库事务提交，媒体暂存/补偿处理跨文件系统故障。

## 5. 数据库追加 migration 计划

现有 v1–v6 不修改。数据库 schema 版本独立于 package version；0.7.0 不代表 schema=7。下列是尚未运行的追加计划，不包含本轮数据库写入。

| 计划迁移 | 新增内容 | 门槛 |
| --- | --- | --- |
| v7 预检与来源 | routing_decisions、generation_estimates、prompt_packages、generation_records、generation_outputs、import_provenance、task_generation_links | 明确项目归属、版本 schema、索引；旧媒体仍可读，不伪造历史来源 |
| v8 费用授权 | generation_approvals、approval_items、approval_reservations，以及批次路由/估算汇总快照 | 原子预留/释放、单币种上限、批次清单指纹、未知提交保留额度 |
| v9 最小编排 | workflow_runs、step_runs、step_executions | 步骤与任务单一所有权，重试追加关联；不重复现有 production_batches 的镜头清单 |

v7 的新记录暂只在隔离测试中启用；付费工具产品入口必须等 v8 授权门槛通过才开放。v9 的最小编排不等于通用工作流编辑器。若施工前其他兼容修复已占用编号，从新的最高版本继续追加，不改已发布编号。

结构约束：

- ID 稳定唯一，所有持久对象有 createdAt/updatedAt；不可变快照的 updatedAt 不用于更改内容。
- 所有项目内关联按 projectId + id 校验，增加所需复合唯一索引与外键；不能只靠 UUID 存在性。旧 JSON 数据的结构先验证，再建约束，遇到异常回滚并保留原库。
- generation_records.taskId 在新路径唯一；输出用关联表保持多输出和跨项目限制，避免同时维护两个可分叉的事实来源。
- 因循环关系，决策中的 workflow/step 引用在 v9 前允许为空或使用独立关联表，不能让 v7 依赖尚不存在的表。生成记录 task/输出关联可分阶段插入，但事务后必须完整。
- 输入素材版本引用需防删除破坏追踪，默认在项目内保留被引用版本；整个项目删除仍走核心现有取消任务与级联逻辑。
- 请求指纹、路由和估算快照冻结；重新路由/估算建立新行。费用补齐和额度消费有独立记录，不能修改已签批范围。

每个迁移测试：真实 v6 fixture 升级、重复启动不重复写、未知高版本拒绝、失败回滚、旧 UUID/revision/素材绑定/远端 task ID 不变，以及新表项目隔离。SQLite 中没发生的生成不补造历史数据。

## 6. 备份与恢复必须一起迁移

修改计划位置：electron/main/operations/backup.ts 的表清单、schema 校验、publicCopy 和 ID 重映射；operations/service.ts 的诊断摘要；相应 operations.test.ts。

备份包含可审计的路由、估算、来源、Prompt 快照及已采用/候选媒体。可执行的费用授权和预留不得在恢复项目中继续生效：保留必要的脱敏历史摘要，标记历史授权不可执行，清除恢复能力和凭据权限。重映射 project、target、task、record、decision、estimate、prompt、step 和 asset version 引用，不能只重映射媒体。

恢复为新项目不自动恢复付费任务或云端提交；显式核对后再操作。新格式加 manifest schema 版本；旧备份继续可读，旧程序遇到新格式应明确拒绝。未完成备份/恢复测试不得发布对应数据库迁移。

## 7. 0.7.0 施工顺序与验收

| 步骤 | 具体文件/工作 | 完成门槛 |
| --- | --- | --- |
| 07-01 契约 | shared/tools.ts、capabilities/、routing.ts、generation.ts；tools/protocol.ts | 生命周期九动作；能力输入输出独立；拒绝万能请求、非法参数、负金额/倒置范围；unknown 不当免费 |
| 07-02 模拟契约 | tests/fixtures/tools/ 与 tools.test.ts | 本地模拟同步图片、异步视频；validate/estimate 的 submit 计数为零；覆盖取消、不支持恢复、畸形响应、外部提交不明 |
| 07-03 路由预检 | tools/{routing,registry,broker}.ts + routing.test.ts | Policy 不联网/执行；资源和隐私先过滤；固定不回退；RoutingDecision 不可变；输入/决策变化和估价过期失效 |
| 07-04 来源持久化 | generation/{repository,service}.ts、v7、database.ts 迁移调用、backup.ts | task/record/多输出正确关联，失败记录保留，Import Provenance 独立，旧库/备份升级通过 |
| 07-05 授权 | generation/approval.ts、v8、最窄 IPC 与现有生成入口 | 单次及批次预算原子预留；并发不超额；旧授权失效；未知提交不释放；恢复备份不复活授权 |
| 07-06 Image API | adapters/image-api.ts、现有 visual/service.ts / executor.ts 桥接 | 经完整预检和授权 → 图像候选 → 人工采用 → 来源可查；模拟全覆盖，真实付费验收另授权 |
| 07-07 Video API | adapters/video-api.ts、video/executor.ts、queue.ts 桥接 | 长任务轮询/取消/恢复；保留 intent 回执；不明提交不重提不切服务；真实付费验收另授权 |
| 07-08 ComfyUI | adapters/comfyui.ts、runtime.ts、现有 workflows/diagnostics 桥接 | 同一能力由 API/本地工具分别执行，缺模型阻塞该能力，不能终止外部服务，不改 Capability 核心定义 |
| 07-09 最小编排 | workflows/{service,repository}.ts、v9、旧批次 service 桥接 | 一个场次多镜头，步骤关联任务，人工采用才正式绑定；失败定位和已知任务恢复；唯一 scheduler |
| 07-10 兼容收口 | ipc/index、services/、现有任务/结果页必要入口、文档及测试 | 老项目和老任务可读；新生产记录可查；完整回归通过；尚未真实验收的 adapter 不标 Ready |

07-01 至 07-03 是 **0.7.0 第一阶段**：仅契约、模拟工具、路由与预检。无数据库迁移、无真实收费请求、无全局 UI 重构。07-04 后才进入持久化；07-05 完成前不开放新付费提交。每步独立 Conventional Commit，可单独审查及关闭新能力。

07-06/07-07 的供应商协议核对和付费测试分别管理：没有用户付费授权时，可完成代码/模拟测试，但真实验收保持未完成，不绕过顺序用 ComfyUI 冒充 API 验证。07-08 的本地工作流也需真实素材测试，不以连接成功替代生成验收。

验证命令：每个业务增量执行 typecheck、lint、test:unit、build；涉及窗口、IPC、preload、启动流程和端到端入口时执行 test:smoke。新业务测试覆盖行为而非仅镜像 schema。发布打包在后续明确发布任务中执行，本轮不打包。

## 8. 逐步淘汰及退出条件

| 旧路径 | 淘汰条件 | 保留内容 |
| --- | --- | --- |
| visual/executor.ts 内 Provider 二选一工厂、index.ts 内 VideoFactory 分支 | 新 adapter 覆盖各输入/取消/恢复测试且真实验收通过 | 旧 Provider 作为 legacy 包装实现，直到旧任务读路径无需它 |
| production/router.ts 的 VideoProfile 专用推荐入口 | RoutingPolicy 在所有新提交入口生效 | 已验证成本聚合纯函数、历史费用展示 |
| operations/service.ts 和 production/service.ts 各自的旧付费预览提交入口 | GenerationApproval 覆盖单次/批次、并发和过期测试 | 历史预览/回执只读及不明提交核对能力 |
| 新任务沿用旧 attempt 就地覆盖的路径 | 一次实际尝试一 task/record 已全覆盖 | 旧 task JSON schema 和历史 attempt 读取 |
| ProviderSettingsPage / ProductionSettings 的重复工具选择入口 | 0.8 Creator UI 完成并通过任务流程回归 | 旧设置到新 RoutingPolicy 的兼容映射 |

不在 0.7 批量删除旧模块。旧库、远端任务恢复、用户确认的视频和已经发布的 migration 永久不作为“清理冗余”删除。新旧路径同时存在期间严禁同时执行同一请求。

## 9. 风险与回滚策略

| 风险 | 防护与回滚 |
| --- | --- |
| Provider 参数泄漏到公共协议 | 以两种不同业务 fixture 审核 Capability；不通过则回退该契约变更，不迫使领域层兼容供应商字段 |
| 跨服务重试重复收费 | intent/外部 ID/授权预留持久化；未知提交人工核对；关闭新路由不能触发旧执行器自动接管 |
| 升级后旧任务重复运行 | 每个任务固定执行路径/工具版本；重启按已保存身份恢复，不根据当前默认工具重新选路由 |
| 估价和预算并发竞争 | 预留与任务创建同事务，过期再估算/再授权；未知实际费用保持 pending |
| 主进程加载不可信代码 | 只注册审查过的 adapter；强隔离未实现前不承诺安全沙盒，不开放任意安装 |
| 数据迁移或备份遗漏 | v6 fixture 与新表重映射测试；升级前关闭应用备份数据库及全部媒体，凭据按既有安全策略保存 |
| 老 UI 阻碍新架构验证 | 仅增加最小工具/费用/来源入口，六阶段 UI 延后 0.8；不同时重做画布 |
| 工具依赖缺失/显存不足 | health 与资源门槛，单能力禁用；仅清理由自身管理的进程和临时文件 |

代码回退与数据库回退分开：新 schema 上可通过配置停用新工具路径，但只能运行能读该 schema 的版本。不得直接让 0.6.0 打开 v7+，也不写破坏性的 down migration。需要退回旧二进制时必须在停止全部任务后恢复升级前完整备份；先另存升级后数据与回执，明确恢复会舍弃备份之后新增数据，不覆盖原数据目录进行盲目回滚。

已提交云端任务必须先核对或保留回执；恢复旧备份不能让它被当成未提交而再次执行。普通关闭新功能开关不更改历史记录和正式素材绑定。

## 10. 后续版本门槛

- 0.6.x：本架构冻结及必要兼容修复，不增加工具平台宣称。
- 0.7.0：完成上表基础架构，明确真实工具验证状态；API 与 ComfyUI 不共享未经验证的万能参数。
- 0.8.0：在保留的编辑器基础上改 Creator UI 六阶段；生成描述折叠、完整 Prompt 仅 Advanced；Canvas 可选且仅保存视图状态。
- 0.9.0：加入 Blender 最小 previz/render adapter，以及多个 Image/Video Tool；验证本地进程和云 API 真正可替换。
- 0.9.5：一个项目/一个场次/多个镜头真实生产验证，覆盖质量、耗时、费用、失败恢复、审核与来源查询。
- 1.0.0：达到稳定发布验收后再定版本；不会因为代码已合并就自动达到稳定。

仍冻结插件市场、任意第三方 UI、通用节点编辑器、分布式调度、微服务拆分、自动下载全部模型、剪辑时间线、字幕/BGM/混音及最终成片。本轮只提交两份定稿文档和必要索引，不执行任何上述施工。
