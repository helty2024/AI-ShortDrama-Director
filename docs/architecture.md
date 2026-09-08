# 架构

## 进程边界与数据流

React 页面 → renderer service → window.desktop.workspace.request → preload 固定 workspace:request 通道 → 主进程 Zod 参数校验 → ProjectDatabase / IntelligenceService → SQLite。

共享 schema 分为 src/shared/domain.ts 和无副作用的叶子模块 intelligence.ts，API 协议在 api.ts。类型由 Zod 推导，引用仅存 ID，避免循环对象和运行时依赖。返回值为成功/错误联合，renderer 再验证相应响应。

只有主进程 database.ts 导入 node:sqlite。preload 不暴露 SQL、路径、密钥、任意 channel 或文件系统操作。IPC 验证登记窗口、主 frame 和完整 renderer URL；strictObject 拒绝未知字段/操作。intelligence 是新增白名单 action，其 operation 是严格判别联合，按项目检查对象归属及 revision。

contextIsolation 与 sandbox 开启，nodeIntegration 关闭；拒绝外部导航、新窗口和权限请求。未保存关闭由 beforeunload 触发主进程原生确认。文件导入用用户选择的浏览器 File.text，不向 renderer 提供 Node 能力。

## 存储与迁移

SQLite 放在 Electron userData/workspace.sqlite，foreign_keys、WAL 和 busy_timeout 开启。同步 SQLite 仅处理有界元数据事务，网络调用异步执行；当前单任务至多分析 100 场、同项目至多 20 个活动任务。大规模项目后续可移至专用 worker，不引入 ORM。

| 表                  | 职责                                                          |
| ------------------- | ------------------------------------------------------------- |
| projects            | 项目元数据及最近打开时间                                      |
| entities            | Script/Episode/Scene/Bible/Shot/Asset 等正式领域对象          |
| entity_refs         | 同项目复合外键与引用完整性                                    |
| settings            | 内部设置与 seed 标记                                          |
| ai_tasks            | 持久化文本任务、输入、来源 revision、结果 ID、状态和错误      |
| intelligence_drafts | 来源场次、provider/prompt 版本、可审核输出、审核状态与目标 ID |
| import_previews     | 导入原文、初步结构、确认后的 Script ID                        |
| production_elements | 服装、妆容、车辆等其余生产要素与多场次来源                    |

已发布 v1 SQL 保持不变，v2 在单独模块追加表和旧实体默认字段，并保持 UUID/时间戳/revision。PRAGMA user_version 控制顺序，未知高版本拒绝打开。历史 v1 SQL fixture 测试旧库升级，迁移与写入失败整批回滚。

Scene/Bible/分集重命名/排序/审核要求 expectedRevision。更新保留 createdAt 并递增 revision；过期编辑保留 UI 内容，用户可重新加载。导入确认、Draft → Entity 与审核状态更新在单一事务中提交，重复确认返回既有目标。引用检查涵盖同项目类型、对白角色及 Shot 所属集。

删除分集级联场次、分镜表和镜头；删除场次清除相关镜头和 Draft，并清理道具场次引用、生产要素来源、媒体任务镜头及失效版本引用。角色/地点/道具不会随场次删除。项目删除先取消队列任务，再由外键清理项目数据。

## AI 与正式数据边界

输入 Scene/Episode/Script → AITaskQueue → 独立 prompts → TextGenerationProvider.generateStructured → Zod 校验 → Draft → 人工编辑/忽略/确认/合并 → Production Bible 或 Shot。

Provider 仅返回数据，没有数据库写入能力。ValidatedTextProvider 提供超时、取消、有限重试和错误规范化；Mock 默认不联网，CompatibleTextProvider 使用主进程环境配置，认证信息不进入 renderer 或持久化任务。Phase 3 增加图像 Provider；仍不接视频 Provider。

队列单 worker 异步处理，每批全部成功才提交结果；执行前后验证来源 revision。取消或失效输出不写 Draft，更不会写正式实体。文本重启恢复 queued，遗留 running 标记失败；图像任务有 providerTaskId 则恢复查询，未知提交需人工重试。详见 [Provider 与任务队列](ai-provider.md)。

## 页面和状态

WorkspaceProvider 使用 Context/useReducer，管理当前项目、导航、加载/保存/错误、模态框、编辑状态与丢弃编辑后的重挂载。最近项目从 lastOpenedAt 派生。Scene 编辑器本地维护结构化内容和有界撤销历史，延迟自动保存；导航和关闭保护未保存内容。Bible 同时仅允许一个编辑会话，使用显式保存。

ScriptPage：左侧剧本/分集/场次树，中间结构化编辑，右侧导入、AI 分析、审核卡片和任务状态。CharactersPage/LocationsPage/PropsPage 展示与编辑 Bible，并提供参考图和视觉生成；StoryboardPage 展示确认后的 Shot 与镜头计划；GenerationPage 同时展示文本任务及保留的媒体任务草稿；AssetsPage 已提供图片网格与版本审核，ProviderSettingsPage 管理项目图像配置。

