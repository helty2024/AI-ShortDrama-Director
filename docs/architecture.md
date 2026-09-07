# Phase 1 架构

## 数据流与边界

React 页面 → workspaceService → window.desktop.workspace.request → preload 的固定 workspace:request 通道 → 主进程 Zod 请求校验 → ProjectDatabase → SQLite。
返回值使用明确的 Result 成功/失败联合类型，renderer 按对应 schema 再次验证成功数据。

只有 electron/main/database.ts 导入 node:sqlite。preload 没有 SQL、路径、任意 channel 或文件系统接口。
主进程检查发送者是否属于登记的窗口、是否为主 frame、URL 是否与配置的 renderer URL 完全相等。
仅允许 projects.list/create/get/open/update/delete/seed、workspace.get、entities.createDraft。
请求为 strictObject：额外字段、错误 UUID、未知 action 都会拒绝；内部异常仅返回通用错误，避免暴露本地路径。

窗口保持 contextIsolation=true、sandbox=true、nodeIntegration=false，拒绝新窗口、页面导航与权限请求。
CSP 只在开发环境为 React Refresh 放宽内联脚本；生产构建保留 script-src 'self'。
开发示例开关由主进程 app.isPackaged 决定；preload 使用启动参数控制入口展示，主进程再次强制授权。

## SQLite

使用 Electron 附带的 Node SQLite，无需第三方原生模块重编译。同步 API 适合本阶段少量本地元数据；后续大型拆解/批处理需放入 worker 或分批事务，避免阻塞主进程。

存储表：

- projects：项目 UUID + 经过校验的 JSON。
- entities：实体 UUID、project_id、kind + 完整领域 JSON；按项目/类型索引。
- entity_refs：来源与目标实体关系；复合外键保证两端属于同一项目。
- settings：示例项目标记等内部设置。

JSON 保留类型间不同字段，关系表和领域校验保护引用完整性，不引入 ORM。
主进程在插入批次后检查所有引用的存在性、实体类型与项目归属，失败回滚整批；Shot 的 Scene 与 Storyboard 必须同属一集。
项目删除由外键 ON DELETE CASCADE 清除全部实体与关系。当前没有单实体删除 API；Phase 2 增加时必须同时更新 JSON 引用与关系表，不能直接删除一行。

连接开启 foreign_keys、WAL 与 busy_timeout。migration 由 PRAGMA user_version 管理，当前 v1 在事务中创建表和索引；重入不重建，未来版本拒绝打开。新增 migration 按版本顺序追加并测试旧库升级，不能改写已发布的历史迁移。
Seed 将项目、实体、关系和标记放在同一事务中，失败无残留。
项目更新要求 expectedRevision；主进程比较并递增 revision，保留 createdAt，更新 updatedAt。
lastOpenedAt 是导航元数据，打开项目不递增内容 revision。

## 页面和状态

WorkspaceProvider 使用 React Context + useReducer，统一管理当前项目快照、项目列表、当前模块、loading/saving/error 与对话框。
最近项目从持久化的 lastOpenedAt 派生；启动恢复最近项目。切换/写入期间串行处理并禁用冲突操作，避免旧响应覆盖新选择。
成功写入后重新读取项目列表及工作台快照，保存状态以数据库响应为准；失败显示错误，不显示成功反馈。

ProjectPage 提供完整项目 CRUD；ScriptPage 展示 Script/Episode/Scene；CharactersPage、LocationsPage、PropsPage 分别展示角色、场景、道具；StoryboardPage 展示分镜表与镜头；GenerationPage 展示任务草稿；AssetsPage 展示素材元数据。
统一 EntityList 从 workspace.get 快照按 kind 读取领域对象。新增草稿由主进程生成 UUID/时间戳/默认字段，涉及父级关系时由 UI 显式选择。
浏览器环境没有 desktop API 时显示错误，不伪装成本地保存。

## 验证

单元测试覆盖 CRUD、校验、乐观并发、持久化、迁移重入、seed 幂等、完整引用、跨项目/错误引用、事务回滚、级联删除及 SQL 参数绑定。
桌面测试运行真实 Electron，覆盖 CRUD、重启恢复、示例、业务新增、preload 隔离、错误参数及未授权窗口拒绝。
CI 在 Windows 上执行 npm ci、typecheck、lint、test:unit、build、test:smoke。

## Phase 2 接入方式

先增加剧本编辑与导入，再以共享 Zod schema 定义拆解结果，将 Episode/Scene/Character/Location/Prop 批量写入同一个事务。
添加明确的受限 IPC action，不将原始 SQL、文件路径或任意 provider 请求交给 renderer。
Provider 适配器和密钥存取放主进程，接口接收结构化输入并返回标准结果；密钥不能放入 source.parameters 或 VITE_ 变量。
生成任务从 draft 进入 queued/running 状态后，再接入取消、重试、幂等与持久化队列。输出 Asset 引用来源模型/参数和前一版本 ID，保留旧素材。
完整版本历史、媒体导入及单实体编辑/删除属于后续功能，Phase 1 仅提供字段与持久化基础。

参考：[Node SQLite](https://nodejs.org/api/sqlite.html)、[Zod](https://zod.dev/api)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)。
