# 全链路 V1.1：P0 离线整改验收表

日期：2026-10-20。基线为 `codex/09-01-test-ready-alpha` 当前未提交工作区；保留此前修改，未切分支、未提交代码。本次供应商生成调用 **0 次**，无收费返工、无自动重试或供应商切换。以当前构建的 Windows Electron 应用验收，未使用旧安装包作为整改证据。

**结论：离线可执行项目已完成；不能宣布全链路或抽卡部门叙事生产 PASS。** 原七镜的“人物不一致、叙事镜头衔接不上”内容 FAIL 保持，原项目正式采用视频为 0。

| P0 项 | 当前能力 | 代码及测试证据 | 状态 | 已修复问题 | 尚缺功能/条件 | 本次是否收费 | 后续真实验证最小请求及费用上限依据 |
|---|---|---|---|---|---|---|---|
| P0-1 H3 真实输入协议 | 原生 480P 文生/首尾帧；明确 first/last 与多参考互斥。镜 5、6 均规划生成 5s、剪辑 4.5s；起止状态和跨镜头目光/光线/道具连续性已成文。 | [请求体校验](../electron/main/tools/adapters/compshare-h3-contract.ts)、[真实适配器映射](../electron/main/tools/adapters/compshare-minimax-h3.ts)、[互斥契约测试](../tests/unit/compshare-h3-contract.test.ts)、[原生协议测试](../tests/unit/compshare-minimax-h3.test.ts)、[首尾帧执行方案](p0-v11-input-plan.md)。 | **PASS：离线协议及设计**；真实叙事验证 **BLOCKED**。 | 构造后严格校验请求体；非法混用、重复帧角色、非整数时长等不能提交。角色参考不能冒充镜头首帧。 | 正式林夏主参考未采用；5A/5B/6A/6B 尚无批准版本 UUID。多参考素材模式未接入，不标为可用。 | 否 | 具备人工批准状态图后，最少 **2 次 H3**，各 5s，合计 **50 积分**（官方 480P 5 积分/s）；人民币未知，另行授权。不包含收费制帧或返工。 |
| P0-2 生产安全门禁 | 默认叙事生产；核验角色主参考、镜头批准关键帧、批准/采用指针、项目/UUID/修订/hash、批准项与任务指纹。独立技术测试有明确标签。 | [共同资产门禁](../electron/main/generation/video-production-gate.ts)、[预览/确认/执行前检查](../electron/main/generation/video-api-service.ts)、[工作流入口](../electron/main/workflow/service.ts)、[批次冻结证据](../electron/main/generation/video-batch.ts)、[图像费用门禁](../electron/main/generation/image-service.ts)、[负向及并发测试](../tests/unit/video-batch.test.ts)、[桌面默认阻断测试](../tests/alpha.spec.ts)、[实际 Windows IPC 负向证据](../test-results/p0-v11/desktop-negative-gates.json)。 | **PASS：门禁**。正式叙事准备状态仍 **BLOCKED**。 | 取消缺关键帧时静默回退；批次证据持久化并规范字段顺序；正式资产变化需重新授权；图像/视频未知收费拒绝零/负预算；旧无指纹预算视频入口关闭新增云端提交。 | 需人工采用主参考并批准关键帧。门禁不替代视觉质量审核，也不保证供应商未知货币收费硬封顶。 | 否 | 门禁验证 **0 次收费请求**。后续生成仍按明确范围单独授权；本次没有创建可消耗的新收费授权。 |
| P0-3 Packy 图生图 | `gpt-image-2` 单图编辑映射，`/v1/images/edits`、multipart `image`、n=1、显式尺寸/PNG/高输入保真度；输入完整解码、受控输出校验及候选入库。 | [适配器](../electron/main/tools/adapters/packy-image-25.ts)、[生产映射](../electron/main/generation/production-packy.ts)、[模型声明](../src/shared/packy-models.ts)、[上传/下载/入库/候选契约测试](../tests/unit/packy-image-25.test.ts)、[脱敏当前配置](../test-results/p0-v11/isolation.json)、[最小离线请求](../test-results/p0-v11/packy-edit-offline.json)、[已有输入图](../test-results/p0-v11/packy-edit-input.png)。 | **PASS：本地协议**；**BLOCKED：当前账户真实编辑验证**。 | 移除 gpt-image-2 文生图专属误判；所需分组修正为 sora；上传校验前不消耗原生测试许可；保留 unknown、下载安全和不自动采用规则。 | 实际 r2 凭据目录不记录令牌分组；未证明为 sora。未真实执行编辑，不借用文生图成功证据。 | 否 | 最少 **1 次单图编辑**。当前价格/人民币上限未知，不能记 0，也不能套用 Sunburst 旧报价；须先确认分组、报价或供应商侧限额，再另行授权。 |
| P0-4 应用内合成导出 | 正式镜序、已采用素材进入时间线、入出点、相邻及连续预览、应用内 FFmpeg 合成、系统保存 MP4、播放与重启恢复。 | [时间线 UI](../src/features/shot-videos/VideoTimeline.tsx)、[受控合成](../electron/main/video/sequence-export.ts)、[持久化 IPC](../electron/main/ipc.ts)、[剪辑/错误区间/重启测试](../tests/unit/video-batch.test.ts)、[七条真实旧素材的桌面操作记录](../test-results/p0-v11/desktop-result.json)、[桌面截图](../test-results/p0-v11/desktop-timeline.png)、[重启播放截图](../test-results/p0-v11/desktop-restart-export.png)。 | **PASS：Windows 本地技术验收**；不构成部门内容通过。 | 补齐剪辑区间保存和连续预览；只接纳本批次已批准采用版本；校验顺序、hash、项目归属、区间及并发选片变化；导出实际时长校验后入库。 | 当前只输出无声；声音要求待确认。当前七镜内容仍 FAIL。没有把技术副本的批准迁移至正式项目。 | 否 | **0 次生成请求**。已用既有七视频免费完成，不需要另做单镜头 API 演示。 |

