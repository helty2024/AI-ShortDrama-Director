# 09-01 Test Ready Alpha

内部测试版本 `0.9.0-alpha.1`。保留 SQLite schema 10、backup format 5；不创建正式版本 tag，不改动 v0.8.0 tag / Release。

## 测试同事如何开始

安装 `AI-ShortDrama-Director-Setup-0.9.0-alpha.1-x64.exe`，打开 **AI ShortDrama Director Alpha**。点击“新建项目”，输入故事，点击“AI 整理”。确认剧本预览后，沿顶部“故事 → 剧本 → 资产 → 分镜 → 生成 → 分镜视频”继续。

Alpha 的整理使用本地规则，保留原文，不代表真实大模型能力。角色、场景、道具可在资产页手动建立；已有剧本也可粘贴导入。每页提供下一步入口。

在生成页使用默认“自动推荐”。先制作关键帧，确认生成后**批准**候选，再**设为镜头关键帧**。之后切换“镜头视频”，确认模拟生成、批准候选、**设为当前镜头视频**。分镜视频页只把明确采用的版本显示为当前确认视频。批准不会自动采用，历史和来源记录保持原规则。

生成结果是带 `ALPHA TEST / MOCK` 标记的固定演示画面，UI 明示“测试视频 / 模拟生成”。只验证流程，不能评估真实视频质量。模拟服务仅监听主进程创建的随机 loopback 端口；认证凭据只在内存中生成，不使用用户 API Key，不连接供应商、不消费积分。

## 范围与边界

- App Shell：轻量顶部阶段导航、当前阶段、自动保存、设置；维护入口只在高级模式中显示。
- Story：大故事输入区、“AI 整理”主操作、可选字段折叠、正式写入前的剧本预览。
- Generate：镜头队列、默认推荐、逐镜头确认、可读状态、明确失败与未知提交区分；工具、模型、编译文本和原始错误在高级入口中。
- Script / Assets / Storyboard / ShotVideos：保留编辑结构，统一暖白、浅灰、紫色强调、卡片、圆角和间距，并串接下一步。
- CompShare H3 Adapter 未修改，真实 `generationEnabled` 继续为 false；没有真实付费提交。正式下载 host 白名单仍为空。
- 没有增加 Blender、第二家 Video Provider、Timeline、字幕/BGM 或成片编辑功能。

## 安装与构建

使用 `npm run dist:alpha`。Alpha 构建使用 `electron-builder.alpha.yml`，独立 appId 与快捷方式，不发布安装包到远端。默认 Alpha 数据目录名称为 `ai-shortdrama-director-alpha`，不覆盖稳定版用户数据。

`scripts/prepare-alpha-runtime.mjs` 将构建机器已有的 FFmpeg / FFprobe 复制到被 Git 忽略的 `build/alpha-runtime/`，同时保留该分发包的 LICENSE、README 和二进制校验值。安装包自带这两个组件，测试同事无需配置 PATH。启动时为 Alpha 使用打包的组件。缺失或失败时只显示服务不可用，不回退到真实视频服务。

模拟任务回执存放在本地 `alpha-reference/reference-tasks.json`，仅包含任务 UUID、状态计数和取消标记；不保存输入故事、素材、认证头或密钥。回执持久化用于重启恢复，不重复 submit。该目录及打包二进制、测试截图、报告均被 Git 忽略。

## Alpha 门禁

| 门禁 | 验证位置 |
| --- | --- |
| 新项目完整路径 | Alpha fresh project / 安装版 `scripts/verify-alpha.ts` |
| 空项目与下一步 | Alpha empty project |
| Story → Script | UI 故事整理预览与确认导入 |
| Script → Assets | 主路径“查看角色与场景资产” |
| Assets → Storyboard | 主路径“前往分镜” |
| Storyboard → Generate | 主路径“前往生成” |
| Fixture success | 本地关键帧与 Reference Video lifecycle |
| Generate failure | Alpha generation failure |
| Candidate → Adopt | 主路径验证 approve 后绑定仍为空 |
| Confirmed Video Asset | 当前视频绑定、播放器与 lineage 核验 |
| 重启恢复 | Alpha fresh project / 单元回执恢复 / 安装版重启 |
| 服务未配置 | Alpha empty project 与原有 unavailable 验证 |
| ComfyUI offline | Alpha empty project 预检失败 / 原有离线单元测试 |
| Video Tool unavailable | Alpha empty project 视频不可用状态 |
| 删除 pending task 保护 | Alpha pending video prevents project deletion |
| 多镜头不自动提交/采用 | Alpha multi-shot queue |

`npm run lint`、`npm run build`、`npm run test:unit`、`npm run test:smoke` 是提交门禁。安装版通过 `npx tsx scripts/verify-alpha.ts <installed-exe> <isolated-data> <report>` 实际操作新项目；验证输出限制在现有 OS temp release-test 根目录。

UI 草案 stash 不恢复，本轮只推进可安装、可走通的内部测试版本。

## 2026-10-14 验收记录

- Unit：429/429 PASS；Desktop/Smoke：29/29 PASS；lint/build PASS。
- NSIS x64 安装成功；从安装后的应用完成新项目主路径、候选批准与采用、测试视频播放、lineage 查询和重启恢复。
- 安装版 SQLite schema 为 10；本地模拟视频只创建一份回执，重启不增加 submit。没有调用真实 CompShare 生成。
- 安装包：`AI-ShortDrama-Director-Setup-0.9.0-alpha.1-x64.exe`。
- SHA256：`c92bae7ed243db1ebd21db1faef216fbca790ab18a235b38b0950acd43b9c487`。
- 截图、验收 JSON、安装目录、固定测试媒体及视频工具均留在被忽略的构建输出或隔离验收目录中，不提交用户数据。
