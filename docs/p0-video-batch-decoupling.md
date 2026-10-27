# P0-2：批量视频模型解耦（2026-10-22）

这是现有 Tool Protocol、Adapter、Broker、队列及 P0-1 执行绑定上的增量修改。没有收费 API 调用，没有修改正式项目数据、seedance-20 实验和成片导出实现。代码保持未提交，供独立审计。

## 消除的业务硬编码

| 原位置 | 原规则 | 现实现 |
| --- | --- | --- |
| `generation/video-batch.ts: prepare` | 查找 CompShare H3、固定 MiniMax-H3 | 提交正式镜头所需能力，适配器提出整批参数，Broker 校验并选择一个整批可用适配器 |
| 同上 | 最少 4 秒、向上取整 | 适配器从声明的支持时长中规划；无法满足则拒绝，绝不静默截短 |
| 同上 | 480P 尺寸表、24fps、7000 字符 | 移至适配器能力配置和输入规划/验证；批量业务没有尺寸表或提示词裁切 |
| `prepare/authorize/tick` | 时长乘 5、PTS 校验 | 适配器返回明确单位、预留报价或 null；业务只分配人工预算并验证冻结单位，实际费用仍由 GenerationRecord 保存 |
| `claim/tick` | H3 全局串行及 H3 未完成记录扫描 | 按冻结服务身份统计持久化槽位与未结束记录，额度来自适配器；dispatching/running/unknown 均占位 |
| `shared/video-batch.ts` | H3/模型 literal、并发 literal、每秒 5 积分公式 | 通用 toolId/model、能力并发范围和总预算/镜头关联校验 |
| `VideoBatchPanel.tsx` | CompShare/H3/480P/5 积分文案 | 显示实际适配器、模型、冻结尺寸/FPS/时长、预算单位与未知费用提示 |

供应商原生内容、首尾帧协议、480P 与 4–30 秒范围、积分规则仍只存在于 H3 适配器/其原生协议模块中，不提升为业务默认值。

## 契约与执行绑定

- `src/shared/video-tool-profile.ts` 增加可选 `batchPolicy`：帧率、提示词上限、并发额度、预算单位、预留报价依据。未声明时不开放批量规划，不猜测额度或价格。
- `VideoApiTool.planBatchInput` 和 `batchReservation` 由适配器提供；共享 lifecycle 给现有范围契约提供实现。商业适配器可覆盖规划与报价，不要求按秒计费。批量业务只读取返回结果。
- `ToolBroker.selectPlan` 在提交前校验同一候选是否覆盖整批所有镜头，沿用既有健康、参数、费用与路由校验。准备只做预检，不能调用 submit。
- 批次保存 P0-1 `ExecutionConfiguration`（服务 UUID/修订、端点、凭据引用、适配器版本与完整能力），以及 configuration hash、输入参数、素材批准版本证据。
- 授权范围指纹涵盖模型/configuration、并发额度、计费单位、输入、源版本、证据、单镜头上限、总预算、调用数与授权期限。授权和每次提交前重验；异步预检后重读持久化批次。
- 每个真实任务继续由 P0-1 在确认事务内创建不可变 execution binding、费用预留和 GenerationRecord；批次 row 的 taskId/recordId 与该事务一起写入。
- 切换当前配置后，已接受任务只能按原绑定查询/下载；未提交任务不能改用新配置或继承旧预算，必须重新准备、另行授权。
- unknown 不自动重发、不释放其占用槽位；本轮没有重试、供应商切换或收费执行。

## 参考审批门禁

叙事生产仍独立于供应商要求：本项目正式镜头、角色唯一已采用主参考、场次与镜头一致的地点 UUID、地点唯一已采用主参考、镜头已批准关键帧。版本必须属于本项目、批准且为主版本，文件 hash 必须匹配；执行前重验，撤销或版本变化阻断。多参考素材不能冒充首尾帧；不兼容模式由 Schema/适配器拒绝。

独立文生视频技术测试保持单独用途，不能作为人物一致性或商业叙事成片质量通过证据。

## 本地适配器证据

`tests/unit/video-batch.test.ts` 使用两个仅监听 loopback 的协议服务，视频由本地 FFmpeg 制作，不是供应商生成成功证明。

| 能力 | H3 本地协议适配器 | Reference Video 本地协议适配器 |
| --- | --- | --- |
| 同一正式时长需求 | 1 秒需求规划成支持的 4 秒 | 支持 1 秒 |
| 尺寸 / 帧率 | 480×480 / 24 | 32×32 / 12 |
| 首尾帧 | 支持 | 首帧支持、尾帧拒绝 |
| 提示词上限 | 7000 | 12000 |
| 持久化并发槽 | 1 | 2 |
| 预算 | PTS，适配器给出预留依据；人民币未知 | USD，预留报价 null，由人工给预算；本地协议返回结构化测试费用 |

