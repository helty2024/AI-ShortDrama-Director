# 09-08 正式项目重复导出的唯一建议文件名

日期：2026-10-27。分支：`codex/09-01-test-ready-alpha`。

- 正式项目「项目成片」保存窗口建议 `项目名-成片-N镜头-本次视频版本UUID.mp4`，例如 `雨夜来信-成片-2镜头-6f9619ff-8b86-4e11-8d20-3e5fa119c712.mp4`。
- 采用任务允许的“等价唯一本地后缀”：复用每次成片入库时已经生成的视频版本 UUID，完整保留 UUID，避免截短后冲突；不依赖系统时钟、同秒等待或进程内计数器。没有新增 ID 或改变原有成片记录创建行为。同镜数连续导出、重启后的新导出均使用各自新成片版本 ID。
- 仍保留既有项目名清理（Windows 非法字符、控制字符、末尾点/空格、设备保留名、60 个 Unicode 字符上限与空名回退）及镜数前缀。版本 ID 来自主进程已提交的成片版本，渲染层不能传入文件路径或后缀。
- 仅修改正式项目保存窗口的 `defaultPath` 建议；用户仍通过原生窗口决定最终文件名和位置，取消保存仍保留入库成片。素材库名称、历史镜数标签、旧成片名称及文件均不改写；原批次时间线命名不扩展。
- 无 schema、数据库迁移、IPC 形状、preload、权限、依赖或导出版本栈变更。正式故事顺序验证、无声、100 镜头 / 600 秒、24 fps、首镜分辨率和 FFmpeg 管线不变；不增加任意重排、转场、字幕、音频或云同步。未执行 CompShare、Packy、SenseNova 付费生成或付费 E2E。

单元测试保留 Windows 文件名清理检查，并对两次实际的两镜导出验证建议名不同、各自带有完整成片版本 ID。

沿用 `npm run test:smoke -- --grep "formal project offline"`：本地红/绿/蓝 fixture 经正式 UI 导入、批准、采用，捕获首次两镜导出及再次两镜导出的原生保存窗口参数，检查清理后的项目名、镜数、UUID 结构和建议名不同。第一次原生窗口仍选择 fixture 自定路径 `formal-sequence.mp4`，第二次取消文件保存但成片已入库；继续验证三镜建议名、历史标签、部分选择、移出/空草稿导航与冷启动、会话内剪辑区间恢复，以及生成记录、AI 任务、批次均为零。

本地证据（不提交）：`test-results/formal-project-unique-default-paths.json`，记录两次两镜及一次三镜的实际建议名。日志：`test-results/build-export-unique-name.log`、`test-results/unit-export-unique-name.log`、`test-results/smoke-export-unique-name.log`；既有时间线截图及红蓝 MP4 继续由同一用例生成。

最终门禁：`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:unit`（511 / 511，约 103 秒）、`npm run test:smoke`（44 / 44，约 4 分钟）、`git diff --check` 全部 PASS。构建仅有现有 Zod 注释的非阻断 Rollup 提示。完整单元测试含本地 HTTP fixture，桌面测试需启动 Electron，沿用获准的沙箱外隔离目录执行；TEMP/TMP 指向工作区 `test-results/tmp`。

门禁通过后立即在当前分支提交并推送 origin，不强制推送；用户原有未跟踪文件保留。
