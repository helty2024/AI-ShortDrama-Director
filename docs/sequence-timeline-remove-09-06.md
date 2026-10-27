# 09-06 时间线行内移出与勾选同步

日期：2026-10-27。分支：`codex/09-01-test-ready-alpha`。

- 正式项目「分镜视频 → 项目成片」的时间线每行新增“移出时间线”，提供带镜头名称的可访问标签。导出期间禁用，不需额外点击重建。
- 移出后按现有草稿替换/保存队列写入剩余 `clips`，同步 `selectedIds`；即使上方有未应用勾选，也以剩余时间线为准，清除选择差异。保留剩余镜头原入点、出点和正式故事顺序，停止时间线播放并回到剩余首镜。
- 最后一镜也可移出。为防重启复活旧镜头，原 `sequenceDraft.clips` 允许保存 `[]`，保留格式版本与单调递增修订号；不新增字段、迁移、IPC、preload、权限或依赖。旧非空草稿照常恢复，修订冲突和保存失败重试继续有效。
- 空时间线显示“时间线为空，请在上方重新勾选镜头并建立时间线”，无播放器，预览、上一镜、下一镜及导出均禁用；导航和冷启动仍保持空状态。需重新勾选并建立时间线才能继续。导出请求 schema 和主进程仍拒绝空序列。
- 不删除源素材、正式镜头或采用绑定，不改写历史成片；批次时间线不新增移出入口。已移出的镜头再次加入按现有建线规则使用完整时长，本轮不增加撤销栈或移出镜头区间缓存。
- 正式顺序验证、无声、100 镜头 / 600 秒、24 fps、首镜分辨率和 FFmpeg 管线不变；未增加任意重排、转场、字幕、音频、多轨、草稿历史栈、云同步。未运行 CompShare、Packy、SenseNova 付费生成或付费 E2E。

离线验收沿用 `npm run test:smoke -- --grep "formal project offline"`：保留部分勾选建线与导出命名检查；三镜建线后设置首镜 `0.25–0.75s`、末镜 `0–0.5s`，先预览中镜，再在时间线移出中间绿色镜头。核对勾选、无待应用提示、剩余区间和版本顺序；导航与冷启动后恢复两镜，连续预览和逐帧解码的 1 秒 / 24 帧 MP4 只有红→蓝，无绿色。随后保留两镜/三镜历史标签检查，逐行移出至空，验证保存修订增长、导航/冷启动不复活镜头、空状态不能播放/导出，重新勾选仍需建线。最后核对 `generation_records`、`ai_tasks`、`production_batches` 均为零。

单元测试补充从单镜草稿保存为空、数据库重开、旧修订拒绝覆盖、空导出在 schema 与主进程两层阻断，以及空草稿可再次建线。

本地证据（不提交）：`test-results/formal-project-timeline-removed.png`、`test-results/formal-project-timeline-empty-restored.png`，以及既有部分选片恢复截图、红蓝 MP4 和导出标签截图。日志：`test-results/build-timeline-remove.log`、`test-results/unit-timeline-remove.log`、`test-results/smoke-timeline-remove.log`。

最终门禁：`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:unit`（508 / 508，约 102 秒）、`npm run test:smoke`（44 / 44，约 3.9 分钟）、`git diff --check` 全部 PASS。构建仅有现有 Zod 注释的非阻断 Rollup 提示。完整单元测试含本地 HTTP fixture，桌面测试需启动 Electron，沿用获准的沙箱外隔离目录执行；TEMP/TMP 指向工作区 `test-results/tmp`。

门禁通过后立即在当前分支提交并推送 origin，不强制推送；用户原有未跟踪文件保留。
