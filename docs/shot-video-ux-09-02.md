# 09-02 正式项目选片与成片

验收日期：2026-10-27。工作分支：`codex/09-01-test-ready-alpha`。

## 可见操作路径

1. 打开正式项目，进入创作阶段「分镜视频」。
2. 选择镜头，点击「导入本地 MP4 候选」；批次与单镜头生成的候选也使用同一审看区。
3. 预览后点击「批准」。此时正式镜头的视频绑定仍为空或保持原确认版本。
4. 点击「设为当前镜头视频」，明确更新正式镜头的视频绑定。
5. 在「项目成片」点击「用已确认视频建立时间线」。按集、场、镜头顺序使用有效的确认版本；未确认或无效绑定会显示跳过数量。
6. 调整每镜入点、出点，可连续预览。点击「合成并导出 MP4（不生成新素材）」直接使用当前编辑区间，无需先保存批次时间线。
7. 在原生保存窗口选择位置。取消保存会明确提示文件未保存，但已入库的成片仍保留。
8. 「已导出成片」可以预览、载入剪辑记录并再次导出；重启后仍可载入。采用版本或正式顺序变化时阻断旧时间线，需重新建立。

「批量生成与批次历史」保留既有批次入口。批次时间线也可直接保存当前区间后导出，避免编辑区间与后台已保存区间不同步。

## 实现文件

| 文件 | 改动 |
| --- | --- |
| `src/features/shot-videos/ShotVideosCreatorPage.tsx` | 正式镜头的本地视频候选导入、独立成片入口、批准/采用状态文案、折叠批次区 |
| `src/features/shot-videos/ProjectVideoSequence.tsx` | 从有效确认版本建立时间线、成片导出、取消提示、历史预览及载入 |
| `src/features/shot-videos/VideoTimeline.tsx` | 当前区间导出、区间/总时长/旧绑定检查、顺序及镜头名称展示 |
| `src/features/shot-videos/VideoBatchPanel.tsx` | 批次导出当前编辑区间；编辑时禁用后台旧区间导出按钮 |
| `src/features/shot-videos/shot-videos-creator.css` | 成片区、可滚动时间线表格、按钮换行 |
| `src/shared/shot-order.ts` | 跨进程共用的集/场/镜头排序纯函数 |
| `src/features/storyboard/storyboard-model.ts` | 沿用并重新导出共用排序，保持既有调用入口 |
| `src/shared/video.ts` | 为已有 `video.import` 命令增加可选项目内镜头目标 |
| `src/shared/video-batch.ts` | 增加严格限定剪辑列表的 `exportSequence` 命令，无任意文件路径输入 |
| `electron/main/video/service.ts` | 校验导入目标，保存归属明确的草稿；相同媒体导入不同镜头保留独立候选 |
| `electron/main/video/sequence-export.ts` | 复用本地编码；按正式故事顺序验证，编码后及入库前再次检查确认绑定与顺序 |
| `electron/main/ipc.ts` | 从受信 IPC 直接调用本地序列导出，不依赖生成供应商；主进程原生保存窗口限定输出位置 |
| `tests/fixtures/sequence.ts` | 纯本地红/蓝 MP4 与跨场次镜头 fixture，无 HTTP 或供应商 |
| `tests/unit/sequence-export.test.ts` | 正式确认门槛、跨场次排序、裁剪时长/帧颜色、越界/重复/跨项目/过期绑定阻断 |
| `tests/unit/video.test.ts` | 项目内候选导入、相同字节跨镜头归属、取消、非法目标及零生成 |
| `tests/electron.spec.ts` | 原生文件选择到正式确认、时间线预览、MP4 保存、重启载入及取消保存的完整离线 UI 验收 |
| `README.md` | 新入口、操作、输出规格、限制与复现命令 |

没有新增数据库迁移、生成适配器、依赖或 preload 权限。

## 离线验收证据

定向命令：`npm run test:smoke -- --grep "formal project offline"`。

该用例在隔离用户目录创建两个本地 MP4，通过正式界面导入到不同场次的镜头，分别批准、采用。两个场次重新从本地镜序起算，仍按正式故事顺序输出。裁剪设置为 `0.25–0.75s` 和 `0–0.5s`，FFprobe 验证成片时长为 `1s`（容差 `0.05s`）。连续预览到第二镜，重启后载入相同入点、出点，并验证取消保存提示。

单元测试另外解码成片起始与 `0.7s` 的画面，确认先红后蓝，验证编码顺序而非仅核对元数据。UI 用例结束时 `production_batches=[]`、`generation_records=0`、`ai_tasks=0`，不需要生成服务。

本地截图：`test-results/formal-project-sequence-1920.png`。测试日志：`test-results/unit-09-02.log`、`test-results/smoke-09-02.log`。这些产物被 Git 忽略。

Windows 沙箱最初限制系统临时目录内的重命名及现有 loopback HTTP fixture；正式门禁使用工作区内 `test-results/tmp` 作为 TEMP/TMP，并在获准的沙箱外运行完整单元/桌面测试。没有通过修改生产逻辑绕过限制。

最终门禁结果：

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test:unit` | PASS，504 / 504，约 88 秒 |
| `npm run test:smoke` | PASS，44 / 44，约 3.3 分钟，含新增离线成片用例 |
| `git diff --check` | PASS |

构建仅出现现有 Zod 依赖注释的非阻断 Rollup 提示。全部验证均未执行真实 CompShare / Packy 付费生成。

## 当前限制

- 输出最多 100 镜头、600 秒，首镜分辨率、24 fps、无声 MP4；需要本机 FFmpeg / FFprobe。
- 当前项目入口使用全部有效确认镜头；不提供任意重排、部分镜头选择、转场、字幕、音轨或混音。
- 未导出的项目时间线草稿离开页面后不保留；导出记录随成片元数据持久化。
- 不执行真实付费 E2E，不将本地 fixture 验收视为供应商生成质量或权限验收。
