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

Provider 仅返回数据，没有数据库写入能力。ValidatedTextProvider 提供超时、取消、有限重试和错误规范化；Mock 默认不联网，CompatibleTextProvider 使用主进程环境配置，认证信息不进入 renderer 或持久化任务。当前没有图像/视频 Provider。

队列单 worker 异步处理，每批全部成功才提交结果；执行前后验证来源 revision。取消或失效输出不写 Draft，更不会写正式实体。重启恢复 queued，遗留 running 标记为失败，等待人工重试。详见 [Provider 与任务队列](ai-provider.md)。

## 页面和状态

WorkspaceProvider 使用 Context/useReducer，管理当前项目、导航、加载/保存/错误、模态框、编辑状态与丢弃编辑后的重挂载。最近项目从 lastOpenedAt 派生。Scene 编辑器本地维护结构化内容和有界撤销历史，延迟自动保存；导航和关闭保护未保存内容。Bible 同时仅允许一个编辑会话，使用显式保存。

ScriptPage：左侧剧本/分集/场次树，中间结构化编辑，右侧导入、AI 分析、审核卡片和任务状态。CharactersPage/LocationsPage/PropsPage 展示与编辑 Bible；StoryboardPage 展示确认后的 Shot 与镜头计划；GenerationPage 同时展示文本任务及保留的媒体任务草稿；AssetsPage 仍为素材元数据。

新增领域草稿与原有项目管理继续走工作台服务；智能业务走类型化 intelligence service。任务快照轮询不会替换正在编辑的 Scene 本地内容。详见 [剧本智能流程](script-intelligence.md)。

## 验证与下一阶段

单元测试覆盖真实解析、预览、Zod、事务、revision、合并、Provider、取消/重试/错误、迁移和原有持久化关系。Electron 测试使用隔离 userData，验证安全 IPC、项目恢复以及编辑 → 导入 → 拆解审核 → 合并 → 镜头确认 → Bible 保存 → 重启恢复。

Phase 3 应先完成真实素材导入、版本与来源记录，再接单一图像 Provider。沿用任务队列取消/重试协议，生成结果先作为待审核 Asset；确认后再关联正式镜头或 Bible。大型二进制放受控文件目录，不放 SQLite JSON。媒体计费、幂等、失败恢复、密钥安全存储应在真实生成接入前落实。
