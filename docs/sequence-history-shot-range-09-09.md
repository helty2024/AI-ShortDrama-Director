# 09-09 成片历史与新素材的镜头范围标签

日期：2026-10-27。分支：`codex/09-01-test-ready-alpha`。

- `sequenceClipLabel` 继续从已有 `metadata.sequence` 取得镜头 ID 和数量，增加可选的完整正式项目镜头列表。主进程和渲染层共用 `src/shared/sequence-label.ts` 的纯函数，不从主进程导入 UI 代码；原 feature 路径保留重导出。
- 使用明确标为“项目镜序”的简短标识：当前项目全部镜头按集、场、镜头排序后从 1 起算的位置。场次内镜号可重置，项目镜序仍不重复。`2 镜头 · 项目镜序1、3` 与 `2 镜头 · 项目镜序1-2` 可区分同镜数的不同子集，连续项压缩，始终保留成片记录的剪辑顺序，不重新排序历史片段。
- 新成片素材名为 `成片 · N 镜头 · 项目镜序…`，名称在创建时保存。历史行动态生成同样标签，继续保留日期、时长、分辨率；不使用当前草稿的镜数或成员。
- 缺失、空或畸形序列回退“镜数未知”；缺少任一项目镜头、无项目上下文或重复镜头引用时只显示镜数。镜序最多展示 8 段、64 字符内容，剩余明确以“…”省略，避免长序列突破素材名长度限制。
- **显示边界**：镜序依赖当前项目正式顺序，不是新增的历史编号快照。顺序变化时历史显示可变化；新素材名保留创建时文字，旧素材名和已导出文件不批量改写。原 `metadata.sequence.shotNumber` 及其他序列字段不修改。
- 不新增 schema、数据库迁移、IPC、preload、权限或依赖。唯一建议文件名继续使用版本 UUID；正式顺序校验、无声、100 镜头 / 600 秒、24 fps、首镜分辨率及 FFmpeg 管线不变。不增加任意重排、转场、字幕、音频、撤销栈、批次时间线移出或云同步。未执行 CompShare、Packy、SenseNova 付费生成或付费 E2E。

单元测试覆盖非连续子集、连续范围、同镜数不同子集、上下文顺序变化时保留剪辑次序、缺镜/重复/畸形记录安全回退和长标签省略；并实际导出两镜不同子集及三镜，核对新素材名和既有序列元数据。

沿用 `npm run test:smoke -- --grep "formal project offline"`。正式 fixture 有跨场次镜号重置，三个有效确认镜头在完整项目中的位置为 2、3、4；先以首末镜导出 `2 镜头 · 项目镜序2、4`，再全选导出 `3 镜头 · 项目镜序2-4`，再移出末镜导出另一两镜子集 `2 镜头 · 项目镜序2-3`，在同一历史列表及素材库名称中核对差异。继续检查唯一建议文件名、移出、区间缓存、空草稿、导航/冷启动和红蓝逐帧导出，最后核对生成记录、AI 任务、生产批次均为零。

本地证据（不提交）：`test-results/formal-project-history-shot-range.png`；已有唯一建议文件名 JSON、区间恢复/空草稿截图及红蓝 MP4 继续生成。日志：`test-results/build-history-shot-range.log`、`test-results/unit-history-shot-range.log`、`test-results/smoke-history-shot-range.log`。

最终门禁：`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:unit`（512 / 512，约 99 秒）、`npm run test:smoke`（44 / 44，约 4 分钟）、`git diff --check` 全部 PASS。构建仅有现有 Zod 注释的非阻断 Rollup 提示。完整单元测试含本地 HTTP fixture，桌面测试需启动 Electron，沿用获准的沙箱外隔离目录执行；TEMP/TMP 指向工作区 `test-results/tmp`。

门禁通过后立即在当前分支提交并推送 origin，不强制推送；用户原有未跟踪文件保留。