专项用例覆盖：

1. 两个适配器各自执行同一准备→授权→入队→已知任务恢复→下载入库→UUID 关联流程，重启不增加 POST。
2. Broker 同时看到两个候选时，长提示词选择支持的适配器，尾帧需求选择支持尾帧的适配器；整批冻结后不再路由换供应商。
3. 非法时长、FPS、尺寸、提示词长度、额外参考字段和不支持尾帧拒绝，生成 POST 为零。
4. 并发 1/2 均通过独立调度器竞争验证，无任务覆盖、无超槽提交。
5. 切换模型后旧记录模型/不可变绑定不变；旧未提交项被阻断；新批次未授权时零 POST，另行授权后 approval UUID 与旧任务不同。
6. unknown 经重启保留，不再次提交；修改授权后的输入被拦截。
7. 两个适配器使用相同参考审批门禁；场景主参考撤销阻断，历史七镜导出/时间线回归保留。
8. 旧 H3 profile 没有 batchPolicy 时可按原快照精确重建，以原绑定恢复，不把新能力配置注入旧绑定。

## 数据兼容与范围

本轮只增加批次 JSON 的可选字段，不增加 SQL 表、不提高 schema 11、不重写历史记录。历史 H3 批次和无 purpose 的技术历史仍可解析。缺执行配置快照的历史批次只能查阅/恢复已有可核验任务，不能获得新的收费提交权限。

备份仍禁用批次执行权限，凭据引用脱敏；原授权不跨项目/恢复迁移。自动化验证 schema 11、外键完整性、备份恢复、旧 profile 和已接受任务恢复。未打开或修改用户真实生产数据库。

## 修改文件（仅本阶段）

- `electron/main/generation/video-batch.ts`、`video-api-service.ts`、`video-production-gate.ts`、`execution-recovery.ts`
- `electron/main/tools/broker.ts`、`adapters/video-lifecycle.ts`、`adapters/compshare-minimax-h3.ts`
- `electron/main/ipc.ts`（等待异步准备/返工预览，不新增 IPC 或权限）
- `src/shared/video-tool-profile.ts`、`src/shared/video-batch.ts`
- `src/features/shot-videos/VideoBatchPanel.tsx`
- `tests/unit/video-batch.test.ts`、`tests/fixtures/video-http.ts`
- `README.md`、本文档

工作区还有此前 P0-1、批量及 Packy 修改；不得把整个 git status 都归为本阶段新增文件。

## 验证记录

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| lint | PASS | `test-results/p0-batch-decoupling-lint.log` |
| build（严格 TypeScript + Electron main/preload/renderer） | PASS | `test-results/p0-batch-decoupling-build.log` |
| 全量 unit | 502/502 PASS | `test-results/p0-batch-decoupling-unit.log` |
| 最终批量专项（含历史批次无变更启动保护） | 19/19 PASS | `test-results/p0-batch-decoupling-batch.log` |
| Electron smoke | 43/43 PASS | `test-results/p0-batch-decoupling-smoke.log` |
| 数据库/备份/执行绑定/Skill/导出回归 | PASS，包含于上述 unit 与 smoke | schema 11、foreign_key_check、JSON 历史读取、旧配置恢复、备份执行禁用、七镜本地 MP4/时间线导出 |

全量 unit 后，最后对“启动不重写无需变更的历史批次”增加保护并重跑完整 19 项批量专项；最终构建及 lint 均通过。无变更历史批次在重启前后保存字节一致。

首次构建被文件系统沙箱拒绝 realpath（EPERM）；以授权的普通 Windows 构建权限完成。Vite 有第三方 Zod 注释警告，不影响最终构建成功。测试中曾发现备份将 authorizationDigest 误脱敏，已改用 scopeFingerprint 并通过备份恢复；另修正本地协议服务的任务 ID 复用及测试凭据，最终验证没有保留失败项。日志不提交运行数据。

## 遗留限制

- 本轮只证明模型解耦、协议及生产安全行为，未证明任何新供应商的真实兼容性、计费或商业画面质量。没有新增收费请求。
- 未声明 batchPolicy 的现有工具维持原单任务能力，不能直接宣称已支持批量。未来适配器必须明确能力并通过适配验收。
- 缺原执行绑定/配置、原凭据不可用或原适配器无法重建时继续安全阻断；不会用当前默认模型猜测恢复。
- 本地费用上限与供应商账户硬限额是不同边界；报价未知保留 null，不能保证未知供应商的外部结算硬限额，也不能记为免费。
- 未扩展多参考协议、Packy 编辑、P0-3、音频或成片功能；既有导出回归仅验证软件本地链路。
