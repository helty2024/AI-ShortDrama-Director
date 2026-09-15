# 07-04：Generation Provenance Persistence

依据 Architecture Baseline v2 与 Implementation Roadmap v2。数据库从实际最高 v6 追加到 **v7**，应用版本保持 0.6.0。本轮未连接真实工具或新增 UI/IPC，没有 Approval、WorkflowRun 或 StepRun 表。

## 表与关系

| 表 | 内容与约束 |
| --- | --- |
| routing_decisions | 不可变路由、工具/模型、策略、候选证据及排除原因；workflow/step 引用必须为空 |
| generation_estimates | 不可变费用/耗时/指纹/有效期快照；工具与模型由不可变 Decision 引用确定 |
| prompt_packages | 目标、结构化语义输入、现有 Compiler 输出、编译器与可选 Skill 版本；不可变 |
| generation_records | 一次实际尝试的输入快照与执行结局；任务唯一，保留父尝试和 retry/regenerate 类型 |
| task_generation_links | Task 与 Record 一对一；双向延迟外键要求事务提交后关联完整 |
| generation_outputs | Record → 0:N AssetVersion，保存 outputIndex/role/时间；版本不能同时归属另一生成尝试 |
| import_provenance | 独立导入来源，一条关联一个导入版本；名称只保留 basename、MIME、hash 和来源说明 |

表使用经过 Zod 校验的 JSON 快照，身份和外键列由 JSON 生成，避免普通列与 JSON 各自更新。projectId + id 复合外键、任务/输出唯一约束与 Repository 检查共同保证隔离。成本以整数微单位存储；unknown 没有伪造金额字段。GenerationRecord 中的 outputAssetVersionIds 仅为读取时从 generation_outputs 派生的兼容投影，数据库输入 JSON 不保存该数组。

## 主进程 API

`generation/repository.ts` 提供按表 create/get/list、recordAttempt、getRecord、findByTask、history、outputs、attachOutputs、finish、supplement 和 validateProject。所有 DB JSON 读取重新通过对应 Zod schema；坏快照返回 DomainError，而不是继续向业务层传递原始 JSON。SQL 不集中塞回 database.ts。

`generation/service.ts` 协调领域规则。capturePrompt 包装现有图像 Prompt Compiler，并保存目标与上下文；Repository 同时接受现有视频 Compiler 的类型化输出快照。本轮不改变 Compiler 行为，也没有新增 Prompt 编译算法。

createAttempt 可在同一事务建立新 AITask、GenerationRecord 和 link；recordAttempt 可以关联已经由主进程创建的 Task。检查目标、源 revision、输入素材版本、Decision、Estimate、Prompt、工具/模型和请求指纹。新路径 Task 不存在时拒绝；旧 Task 没有关联则 findByTask 返回 null，不补造来源。

完成事务同时写入 Record 结局、输出关联及 AITask 最终状态/resultIds。一个输出失败会使此前插入的输出、结局和任务更新一起回滚。失败、取消、unknown-submission、malformed-output 等保留零输出记录。成功后显式追加输出时同步任务结果引用。结局用于审计，不驱动 polling、排队或重试；AITask 仍是执行状态来源。

## 不可变与补齐

Decision、Estimate、Prompt 创建后不提供更新接口，数据库也禁止 UPDATE。Record 的来源、目标、参数、工具、模型、seed、Prompt/路由/估价引用通过触发器冻结。重新估价或重新生成建立新快照/Task/Record，不能覆盖历史尝试。

Record 允许补齐开始/完成时间、实际耗时、费用状态和结局。supplement 支持首次补齐开始时间，以及完成后晚到的实际费用；已知费用不能再次改写。已终结尝试不能重新 finish；unknown/unknown-submission 可在后续获得确切结局时补齐。approvalId 在本阶段严格为空，不表示获得费用授权。

来源行不允许单独删除。被输出、导入或输入快照引用的版本不能单独删除；项目整体删除时由 project 级联清理全部来源和媒体登记关系。文件系统 staging/补偿/孤儿清理仍沿用现有模块，没有 SQLite + 文件系统跨系统事务承诺。

## 迁移与 legacy

v1–v6 migration 保持原样。v7 在建表前验证旧 Project/Entity/AssetVersion/AITask 的 schema、行身份与现有外键，异常时拒绝升级；v7 的新增 DDL 和 user_version 在同一事务中提交。测试通过发布的 v1–v6 迁移生成真实 v6 schema，验证所有旧行、providerTaskId、revision 和已确认绑定不变；中途 DDL 冲突完全回滚，重复启动不重写数据，未知高版本拒绝打开。

升级不向新表插入历史数据。没有证据的旧素材保持 legacy provenance unknown；既不猜测工具/模型，也不伪装成导入来源。unknown-submission 已验证可以关闭并重开数据库后原样查询，但本轮没有实现远端任务恢复。

## 备份与恢复

新备份 manifest 为 **format 2 / schema 7**，包含七张来源表及已有项目数据。恢复器仍支持 **format 1 / schema 6**；旧程序的严格 format/schema 校验会拒绝新版备份，避免静默丢弃来源。

恢复成新项目时，项目、目标、任务、Record、父 Record、Decision、Estimate、Prompt、输入/输出版本及 JSON 中的来源 ID 都按统一 UUID 映射转换。延迟外键与 validateProject 在目标事务中再次验证。篡改来源引用导致回滚，并清理已复制的目标媒体。

费用授权不恢复：publicCopy 清空 approvalId、凭据引用，现有恢复器清空远端任务身份。历史 requestFingerprint 保留作原始审计摘要；它不是恢复项目的新请求凭证，不能重新执行旧意图或费用授权。恢复后的来源快照不应直接拿来调用 recordAttempt，新的执行须重新编译/预检。

## 验证与后续

新增 21 项测试覆盖快照不可变、已知/未知估价、0/1/4 输出、失败保留、重试链、跨项目拒绝、事务回滚、费用补记、真实 v6 升级、新旧备份和重启后的未知提交历史。完整运行 `npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run build`、`npm run test:smoke`。

07-05 才实现费用授权、预留及消费，不能把本轮审计记录当成授权。Registry、Adapter、Broker 活跃 ownership 和临时 output issuer 仍在内存；真正提交与远端恢复留给后续 API/Executor 接入。没有新增 renderer 写入来源的接口，也没有替换旧生产流程。
