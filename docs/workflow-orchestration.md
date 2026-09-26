# 07-09 Minimal Workflow Orchestration

仅实现受控代码定义的顺序流程。架构依据为 `platform-architecture.md` 和 `implementation-roadmap-v2.md`；本次按施工要求收敛到单 Shot 的 A、B 两条流程。package 版本保持 0.6.0，SQLite 追加到 v9。

## 责任与数据

`WorkflowRun` 记录一次编排：项目、Shot、工作流类型、状态、当前位置、请求人、冻结输入、结果与错误摘要，以及创建/更新/开始/完成/失败时间。`executionAllowed` 区分本地可执行实例和备份导入的只读历史。

`StepRun` 记录步骤顺序、状态、时间、输入/输出快照、attemptCount、用户决策和关联 ID。`relatedTaskId` / `relatedGenerationRecordId` / `relatedAssetVersionId` / `relatedApprovalId` 引用原生产记录；`relatedReviewId` 指向本步骤 outputSnapshot 中持久化的审核事件 ID。没有另造媒体、费用账本或生成任务。

schema v9 仅新增 `workflow_runs` 和 `step_runs`，使用项目内复合外键、run/step 唯一约束、生成步骤 task 唯一所有权索引。每步本轮最多一次生成尝试，不提供自动重生或失败步骤重提，因此暂不引入路线图中为多次尝试准备的 `step_executions` 表。重新制作须创建新 WorkflowRun；旧失败记录保留。

v1–v8 migration 不变。v8→v9 测试检查旧项目、任务、远端 ID、媒体完全保留；追加 DDL 失败整体回滚。JSON 读取经过 Zod 与编排一致性校验，畸形顺序、跨项目关联、任务/来源不匹配或缺少审核事件时拒绝推进。

## 定义与执行

| 工作流 | 步骤 |
| --- | --- |
| Shot Keyframe | prepare → generate-image → review-image → adopt-image → complete |
| Shot Video | prepare → generate-video → review-video → adopt-video → complete |

视频支持现有 text-to-video 和 image-to-video 服务；图生视频显式选择项目内受控输入版本。关键帧限定一张输出。可选的 Keyframe then Video 留待后续，当前可先完成关键帧流程，再把已采用版本作为视频流程的输入。

- `workflow/workflow-definitions.ts`：冻结受控定义、目标类型、恢复策略、可取消与需人工操作步骤。
- `workflow/repository.ts`：SQLite CRUD、乐观 revision 检查、快照与关联一致性校验。
- `workflow/runner.ts`：顺序推进、等待人工、恢复关联任务、终止后续步骤；进程内同一 run 串行。
- `workflow/service.ts`：创建、查询、列表、恢复、取消、用户决定入口。

Runner 只调用 ImageGenerationService、VideoApiGenerationService 和既有 Review/Adopt 服务，不直接引用或调用 Adapter。它不新增底层任务队列，也不接管旧批次或旧 Provider 任务。

## 人工确认与事务边界

创建流程先校验 Shot，随后调用既有服务生成 PromptPackage、RoutingDecision、Estimate 和预览。生成步骤进入 `waiting-user`，此时没有 submit、Approval 或 Reservation。用户查看工具、模型、描述、尺寸、费用、上传说明后，以 `confirm-generation` 决策确认预算与未知费用政策。

生成服务新增仅主进程可用的 `onPrepared` 回调：Approval、Reservation、AITask、GenerationRecord 和 StepRun 关联在**同一个 SQLite 事务**中保存。回调失败时全部回滚，外部请求尚未发出。网络执行仍由原生成服务完成；重复确认受 revision、已消费预览和关联任务防护，不再创建任务。

成功入库后步骤关联 Candidate AssetVersion，`review-*` 和 WorkflowRun 均为 `waiting-user`，Runner 停止。用户 `approve-candidate` 只批准候选，进入独立 `adopt-*` 等待；`adopt-candidate` 才更新 Shot 的精确关键帧/视频版本绑定。审核/采用调用与决策事件、步骤状态写入同一事务，失败不会留下“已绑定却没有用户决定”的状态。

`reject-candidate` 通过既有审核服务拒绝版本，将流程和审核步骤置为 failed，错误码 `stopped-by-user`；不自动重生。版本 revision、Shot revision、run revision 都必须匹配。`resumeWorkflowRun` 不等同于批准或采用。

## 重启与恢复

应用主进程装配服务后扫描未完成实例：

1. 尚未确认生成：只重建预检/预览，旧预览不可执行；用户必须重新确认。
2. 已有 task/record：只查询、等待或恢复既有任务，绝不重新调用 confirm/submit，不重新选择工具。
3. 视频已接受：复用 VideoApiGenerationService 的既有远端 ID status/result 恢复。
4. 图片已接受：ImageGenerationService 增加受控 query-only recover；支持的 ComfyUI adapter 恢复既有 prompt_id 的输出授权，检查原工具、模型与模板版本，再读取 history/result 并走原解码、hash、存储、候选提交路径。
5. 同步图片服务没有可恢复远端 ID，或提交结果不明：保持原任务/费用审计，不自动重提。失败反映在生成步骤。
6. 候选已经存在：直接进入/保持审核；已有审核决定继续到采用等待，不再生成。

测试以远端接受后、结果入库前的真实 SQLite 快照重建 DB/服务，覆盖本地图片 fixture 与异步视频 fixture；两者累计 submit 均为 1。此处是受控 HTTP fixture 验证，不是新一次 ComfyUI 或付费视频实测；07-08.5 的真实验收记录仍保持原样。

取消采用最小语义：停止未开始的后续步骤，WorkflowRun 为 cancelled。已经 accepted 的底层任务、费用与后续输出仍保留，不声称取消远端执行，不自动释放预算，也不会自动审核/采用其输出。

## UI / IPC

沿用现有“生成”页面与输入表单，增加“创建 Shot 关键帧工作流（单图）”“创建 Shot 视频工作流”。同页“制作工作流”区域展示历史、当前步骤、费用确认、候选图片/视频、审核、采用、恢复与取消。

现有安全 preload request 通道新增 `workflow` action，命令仅有 createWorkflowRun、getWorkflowRun、listWorkflowRuns、resumeWorkflowRun、cancelWorkflowRun、submitWorkflowUserDecision。沿用 sender 校验，命令为 Zod strictObject；renderer 不能写 StepRun 或指定下一步骤/状态，不能直接访问数据库或凭据。

## 备份与兼容

备份 manifest format 4/schema 9 包含两张编排表；format 1–3（schema 6–8）继续可读。恢复到新项目重映射 run、step、task、record、approval、目标与版本 ID，保留审核历史；`executionAllowed=false` 且旧费用授权仍为 historical，恢复流程无法生成、审核或采用。备份历史不能变成第二次付费授权。

本轮不包含节点编辑器、Canvas、DAG、任意脚本、插件/Skill 市场、Blender、分布式调度、最终剪辑时间线或自动重生。07-10 继续检查新旧任务入口、来源展示和供应商真实验证状态，不把 fixture 通过宣称为生产 Provider 已验证。

## 本轮验证结果

新增 28 项单元测试和 1 项 Electron 桌面测试。`npm run typecheck`、`npm run lint`、`npm run build` 通过；`npm run test:unit` 368/368、`npm run test:smoke` 9/9 通过。覆盖费用确认、独立审核/采用、拒绝、取消、原子回滚、重复确认、畸形恢复、图片/视频接受后恢复、schema v9、旧备份兼容与恢复历史禁止执行。没有新增真实付费或本机生成请求。
