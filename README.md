# AI ShortDrama Director

面向 AI 短剧创作的本地桌面工作台，基于 React + TypeScript + Electron。

## Phase 3 已实现

- 正式图片导入、SHA-256 去重识别、尺寸/MIME 校验、缩略图与受控本地存储。
- Asset 多版本、审核/提升/拒绝/归档、版本对比和可追踪生成元数据。
- Bible 多分类参考图、主参考与视觉资产生成；Shot 关键帧编译、生成、审核和固定版本绑定。
- 独立 Prompt Compiler、可替换 ImageGenerationProvider、真实 ComfyUI HTTP/WebSocket 适配器与确定性 Mock。
- 工作流模板导入、变量槽、Provider 设置，复用原有持久化队列处理图像任务与恢复。
- v3 migration，保留既有项目和历史 migration；新增文件一致性、协议与端到端测试。

默认 Mock Image，无需 ComfyUI 即可体验全部审核流程。真实 ComfyUI 需要设置本机 URL、兼容 Checkpoint 或导入自定义 API 工作流。当前不接真实生视频，不含视觉 AI QC、自动磁盘回收或商业 API 认证管理。

## 视觉生产快速体验

1. 新建或载入开发示例，进入“设置”，默认 Mock 可直接使用。
2. 在角色/场景/道具中展开“视觉生产”，编译 Prompt、生成图片，审核卡选择目标后“批准 / Promote”。
3. 在分镜中展开某个 Shot 的“视觉生产”，生成关键帧并确认；重新生成产生新版本，旧确认镜头不会被默默替换。
4. 在素材库导入 PNG/JPG/WEBP，查看版本、生成信息、引用关系和双图对比。
5. 使用 ComfyUI 时参照 [接入说明](docs/comfyui-provider.md) 配置本机模型与工作流；标准模板为文生图，图像参考需自定义工作流槽。

## Phase 2 已实现

- 保留 Phase 1 项目管理、最近项目、八模块导航和开发示例。
- 结构化剧本编辑器：新建剧本、分集新增/重命名/删除、场次新增/排序/删除、对白与动作编辑、自动保存、未保存保护、撤销/重做。
- TXT / Markdown / 文本粘贴导入，先解析预览并保留原文，人工确认后事务写入剧本、分集、场次。
- 按场次、分集或剧本拆解 13 类生产元素；支持编辑、忽略、确认新建或合并，同一实体可关联多个来源场次。
- Character / Location / Prop Bible 完整字段编辑与参考素材关联；角色建议也必须经过 Draft 审核。
- 初步导演拆镜：镜头计划进入可编辑 Draft，逐项确认才创建正式 Shot。
- 主进程文本 Provider、持久化 AI 任务队列、取消/重试/错误提示，以及 v1 → v2 数据迁移。

默认 MockTextProvider，无需 API Key，可完成全部业务流程。可配置兼容结构化输出协议的文本 API，配置方法见 [AI Provider](docs/ai-provider.md)。Phase 2 的文本流程继续保留。Phase 3 已加入图片与资产版本，剧本实体的 revision 仍用于冲突保护，不等同于完整剧本版本历史。

## 快速体验

1. 启动后新建项目或载入“雨夜来信”示例，进入“剧本”。
2. 左侧选择分集/场次，中间编辑动作、对白等字段，顶部确认“已保存”。
3. 右侧“剧本解析”粘贴文本或选择 TXT/Markdown，查看原文和解析结构，再点击确认导入。
4. “智能分析”中分析当前场次或整集；编辑审核卡片，确认创建或选择已有实体合并。
5. 点击“导演拆镜”，审核镜头草稿并确认，在“分镜”查看正式镜头；在“角色/场景/道具”维护 Bible。
6. 在分析面板或“生成”查看文本任务状态、错误、取消和重试。

## 环境与启动

Node.js 24 LTS、npm 11、Git。首次安装/启动需要访问 npm 和 Electron 下载服务。

```bash
npm ci
npm run dev
```

启动后点击“新建项目”；或点击“载入开发示例”验证完整关系。
示例入口仅开发环境可用，同一数据库重复点击不会重复插入；删除示例后可以重新载入。
重命名通过 revision 检测过期更新。删除项目必须输入完整名称，关联记录同时删除。

## 命令

| 命令               | 用途                                               |
| ------------------ | -------------------------------------------------- |
| npm run dev        | Electron + React 开发与热更新                      |
| npm run typecheck  | 严格 TypeScript 检查                               |
| npm run lint       | Oxlint 静态检查                                    |
| npm run test:unit  | 领域、持久化、迁移、引用和事务测试                 |
| npm run build      | 类型检查并构建到 out/                              |
| npm run test:smoke | 执行独立数据库的 Electron 端到端测试（请先 build） |
| npm run preview    | 启动构建后的桌面应用                               |
| npm run pack       | 生成当前平台未安装应用目录                         |
| npm run dist       | 生成当前平台分发包                                 |

开发启动脚本会清除 ELECTRON_RUN_AS_NODE。Vite 固定在 electron-vite 5 支持的 7.x 系列。
分发使用 electron-builder；图标、签名、公证仍需在正式发布前配置。

## 数据存储与测试隔离

数据库位置：Electron app.getPath('userData') 下的 workspace.sqlite。
默认 Windows 位置通常是 %APPDATA%/ai-shortdrama-director/workspace.sqlite。
SQLite 使用 WAL 模式；备份时先关闭应用，再复制整个 userData 目录，避免遗漏未检查点的 WAL 数据。
首次运行自动迁移，未知的高版本数据库会拒绝打开。数据库与媒体不进入 Git。

单元测试使用内存库或独立临时目录。桌面测试设置 DIRECTOR_TEST_USER_DATA 指向随机临时目录，完成后清理；打包应用忽略此变量。
不要用日常 userData 目录运行测试。Windows 沙箱若阻止 Electron GPU 子进程，需在允许桌面进程的环境执行冒烟测试。
Node 24 的 node:sqlite 可能输出实验性 API 提示；当前使用的 API 已在实际 Electron 运行时测试。

## 代码结构

```text
electron/main/       SQLite、迁移、领域写入、seed、安全 IPC、窗口生命周期
electron/preload/    只暴露类型化白名单请求 API
src/shared/         Zod 领域 schema、IPC 协议、桌面接口
src/services/       renderer 数据访问与响应校验
src/features/workspace/  Context/reducer、项目页面、表单对话框
src/features/script/     编辑器、导入预览、审核卡片、Bible、任务 UI
electron/main/intelligence/  解析器、Provider、队列、Draft 审核、migration v2
src/components/     后续跨模块共享组件
src/assets/ public/ 静态资源
tests/unit/         关键业务单元测试
tests/electron.spec.ts  桌面端到端验证
electron/main/visual/  文件存储、图像 Provider、Prompt Compiler、版本审核、v3 migration
src/features/visual/   素材库、生成面板、版本对比、Provider 设置
docs/               架构和领域说明
```

详见 [架构说明](docs/architecture.md)、[领域模型](docs/domain-model.md)、[剧本智能流程](docs/script-intelligence.md)、[AI Provider](docs/ai-provider.md)、[协作规则](AGENTS.md)。
项目尚未指定开源许可证。

视觉管线详见 [资产管线](docs/asset-pipeline.md)、[图像生成](docs/image-generation.md)、[ComfyUI](docs/comfyui-provider.md)、[Prompt Compiler](docs/prompt-compiler.md)。备份需覆盖整个 userData（数据库及 media 目录）。
