# 09-04 项目成片部分选片

验收日期：2026-10-27。分支：`codex/09-01-test-ready-alpha`。

## 新增行为

- 正式项目 → 分镜视频 → 项目成片，列出全部有效确认镜头，显示集、场、镜号和名称；沿用正式故事顺序，可用鼠标或键盘勾选、全选、清空。
- 首次无草稿时默认全选。建立或重新建立时间线仅使用勾选镜头；空选显示“请至少选择一个已确认镜头”，禁用建线。100 镜头上限按选中数量计算，可从更多确认镜头中选取子集。
- 沿用 `sequenceDraft.clips` 保存所选镜头、采用版本和入点/出点，无数据库、IPC、依赖或权限变更。离开页面、冷启动、载入历史成片均恢复相应勾选。
- 重新建立时保留仍选用同一视频的已有区间；新加入或换版本的镜头使用完整时长。无效区间仍保存并阻止导出。
- 勾选需点击建立或重新建立后才应用并保存；未应用的勾选不单独持久化，导出继续使用下方时间线。界面显示未应用提示。

## 离线验收

`npm run test:smoke -- --grep "formal project offline"`：本地红、绿、蓝 MP4 经正式 UI 导入、批准、采用，三个确认镜头中排除中间绿色镜头，只以红、蓝两镜建线。覆盖空选阻断、键盘勾选、全选后重建、恢复草稿勾选和剪辑区间、未导出时导航往返与冷启动、历史载入及取消文件保存。

裁剪区间为 `0.25–0.75s` 和 `0–0.5s`，FFprobe 检查输出约 1 秒；逐帧解码 24 帧，前 12 帧红、后 12 帧蓝，所有帧绿色通道均低于阈值，确认被排除镜头没有进入 MP4。数据库检查生成记录、AI 任务及生成批次均为零。单元测试同时覆盖子集导出、草稿仅保存所选镜头、空序列与非正式顺序阻断，以及既有跨项目、过期绑定和草稿冲突检查。

本地证据（不提交）：`test-results/formal-project-partial-restored-1920.png`、`test-results/formal-project-partial-sequence-1920.png`、`test-results/formal-project-partial-sequence.mp4`、`test-results/unit-partial-select.log`、`test-results/smoke-partial-select.log`、`test-results/build-partial-select.log`。

沙箱内定向 smoke 因 Electron 无法启动失败；获准后在沙箱外使用隔离用户目录重跑。完整单元测试含本地 HTTP fixture，同样在获准的沙箱外执行；TEMP/TMP 指向工作区 `test-results/tmp`。

截图检查修正了全局输入框宽度影响复选框的样式。全量首轮为 43 / 44：新可视断言检查时页面尚停在下方审看区，已先滚回选片区；随后定向复验发现原有宽泛的状态定位器会同时匹配播放器加载状态，已按导出结果文案限定。修正后定向流程通过，再运行最终全量门禁。

## 保持的限制

- 最多 100 镜头、600 秒，首镜分辨率、24 fps、无声 MP4，依赖本地 FFmpeg / FFprobe。
- 所选镜头始终按正式集、场、镜头顺序排列；不增加任意重排、转场、字幕、多轨或混音。
- 重新建立会替换单份草稿；沿用原有修订冲突与保存失败重试机制，不增加草稿历史或云同步。
- 未执行 CompShare、Packy、SenseNova 真实付费生成或付费 E2E。

## 门禁

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test:unit` | PASS，505 / 505，约 86 秒 |
| `npm run test:smoke` | PASS，44 / 44，约 3.6 分钟 |
| `git diff --check` | PASS |

构建仅出现现有 Zod 注释的非阻断 Rollup 提示。本轮本地提交，不推送；用户原有未跟踪文件保留。
