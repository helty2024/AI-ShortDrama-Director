# AI ShortDrama Director

面向 AI 短剧创作的本地桌面工作台，基于 React + TypeScript + Electron。

## Phase 6 · 0.6.0

- 默认 Simple Mode 生产看板：Next Action、关键帧生成、图片/视频审核、单镜头视频确认、连续性与 QC；Advanced 保留高级批次、Prompt 和 Provider 操作。
- “验收与维护”创建 1 集 / 1 场 / 3 Shot / 2 角色 / 1 地点 / 2 道具的小项目；Checklist、Summary 与 ComfyUI 验收报告持久化。
- Paid Validation 按能力选择最短时长、最低分辨率，展示输入/首帧/费用/凭据状态，显式确认才提交。预览过期或重复提交会被拒绝。
- 统一任务与错误中心包括 Text / Image / Video / QC。已获远端 ID 的 ComfyUI / Seedance 任务提供关闭重启验收入口。
- MP4 使用 `director-media` 受控流式协议，支持 Range / HEAD；数据库登记和文件目录边界逐次校验。图片仍采用受控 data URI。
- v6 增量迁移、直接版本 ID 查询、上下文读取复用、看板/素材/版本/任务分页和折叠面板延迟加载；单元测试构造 20 Scene / 100 Shot / 500 Version / 500 Task。
- 项目备份目录包含单项目 SQLite、媒体、公开配置与工作流；恢复验证校验和，重新分配 UUID，失败回滚，凭据重新绑定。
- 首次设置、About、构建时间/源 revision、schema 版本、FFmpeg 检测、脱敏诊断包。版本号为 0.6.0。

开始：**验收与维护 → 创建 3 Shot 验收项目 → 生产看板**。真实服务验收与 Mock 功能测试分开记录。本机在 2026-09-08 检查 `127.0.0.1:8188` 不可达，ComfyUI **Not validated**；没有执行真实 Seedance 付费请求，Seedance **Not validated**。真实 3 镜头素材质量与云端恢复验收仍需配置服务后由用户运行，不能由 Mock 通过结果代替。

文档：[生产验收](docs/production-validation.md) · [首次设置](docs/setup-wizard.md) · [备份恢复](docs/backup-restore.md) · [诊断包](docs/diagnostics.md) · [媒体流式播放](docs/media-streaming.md)。

## Phase 5 已实现

- 独立生产看板，按 Episode → Scene → Shot 汇总关键帧、视频、QC、审核、失败和成本。
- 结构化 Character / Prop / Location 连续性快照，场次初始状态、镜头继承、剧情动作更新、revision 冲突保护。
- 图片与视频编译器共享规则式 Continuity Resolver，剧情状态优先于 Bible 可变字段，保留基础身份。
- MediaQCProvider 抽象与确定性 Mock QC；报告绑定具体版本，人工接受、忽略、拒绝、单次重生规划。
- Strict / Advisory QC 完成定义，连续性指纹变化让旧 QC 失效，状态不重复持久化。
- 批量视频编译、Provider 与费用预览、明确确认、独立任务、失败重试和按能力取消。
- 规则式 Router 与能力矩阵，按币种区分预计 / 实际 / 未知成本，支持手工每秒报价。
- JSON Production Manifest 导出固定确认版本、受控媒体引用、顺序、Prompt / Provider / QC / 成本。
- v5 增量迁移保留 v1–v4 项目、图片、视频和远端任务 ID。

生产入口：**生产看板** → 编辑连续性 → 生成并确认关键帧 → 批量视频预览与费用确认 → 视频审核 → QC → 人工确认 → 导出分集 Manifest。默认 Mock QC 不调用视觉模型，评分只是元数据/连续性规则的确定性测试结果；没有执行真实付费 QC 或额外云生成。

详见 [连续性](docs/continuity-engine.md)、[QC](docs/media-qc.md)、[Router](docs/model-router.md)、[生产看板](docs/production-board.md)、[成本](docs/cost-tracking.md)、[Manifest](docs/production-manifest.md)。本项目到确认的素材结束，不提供时间线、粗剪、转场、字幕、音乐、音频混合或成片编码。

## Phase 4 已实现

- ComfyUI 生产诊断：可达性、Checkpoint、节点、输入槽和输出节点检查，Provider Ready 与测试生成。
- Storyboard 多选、Scene / Episode 范围筛选、缺少关键帧选择、独立任务批次及失败重试。
- 导演动作编辑、独立 Video Prompt Compiler、已确认首帧与规则式连续性。
- 长任务 VideoGenerationProvider、FFmpeg 确定性 Mock MP4、Seedance / Ark-compatible 适配器。
- 主进程系统加密凭据、远端任务恢复和持久化提交回执，阻止不明提交自动重复计费。
- MP4 导入、FFprobe 元数据、视频多版本播放/A/B 审核、明确 Confirm for Shot 固定正式版本。
- v4 migration 保留历史图片、项目与 v1/v2/v3 migration；成本字段未知时为空。

先安装 FFmpeg（含 FFprobe，需 libx264 与 WebP 编码支持）并加入 PATH，或设置主进程环境变量 `DIRECTOR_FFMPEG` / `DIRECTOR_FFPROBE` 为可执行文件路径。默认 Mock 无需付费 API。本次已验证本地 Mock MP4 与模拟 HTTP 协议，未执行真实 Seedance 付费请求；默认本机 ComfyUI 地址未连通，须启动并通过诊断后使用。

快速流程：分镜 → 批量关键帧生产 → 批准并绑定关键帧 → Shot 视频生产 → 编译/编辑动作 Prompt → 生成视频 → 播放、Approve → Confirm for Shot。下一次生成保持正式视频不变。

详见 [视频生成](docs/video-generation.md)、[Provider](docs/video-provider.md)、[Seedance 配置](docs/seedance-provider.md)、[生产批次](docs/production-batch.md)、[凭据安全](docs/credentials.md)。Phase 5 已开放批量视频预览与确认；暂停/继续仍预留，尚无剪辑时间线。

## Phase 3 已实现

- 正式图片导入、SHA-256 去重识别、尺寸/MIME 校验、缩略图与受控本地存储。
- Asset 多版本、审核/提升/拒绝/归档、版本对比和可追踪生成元数据。
- Bible 多分类参考图、主参考与视觉资产生成；Shot 关键帧编译、生成、审核和固定版本绑定。
- 独立 Prompt Compiler、可替换 ImageGenerationProvider、真实 ComfyUI HTTP/WebSocket 适配器与确定性 Mock。
- 工作流模板导入、变量槽、Provider 设置，复用原有持久化队列处理图像任务与恢复。
- v3 migration，保留既有项目和历史 migration；新增文件一致性、协议与端到端测试。

默认 Mock Image，无需 ComfyUI 即可体验全部审核流程。真实 ComfyUI 需要设置本机 URL、兼容 Checkpoint 或导入自定义 API 工作流。Phase 4 已加入视频 Provider、安全凭据和人工视频审核；不含视觉 AI QC、自动磁盘回收和成片剪辑。

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