新增领域草稿与原有项目管理继续走工作台服务；智能业务走类型化 intelligence service。任务快照轮询不会替换正在编辑的 Scene 本地内容。详见 [剧本智能流程](script-intelligence.md)。

## 验证与下一阶段

单元测试覆盖真实解析、预览、Zod、事务、revision、合并、Provider、取消/重试/错误、迁移和原有持久化关系。Electron 测试使用隔离 userData，验证安全 IPC、项目恢复以及编辑 → 导入 → 拆解审核 → 合并 → 镜头确认 → Bible 保存 → 重启恢复。

Phase 3 使用 VisualService 白名单 IPC → VisualRepository / Prompt Compiler → 原 AITaskQueue 的 ImageTaskExecutor → ImageGenerationProvider → 受控存储 → AssetVersion Draft。异步文件准备完成后，版本和任务状态在同一个数据库事务提交。v3 追加 asset_versions、visual_settings、workflow_templates，v1/v2 历史文件不改。

缩略图和图片通过 UUID 查库、路径校验后返回 data URL；不暴露文件路径选择参数或任意 HTTP 请求。文件已写入但 DB 失败会留下可扫描孤儿，不自动 unlink。Shot 同时记录资产 ID 与审核时固定版本，主资产提升不改变其他 Shot。详见 [资产管线](asset-pipeline.md) 与 [图像生成](image-generation.md)。

Phase 4 建议先完成关键帧批量生产、工作流实机验收和版本锁定，再接视频 Provider；视频沿用异步队列、审核与来源版本追踪。

## Phase 4 视频生产

新增 `electron/main/video/`：compiler 纯规则编译；providers 长任务协议；executor 负责提交回执、轮询、下载和提交回调；service 负责项目范围校验、Profile 与批次；credentials 封装系统加密；ffmpeg 封装无 shell 子进程；migration 增量 v4。

数据流：React VideoPanel / BatchPanel → preload 固定 workspace.request → Zod production command → 主进程 ProductionService → AITaskQueue → VideoGenerationProvider → 受控媒体目录 → FFprobe + 缩略图 → SQLite AssetVersion draft → 人工审核 → Shot 固定 version ID。

SQLite 仍只在主进程，新增 production action 继续校验发送窗口、来源 URL、项目及实体引用。renderer 仅持有公开 Profile 字段与不含密钥的凭据引用/配置状态，不接触文件路径、任意网络或原始 IPC。媒体预览通过限定版本 ID 获取受控 data URI；CSP 允许本地媒体，禁止任意远端 fetch。

执行器复用单工作者异步队列，不阻塞 renderer；每项目最多 20 项等待任务。视频长任务等待期间其他生成任务排队，当前不承诺多 Provider 并发调度。提交前的本地 intent 回执与提交后的远端 ID 回执先于 SQLite 进度更新；明确已知 ID 的恢复只轮询/下载，不重新 POST。视频版本与成功 Task 在同一事务提交，文件先落盘，失败遗留文件由孤儿扫描报告。

后续 Phase 5 可增加成片装配与导出：只读取 Shot.confirmedVideoAssetVersionId 构造有顺序的镜头清单；不复用 draft 或 Asset 最新版本替代确认版本。

## Phase 5 Production Intelligence

`src/shared/production.ts` 定义连续性、QC、生产设置、成本行/汇总、批次预览和重生计划的 Zod schema。`electron/main/production/` 分离 continuity（解析）、router（能力/成本）、status（派生状态）、qc（Provider/策略）、service（事务与流程）和 migration。

React ProductionBoard → 固定 preload → 严格 `pilot` IPC → ProductionIntelligenceService。只有主进程接触 SQLite、受控媒体和系统 Manifest 保存对话框；QC Provider 在主进程收到按版本 ID 读取的内容。主进程只返回结构化报告和公开生产设置，不返回任意文件访问能力。

v5 只追加 continuity_snapshots、qc_reports、production_preferences、production_previews、regeneration_plans；历史 v1–v4 migration 未改动。场次/镜头连续性和 QC 的来源对象删除通过外键级联；生产设置只持久化 QC 模式、路由偏好和报价。看板状态、分集摘要和成本汇总实时推导，不再另存完成布尔值。

批次预览保存输入指纹与费用快照。确认前验证当前连续性、关键帧、Profile、设置，发生变化必须重新预览。确认在事务中创建聚合组并标记预览已消费，再创建独立 Task；重复确认不会重新提交整批。进程在批次准备中断时，未获得 taskId 的条目保留提示，用户核对后可重新预览未提交镜头，已有 Task 继续按 Phase 4 回执恢复。

重生计划有 ready/submitting/submitted 单次执行门闩。提交前落盘 submitting，防止双击或并发请求重复创建；结果不明确时检查任务列表，不能自动无限重生。网络与视频执行仍复用 AITaskQueue；Mock QC 通过独立异步 Provider 调用完成，当前没有持久化 QC 排队/取消调度，失败由用户再次发起。

当前 Resolver 按同一 Storyboard 的镜头顺序继承；生产看板会重复读取有限规模项目的元数据，适合现有桌面项目。后续大项目应对 workspace/context 缓存并按 revision 失效，不在本阶段引入分布式调度。