## Windows 实际操作与时长

使用当前 `out/main/index.js` + `out/renderer` 的真实 Electron 应用，关闭 Alpha fixture runtime；测试副本没有供应商凭据。经正常审片/批准/采用控件处理七条现有视频，选择时间线、设置入出点、连续预览、点击应用内合成导出按钮，并由应用写出 MP4。导出路径由验收脚本提供，原生保存对话框本次未做人手点击验证；合成、入库、文件写出和播放均执行应用代码。没有用外部脚本拼片作为通过证据。

正式项目及旧媒体未改动。隔离副本的批准只代表技术路径测试，不是人工画质认可。正式库校验结果见 [source-integrity.json](../test-results/p0-v11/source-integrity.json)：七条视频仍 rejected、采用数 0，林夏人像仍 draft、16 条旧草稿 pending，实体/素材版本摘要未变，任务和 GenerationRecord 数量未增加。

- 七条输入合计 **36.166667s**，原分镜建议 **31s**；历史镜头 `247c6ec7-7839-4f5c-9cdf-f807818e8e56` 未进入时间线。
- 本地测试只把镜 5、6 各剪为 **4.5s**，其他素材保持原长，合计及实测输出 **34.833333s**；未自行把正式项目裁到 31s。
- 测试成片为 480×864、24fps、MP4/H.264、无声；七段均可播放，镜 5→6 相邻预览、镜 1→2 自动接续及重启后的成片播放通过。
- 测试导出版本 UUID：`c9ff0414-41f3-4634-b3b6-3a4136dd2bc4`，仅存在隔离项目。
- [本地技术成片](../test-results/p0-v11/seven-shot-offline-technical-only.mp4)，不是正式交付成片。

## 自动化结果及局限

- [lint](../test-results/p0-v11/lint.log) 和 [build](../test-results/p0-v11/build.log)：通过。
- [全量 unit](../test-results/p0-v11/unit-complete.log)：**480/480**。
- 此后新增一项完整编辑候选入库测试；[Packy 编辑/恢复组](../test-results/p0-v11/edit-ingestion-recovery.log) **40/40**，含该新增测试。
- [最后功能变更相关组](../test-results/p0-v11/final-change-regression.log)：**62/62**，包含图像零预算阻断、免费本地兼容、历史批次技术分类。
- [全量桌面 smoke](../test-results/p0-v11/smoke.log)：**43/43**；最后功能变更后 [Alpha/生产服务相关 smoke](../test-results/p0-v11/final-change-smoke.log)：**12/12**。
- 曾遇到原取消恢复测试竞态：测试在收到 POST 后立即切换 fixture 完成状态，早于收到远端身份和首次 running 观察；已把同步点改为首次队列观察并断言 providerTaskId，保持原有取消/费用/不重发断言。最终全量通过。未把失败日志冒充通过。
- 所有 fixture/本地媒体测试仅证明本地行为，不作为供应商成功验证；本次真实生成请求 0 次。

## P1 与下一步边界

[镜头 5、6 首尾状态、待审核图片槽及声音需求表](p0-v11-input-plan.md) 已准备。H3 `mute_audio=true` 会移除整个音轨；本机导出 `-an`，不能宣称对白、音色或同步已实现。对白、旁白、音色授权、环境音、音效、音乐和同步均待部门确认。

下一步先审核林夏主参考和具体状态图；收费验证须另行给定预算。无需新增收费请求就能继续人工导入素材、批准关键帧和本地剪辑。当前未替换旧 Windows 安装包，旧包不代表本次 P0 修复；当前构建可通过 `npm run preview` 启动。不会自动生成、重试或开始下一阶段。
