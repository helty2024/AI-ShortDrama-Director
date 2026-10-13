# 09-00 · CompShare MiniMax H3

Real Video Provider Non-Paid Integration Baseline，基于正式 v0.8.0 / `bbba06ab156a299865f04212555865bb72434c02`。

## 状态与边界

原生协议实现及本地 fixture 验证完成。2026-10-12 后续测试已按用户授权导入本机密钥并通过真实积分接口鉴权；**真实生成、供应商 CDN 与费用结算仍未验收**。没有调用真实任务接口或提交付费视频。`REAL_PAID_VIDEO_TEST=false`。

package 保持 `0.8.0`、SQLite schema `10`、backup format `5`。不新增数据库迁移，不改变旧 Provider、Tool Protocol、Approval/Reservation 或 Workflow 数据结构。历史已确认视频仍可审看。

## 协议依据

2026-10-12 核对 [CompShare 官方 MiniMax H3 视频任务 API](https://www.compshare.cn/docs/minimax-h3/api/minimax-h3-video-api)。这是 CompShare 专用协议，不是旧 Reference Video Protocol，也不代表直连 MiniMax、Hailuo 2.3 或其他网关兼容。

| 动作 | 固定路径 / 原生字段 |
| --- | --- |
| submit | `POST https://cp.compshare.cn/minimax/v2/video_generation`；`task_id` |
| status / result / recover | `GET /minimax/v2/query/video_generation/{task_id}`；`task.id/status/content.url` |
| cancel | `DELETE /minimax/v2/video_generation/{task_id}`；`task_id/action/status` |
| 手动只读检测 | `GET /minimax/v2/query/point_usage_summary` |

独立 `CompShareMiniMaxH3Adapter` 与 Reference `VideoApiAdapter` 分别继承通用 `VideoLifecycleAdapter`。基类只处理授权归属、异步生命周期及受控输出下载；两种协议各自实现任务路径、请求体和响应映射，通用运行配置 schema 位于 `src/shared/video-tool-profile.ts`。CompShare Profile 与配置/探测命令分别位于 `src/shared/compshare-minimax-h3.ts` 和 `electron/main/generation/compshare-minimax-h3-profile.ts`，不再混入通用 Video API。Reference 协议的工具/版本身份检查与不明响应冻结保持不变。

本地支持子集：`MiniMax-H3`；文生视频与项目内首帧/首尾帧；4–30 秒整数；一条 MP4 输出；原生 `480P`。公开契约支持的五种画幅只采用官方尺寸表：16:9 为 864×480、9:16 为 480×864、1:1 为 480×480、4:3 为 640×480、3:4 为 480×640。

首尾帧由主进程读取项目 AssetVersion 字节并映射为 Data URL，明确上传授权后才允许 fixture 提交。图片 MIME 白名单、单图 30 MiB 和总请求 72 MiB 上限在本地检查。设置 `mute_audio=true`、`use_context_ir=false`。seed、独立 negativePrompt、有声生成、21:9/adaptive、多模态参考、Skill、Context-IR、回调和超分档位不开放；不会默默丢弃非空 seed/negativePrompt。官方未明确输出 FPS 控制，因此不发送 fps，也不将输入 fps 宣称为已验证的输出帧率。

## 非付费门禁

正式 Adapter 的 `generationEnabled=false`，无配置项、环境变量或 renderer 开关可以打开真实 submit。服务在预览创建 Prompt/Task 前拒绝；适配器在读取凭据、上传或发出 POST 前再次拒绝。Broker health 保持 unknown/unavailable，因此不会成为可执行 AUTO 候选。

`profiles` 只投影可执行工具，Creator 仍显示“尚未配置可用的视频生成工具”；单独的 `configuration` 投影只用于设置页展示已注册但禁用的配置。不能用配置存在代替生成就绪。

只有显式构造、精确 `http://127.0.0.1:<port>` 的 fixture transport 才能走本地协议测试。应用组合不会为 CompShare 注入该 transport。正式远端取消同样关闭；本地模拟取消响应为 running 时返回 unknown，保留任务与预算，不能把请求取消当成已取消。

本地 fixture 的 H3 POST 使用 `Idempotency-Key: asd-h3-<taskId>`；taskId 是本次 generation attempt 的任务 UUID，同一 attempt 稳定，新任务不同。HTTP transport 只接受经校验的 ASCII、非空且不超过 128 字符的窄字段；renderer 不能提供 HTTP header。真实 submit 仍关闭。

官方示例未提供可核实的生产输出 CDN，生产下载 host 白名单留空并拒绝远端下载。fixture 下载复用既有 HTTPS/DNS/SSRF/重定向/大小约束、MP4 magic、FFprobe 和 thumbnail 入库；下载不带 API Key。真实 CDN 验证留给后续步骤。

## 本地配置与只读检测

独立测试入口（无需进入当前设置页）：

```powershell
npm run validate:compshare                         # 读取已保存的加密凭据，GET 检测
npm run validate:compshare -- --configure          # 通过系统文件选择器首次导入
npm run validate:compshare -- --import-key-file "C:\path\minimax-h3-key.txt"
```

命令只接受上述选项，不允许自定义端点、明文密钥参数或付费开关。隐藏的 Electron 检测进程使用现有 safeStorage，独立于项目 UI；不打开数据库、不启动生成服务、不建立任务。正常启动清除测试 userData / fixture 环境变量；只在显式隔离测试进程注入 loopback fixture。检测结果以脱敏 JSON 写入 userData 下 `diagnostics/compshare-connectivity.json`，不含密钥、认证头、原始响应或素材。

2026-10-12 14:17（北京时间），用户授权首次导入密钥；真实 `GET /minimax/v2/query/point_usage_summary` 返回鉴权成功，总积分 / 预占 / 可用均为 0。这是鉴权与账户余额验证，不证明生成权限、视频质量或免费生成。真实鉴权完成后，临时明文 Key 文件已删除；凭据目前仅通过系统加密 CredentialStore 保存。没有改动用户项目数据库。

打开项目 → 项目设置 → CompShare · MiniMax H3 → **导入 CompShare API Key（加密保存）**，通过系统文件选择器选择包含 `sk-ml-` 模型密钥的本地文本文件。文件不会复制进项目，密钥仅由主进程读取并交给既有 CredentialStore / Electron safeStorage；加密不可用时拒绝保存。请在导入后妥善处理原始密钥文件，不要提交到 Git。

`userData/compshare-minimax-h3-profile.json` 只保存固定 adapter/tool/model 与 credential UUID。09-00A 测试期间产生的旧 `video-api-profiles.json` 会在首次加载时只复制有效的 Provider Profile 和原有 credentialRef；旧文件保留，不读取或解密密钥，迁移失败时拒绝继续。新旧文件不会注册两份 Provider。导入不会探测网络；启动不自动请求云端 API；恢复配置仍为不可执行。当前只支持首次配置，不提供密钥替换；重复和并发导入拒绝，已有配置文件保持原样。

**检测鉴权与积分（不生成）** 是用户主动的 GET，返回脱敏积分汇总、检查时间和错误代码。不会创建 AITask、GenerationRecord、Approval 或 Reservation，也不上传项目素材。成功仅证明当次积分接口鉴权，不证明模型生成权限、质量、CDN 或付费 E2E；重启不保留这次探测结果。工具状态刷新只检查本地凭据，仍标记 configured-unverified。

积分与 `usage.total_seconds` 不作为 CNY actual cost，不虚构免费/零费用。基线估价为 unknown；本地 fixture 成功也继续持有待核对的预算。submit 超时、断连或无有效 task_id 冻结为 unknown-submission，禁止重提。已知任务恢复只查询原 ID。

## 验证

```powershell
npx tsx --test tests/unit/compshare-minimax-h3.test.ts
npm run lint
npm run build
npm run test:unit
npm run test:smoke
```

专用 27 项行为测试覆盖字段映射、预检零副作用、生成门禁、帧上传许可、积分错误与零余额、HTTP 401/429/500、任务身份、未知提交、重启 submitCount=1、无认证输出下载、HTML/损坏 MP4/危险 URL、真实 FFprobe、Candidate → Review → Adopt、配置持久化、并发导入保护及窄 IPC。测试 MP4 由 FFmpeg 在临时目录生成，不提交二进制媒体。Electron 新增配置恢复、设置状态及 IPC 注入拒绝验证，全程隔离 userData。

2026-10-12 本机最终门禁：lint / build 通过，unit **422/422**，Electron smoke **23/23**。桌面门禁在允许 Electron 子进程的本机环境运行。新增重启测试已修正为等待页面完成加载再退出，避免加载途中关闭引发 ERR_FAILED。中间一轮既有 ComfyUI workflow 取消恢复用例发生间歇失败，单独复核及最终完整回归均通过；未改动该用例或 ComfyUI 生产实现。构建仅有既有 Zod 注释 annotation 提示。

后续真实鉴权测试门禁：lint / build 通过，unit **424/424**，Electron smoke **24/24**。新增独立检测的系统加密、重新启动解密读取、原数据库字节不变、HTTP 401 与脱敏报告验证。真实只读检测在 14:17、14:19（北京时间）两个独立进程中均成功，第二次直接读取已保存的凭据，没有重复导入。

后续真实验收需要独立任务：确认生产输出域名、真实能力与费用证据，完成一次明确授权的视频 E2E，再决定是否开放真实生成。本轮不发布新版本或安装包。
