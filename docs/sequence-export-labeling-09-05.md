# 09-05 正式项目成片导出命名与历史标签

日期：2026-10-27。分支：`codex/09-01-test-ready-alpha`。

- 正式项目「项目成片」保存窗口建议 `项目名-成片-N镜头.mp4`，使用本次实际导出镜数。项目名保留中文，替换 Windows 非法字符及控制字符，移除末尾点/空格，处理设备保留名；最多保留 60 个 Unicode 字符，空名回退为“项目”。保存目录和最终文件名仍由原生窗口选择。
- 新入库素材名为 `成片 · N 镜头`，两镜部分成片与三镜成片无需播放即可区分。
- 同项目、同镜数的多次导出仍可能建议同名；可在原生保存窗口自行改名。本轮不增加唯一时间戳或导出版本栈。
- 「已导出成片」行从各自已有 `metadata.sequence` 读取镜数，并保留日期、时长、分辨率。导航、重启或当前草稿变为三镜后，两镜历史仍显示两镜。旧成片无可识别序列时显示“镜数未知”；不改写旧素材名称或猜测镜数。
- 仅改标签与文件名建议；未新增 schema、迁移、preload、权限或依赖。原批次保存窗口仍沿用原文件名，此次只覆盖正式项目路径。
- 无声、最多 100 镜头 / 600 秒、24 fps、首镜分辨率、正式故事顺序验证和 FFmpeg 管线保持原样。不增加任意重排、转场、字幕、音轨或混音、草稿历史栈、云同步。未运行 CompShare、Packy、SenseNova 付费生成或付费 E2E。

离线验收沿用 `npm run test:smoke -- --grep "formal project offline"`：三个本地红/绿/蓝 fixture 经导入、批准、采用；先排除绿色镜头建两镜草稿，验证导航和冷启动恢复、24 帧红→蓝输出及取消保存。拦截原生保存窗口实际参数，检查带非法字符的项目名 `离线:雨夜/来信?` 得到 `离线_雨夜_来信_-成片-2镜头.mp4`；再全选重建并导出，建议文件名变为 `…-3镜头.mp4`。同页历史同时显示两镜、三镜，素材库名称也分别核对，生成记录、AI 任务、生成批次均为零。

单元测试覆盖文件名清理、设备保留名、空名、长名/emoji、历史缺失/畸形记录回退，实际两镜/三镜导出名称与镜数，并保留正式顺序、区间、过期绑定、项目隔离、草稿持久化检查。

本地证据（不提交）：`test-results/formal-project-export-labels-1920.png`；日志 `test-results/unit-export-labeling.log`、`test-results/smoke-export-labeling.log`、`test-results/build-export-labeling.log`。此前部分选片恢复截图和 MP4 仍由同一用例产出。

定向离线 smoke 已通过。完整单元测试包含本地 HTTP fixture，桌面测试需要启动 Electron，沿用已验证的沙箱外执行方式；TEMP/TMP 指向工作区 `test-results/tmp`，用户目录均隔离。最初类型检查发现测试中空元数据与其他样例合并后推断出可选 `undefined`，已修正测试样例类型，之后 lint、typecheck、build 均通过；构建仅有现有 Zod 注释的非阻断 Rollup 提示。

最终门禁：`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:unit`（507 / 507，约 106 秒）、`npm run test:smoke`（44 / 44，约 4 分钟）、`git diff --check` 全部 PASS。按要求在门禁通过后立即提交并推送当前分支，保留用户原有未跟踪文件。
