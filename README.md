# AI ShortDrama Director

面向 AI 短剧创作的本地桌面工作台，基于 React + TypeScript + Electron。

## 09-02 正式项目选片与离线成片

在创作阶段 **分镜视频** 中，选择镜头 → **导入本地 MP4 候选**（或审看批次/单镜头生成结果）→ **批准** → **设为当前镜头视频**。导入不会自动批准或采用；同一个文件可作为不同镜头各自的候选。

在同页 **项目成片** 的 **选择成片镜头** 中勾选要使用的有效确认镜头（首次默认全选，可全选或清空），再点击 **用已确认视频建立时间线**，只按集、场、镜头顺序加入勾选的版本。未确认或绑定失效的镜头会明确计数并跳过。空选和超过 100 个选中镜头会显示中文提示并禁用建线；可从超过 100 个有效确认镜头中选择最多 100 个。调整入点、出点，连续预览后点击 **合成并导出 MP4（不生成新素材）**，选择保存位置。当前编辑区间直接用于导出，无需创建生成批次或配置生成服务。仅在本机使用 FFmpeg / FFprobe，最多 100 镜头、600 秒，统一为首镜分辨率、24 fps、无声 MP4；不含转场、字幕、音乐或混音。

成片和剪辑来源入库后可在 **已导出成片** 中预览、载入时间线再次导出，重启后仍可读取。取消文件保存仍保留入库成片。项目时间线草稿自动保存到本地 SQLite 项目记录，包括所选镜头、采用版本、顺序和入点/出点；显示保存成功后，即使尚未导出，离开页面和重启也会恢复时间线与勾选状态。暂时无效的区间同样保留，但阻止导出；保存失败会显示原因和重试入口。修改勾选后需点击 **按当前已确认视频重新建立时间线** 才会应用并保存；此前导出继续使用下方时间线。重新建立保留仍选用同一视频的区间，新加入或换版本的镜头使用完整时长。重新建立或载入历史时间线会替换当前草稿；尚未应用的勾选不单独保存。确认版本或正式镜头顺序改变后，旧时间线会阻断导出，需重新建立。**批量生成与批次历史** 收纳原批次入口，收费授权仍独立执行，本地成片操作不会调用生成服务。

离线 UI 验收：`npm run build` 后运行 `npm run test:smoke -- --grep "formal project offline"`。该用例创建本地红/绿/蓝 MP4，经正式界面导入、批准、采用，排除绿色镜头，仅为红、蓝两镜建线并裁剪，在未导出时离开页面返回、冷启动后自动恢复，再连续预览并导出，逐帧检查只有红、蓝画面、输出时长及零生成任务；截图位于 `test-results/formal-project-partial-restored-1920.png`、`test-results/formal-project-partial-sequence-1920.png`。本地媒体与测试产物不提交。选择行为与限制见 [部分选片](docs/sequence-partial-select-09-04.md)，草稿保存机制见 [项目时间线草稿持久化](docs/sequence-draft-09-03.md)。

文件改动、验收证据与当前限制见 [09-02 正式项目选片与成片](docs/shot-video-ux-09-02.md)。

## 09-01 公司内部 Alpha

Packy 图像服务支持显式选择 `gpt-image-2`，复用单张文生图的原生 Images API、自动尺寸与候选入库流程；该模型的参考图编辑映射保持关闭。修改模型创建新的服务修订并保留旧配置与历史任务。模型列表可见不代表真实生成权限已验证，旧模型的成功证据不会解锁新模型。每次真实生成仍需独立授权，费用未知，不自动重试或切换模型。

当前内部版本 `0.9.0-alpha.2`。普通工作流使用已配置并经过验证的真实服务，未配置时不会回退到 Mock。Story 整理调用默认文本模型，输出经现有 Schema 校验后供用户确认。模拟流程须在设置 → 高级与诊断 → 测试工具明确开启。批准与采用仍为两个独立操作。当前公司真实文本/图像/视频 E2E 尚未通过，不代表已可真实生产。

Windows 安装包：`npm run dist:alpha`，包含 FFmpeg / FFprobe，使用独立 Alpha 安装标识和数据目录。构建工具只写入被忽略的 `build/alpha-runtime/`；模拟回执与媒体保存在本机用户数据中，不进入 Git。详见 [09-01 范围、安装说明与测试门禁](docs/test-ready-alpha-09-01.md)。安装版验收脚本为 `scripts/verify-alpha.ts`；UI 草案 stash 保持原样。

2026-10-19 增加 SenseNova 6.8 Flash Lite 模板和 Packy Flare 模型选择，分别复用真实文本与原生图像执行路径；Flare 明确提示自动尺寸，只开放单张文生图。首个确认的故事请求可同时验证结构化协议，不额外发送收费探测。三模型各一次真实测试的范围、结果和未通过环节见 [三模型受控真实测试](docs/real-three-model-validation-2026-10-19.md)。模拟回归通过不能替代该报告中的真实验收。

设置默认打开 **AI 服务**，按文本、图像、视频、本地生成服务展示连接与生成验证状态。**基本设置**只修改当前项目偏好；**高级与诊断**保留专业配置、维护和测试工具。无需项目即可配置服务：本机 ComfyUI 连接存放在 `comfyui-service-settings.json`，保存后即时应用、只读检测；该文件不进入 Git。模板导入及旧版模拟参数在高级测试区，云服务的密钥导入仍由主进程加密处理。未确认或未结束的 ComfyUI 生成会阻止更改连接。

## 产品方向与目标架构

2026-10-19 已完成 [LocalMiniDrama 源码对比与落地清单](docs/localminidrama-comparison-2026-10-19.md)。文本 AI 设置增加 DeepSeek / 百炼 / 方舟连接模板，以及明确选择的 JSON 兼容方式；旧配置保持严格结构化协议，错误不自动降级或重发。修改服务地址需要重新录入对应密钥。分镜页可按当前筛选范围“导出分镜表”，生成可离线查看和打印的文字 HTML，不含密钥、原始 Prompt、媒体路径或媒体文件；这不是视频合成。

文本制作拆解与导演拆镜使用单次请求：请求体上限 128 KiB、输出上限 8192 token、文本与 HTTP 传输超时均为 90 秒；故事整理仍使用原有 4000 token 与结构化协议。失败任务仅保存脱敏的错误类别、HTTP 状态码、耗时及请求是否开始发送；未知结果不会自动重试或切换供应商。DeepSeek 和百炼模板需手动填写模型并设为默认。角色参考图提示词以项目设定为准，生成确认页会展示最终描述供审核。

产品主线为 **故事 → 剧本 → 资产 → 分镜 → 生成 → 分镜视频**，通过简单 UI 面向普通创作者。生成描述放在折叠区，PromptPackage 保留在内部。后台通过统一 Tool Protocol、validate / estimate、RoutingPolicy 和 GenerationRecord，按第三方 Image API → Video API → ComfyUI → Blender 顺序验证可替换工具；无限画布作为 Creator UI 的 ViewExtension。

正式基线：[Architecture Baseline v2 · Approved for implementation](docs/platform-architecture.md)；文件级施工计划：[Implementation Roadmap v2](docs/implementation-roadmap-v2.md)。批准实施不等于已经实现，0.6.0 尚无通用插件宿主、ComfyUI 托管启动或 ComfyUI 视频适配器。当前实现仍以以下版本记录及 [现有架构](docs/architecture.md) 为准，不将进程隔离宣称为完整安全沙盒。

当前正式稳定版为 **v0.8.0 RELEASED**。版本边界、安装升级与验收记录见 [0.8.0 Release 说明](docs/release-0.8.0.md)；历史候选版验收见 [0.8 RC 说明](docs/release-0.8.0-rc.1.md)。

09-00 新增 [CompShare MiniMax H3 非付费接入基线](docs/compshare-minimax-h3.md)：独立原生 Video Adapter、首尾帧 Data URL、固定原生 480P 子集、本地异步协议与真实 FFprobe 测试。设置 → AI 服务 → 视频 AI → 添加/设置服务可加密录入或更换 `sk-ml-` 凭据并手动 GET 检测鉴权/积分；默认真实 submit 关闭；仅由主进程在实际 MP4/CDN 验证后组合受控单次测试或已有生成证据的生产门禁，配置不会进入 Creator 可执行工具列表。真实视频生成、CDN 与付费 E2E 均未验证，积分不折算货币费用。package/schema/backup 保持 0.8.0/10/5，没有真实付费提交。专用测试：`npx tsx --test tests/unit/compshare-minimax-h3.test.ts`；新配置目录与操作详见该文档。

CompShare 独立检测入口：`npm run validate:compshare` 使用已加密保存的凭据，只 GET 查询积分余额；首次配置可运行 `npm run validate:compshare -- --configure`，直接打开系统密钥文件选择器，也支持 `--import-key-file <本机文件路径>`。无需打开项目或进入 Advanced Mode。密钥不会放进命令参数，只传文件路径；检测不打开项目数据库、不上传素材、不生成视频。Provider 配置保存在 userData 的 `compshare-minimax-h3-profile.json`；既有 `video-api-profiles.json` 中的 CompShare 配置会安全迁移，仅复制加密凭据引用。2026-10-12 本机真实鉴权已成功，余额为 0 积分；成功仅覆盖该只读接口，真实视频生成与 CDN 仍未验证。安全报告保存在 userData 的 `diagnostics/compshare-connectivity.json`。

0.8 Creator 主流程为**故事 → 剧本 → 资产 → 分镜 → 生成 → 分镜视频**；技术面板仍通过兼容入口可达。详见 [08-03](docs/story-script-creator-0.8.md)、[08-04](docs/assets-creator-0.8.md)、[08-05](docs/storyboard-generate-creator-0.8.md)、[08-06](docs/shot-videos-creator-0.8.md) 与 [Closeout](docs/creator-ui-closeout-0.8.md)。全新项目可直接在 Creator 界面创建首个镜头。打包桌面端尚无正式 Video Tool：新视频生成不可用，历史已确认视频仍可审看。正式版 package 为 `0.8.0`，SQLite schema `10`，backup format `5`。

Windows 隔离安装验收复用 `scripts/verify-0.8-rc.mjs`（可选第六参数 `0.8.0`）；`scripts/verify-0.8-final-upgrade.mjs` 用已安装的 0.7.0 / rc.1 创建含 confirmed 视频的临时项目，再验证正式包升级、媒体读取与离线诊断。用法和安全边界见正式 Release 文档，不使用真实用户项目或付费 Provider。

`npm run test:unit` runs test files serially because several local HTTP fixtures share process-level resources; individual test cases still execute normally.

07-01 已新增独立契约：`src/shared/tools.ts`、`capabilities/`、`routing.ts`、`generation.ts` 和 `electron/main/tools/`。九个生命周期动作与八种版本化能力均有类型/schema；新增 27 项纯契约测试。尚未接入应用调用、Routing 算法或数据库。package version 保持 0.6.0。

07-02 新增 [测试专用模拟工具](tests/fixtures/tools/README.md)：同步 Image 与异步 Video，34 项行为测试验证无副作用预检、状态链、未知提交防重提、请求归属、输出校验、取消/恢复与 Abort。运行 `npx tsx --test tests/unit/tool-behavior.test.ts`，或执行 `npm run test:unit` 运行完整测试。模拟工具仅在测试中使用，不代表真实服务验收，也未实现生产 Broker。

07-03 新增独立的 [Tool Registry / Routing / Broker Preflight](docs/tool-routing-preflight.md)：受信注册、纯 FIXED/AUTO 决策、无生成副作用预检、不可变审计快照、内存 ownership 与宿主输出签发。新增 30 项行为测试；可执行 `npx tsx --test tests/unit/routing.test.ts tests/unit/tool-broker.test.ts`。尚未连接旧生产入口或实现 submit、持久化、付费授权；内存状态不提供重启恢复。

07-04 新增 [Generation Provenance 持久化](docs/generation-provenance.md)：追加 SQLite v7，保存路由、估价、Prompt、生成尝试、多输出、导入来源及 Task 关联；输入快照不可变，失败历史保留。备份升级为 format 2/schema 7，继续支持旧 format 1/schema 6。新增 21 项测试；没有接入真实生成、费用授权或新 UI/IPC，应用版本保持 0.6.0。

07-05 新增 [Generation Approval / Budget Reservation](docs/generation-approval.md)：SQLite v8，独立单次/批次授权、总池与单项预算原子预留、未知提交持续持有、实际费用一致结算。备份升级为 format 3/schema 8，旧 v6/v7 备份仍可恢复，恢复授权仅为不可执行历史。主进程私有服务已建立；旧生成入口仍为 legacy path，尚未统一接入新授权。package version 仍为 0.6.0。

07-06 新增 [Third-party Image API Production Path](docs/image-api-tool.md)：Reference Adapter、有限制的 HTTPS transport、生成页最小 Preview/Confirm/Result 入口，串起 Broker → Approval/Reservation → Task/Record → 候选版本 → 人工采用。本地 HTTP 与桌面流程使用无费用 fixture 验证；未指定或验证真实供应商，未执行真实付费生图。旧 Provider 保持兼容，schema v8 / package 0.6.0 不变。

07-07 新增 [Third-party Video API Production Path](docs/video-api-tool.md)：独立 Video Adapter、文生视频/图生视频、异步 submit/status/result、cancel/recover、重启恢复、安全下载、真实 FFprobe、Candidate → Review → Adopt 与多输出来源关联。测试用 Reference Video Protocol 不代表 Seedance/Kling/Veo/Sora/Runway/Hailuo/Packy 兼容；本地 fixture 动态生成 MP4 并验证 `submitCount=1`。`REAL_PAID_VIDEO_TEST=false`，未注册或调用真实付费视频供应商。旧 Mock/Seedance 保持 legacy compatibility path，schema v8 / package 0.6.0 不变。

07-08 新增 [ComfyUI Optional ToolAdapter](docs/comfyui-tool-adapter.md)：外部用户自启的 loopback ComfyUI 以 `local-service` 与云端 Image API 并列注册，支持可信工作流预检、`object_info` 节点/模型检查、queue/history、项目版本参考图上传、`/view` 结果回收、FIXED/AUTO 路由、已知 prompt id 恢复和队列取消。新链路复用同一 Candidate → Review → Adopt；旧 ComfyUI Provider 保留兼容。应用不会启动、终止、安装或修改 ComfyUI。fixture 已验证协议；只有本机服务、明确 checkpoint 与可信模板全部就绪时才允许实机生成。

07-08.5 已在 2026-09-26 通过一次真实本地 SDXL 生成验收：1024×1024 PNG → Candidate → Review → Adopt；全新 Electron 进程恢复查询已完成的 prompt_id，累计 submitCount=1。可信模板 1.0.1 修正 sampler 常量绑定，SQLite schema 8 / package 0.6.0 不变。可运行 `node scripts/comfyui-local-validation.mjs --recover-only` 只读核对已完成验收；生成入口 `--confirm-one-local-image` 仅用于明确授权的一次性验证，已有持久化 intent 时拒绝再次提交。详见 [真实验证记录](docs/comfyui-local-validation.md)。

07-09 新增[最小工作流编排](docs/workflow-orchestration.md)：Shot 关键帧与 Shot 视频两条固定流程，生成前费用确认、生成后独立审核与采用，持久化步骤及任务关联，重启只恢复既有任务。SQLite 追加 v9，备份 format 4 保留编排历史并禁止恢复副本继续执行；package 版本不变。生成页提供最小创建、状态、继续与取消入口。

07-10 已完成 [0.7 Compatibility Closeout](docs/compatibility-closeout.md)：Legacy、Direct Tool Generation 与 Workflow Generation 明确分流；素材可只读反查完整 Generation/Task/Routing/Prompt/Workflow 来源，旧素材显示 `Legacy / provenance unavailable`。Settings 增加 Validation Status 与当前 Runtime Status 分离的只读工具表；Reference 工具保持开发隔离。format 1/schema 6 至 format 4/schema 9 备份均可恢复且永不复活执行权。当前真实验收边界为 ComfyUI Local VALIDATED、Packy Image PARTIAL REAL VALIDATION、Real Video Provider NOT VALIDATED。package 仍为 0.6.0，正式 0.7.0 版本号和安装包留给独立 Release Candidate。

契约 v1 的文本结构化能力限于有名的 string/number/boolean 字段，媒体转码限于视频，场景能力仅为预演/静帧渲染输入输出；后续扩展须升级能力契约，不使用任意 JSON 配置。图片最多 8 张参考图，具体工具可声明更小上限；工具约束检查和输入/输出关联检查由后续 validate/Broker 执行。金额以整数微单位及币种表达，未知费用/耗时独立标记。结果只返回受控 handle，不返回任意路径或 URL。

`requestFingerprint` 是主进程纯函数：Zod 校验后按对象键排序进行 SHA-256，数组顺序保留；包含能力输入、来源 revision、工具/模型、版本和必要的路由语义。排除时间戳、随机运行/决策 ID、UI 状态和密钥。决策 ID 变化单独使预检/授权引用失效，不通过加入随机 ID 破坏语义哈希稳定性。27 项新增测试不启动 HTTP 服务，也不证明未来 adapter 的预检已无副作用；该行为验收属于 07-02。

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
分发使用 electron-builder；Windows 0.7.0 RC 已配置 x64 NSIS 安装包及临时应用图标，当前未代码签名。

## Windows Installation

运行 `release/AI-ShortDrama-Director-Setup-0.7.0-x64.exe`。安装到当前用户，无需管理员权限，默认创建开始菜单和桌面快捷方式；安装结束后通过快捷方式启动。当前未签名，Windows SmartScreen 可能显示未知发布者。仅运行你确认来源的安装包。

## First Launch

首次启动自动创建本地目录并迁移 SQLite，进入 Setup Wizard / 项目工作台。可新建项目并先使用 Mock；无需 ComfyUI、Seedance Key 或外部 Node.js。`验收与维护 → About / 检查环境` 显示版本 0.7.0。

## FFmpeg Requirement

第一版**不捆绑 FFmpeg / FFprobe**，使用系统 PATH，也支持主进程环境变量 `DIRECTOR_FFMPEG` / `DIRECTOR_FFPROBE` 指向工具绝对路径。请同时安装两者，验证 `ffmpeg -version` 和 `ffprobe -version` 后重新启动应用。启动检测失败会显示提示，不阻止项目、文本或图片工作；视频处理（包括 Mock 视频）需要这两个工具。

## User Data Location

Windows 固定使用 `%APPDATA%\ai-shortdrama-director`，不随正式显示名称或安装目录变化。数据库为 `workspace.sqlite`，媒体、缩略图、加密凭据和视频临时文件也在此目录内；备份应覆盖整个目录。用户主动导出的备份和诊断包保存在系统文件对话框选择的位置。

## Uninstall & Data Retention

在 Windows 设置的“已安装的应用”中卸载 AI ShortDrama Director。卸载删除程序与快捷方式，**默认保留项目和 userData**。后续安装相同 appId 的版本继续使用同一数据目录；升级前先备份，数据库迁移后不保证旧版本可打开。不提供自动升级服务。

## Build Windows Installer

在 Windows x64、Node.js 24 环境中执行 `npm ci`，然后：

```powershell
npm run build       # 编译到 out
npm run pack        # 当前平台 unpacked 应用
npm run dist        # 当前平台安装包
npm run dist:win    # Windows x64 NSIS，禁止自动发布
```

主要交付物：`release/AI-ShortDrama-Director-Setup-0.7.0-x64.exe`；未安装目录：`release/win-unpacked`。图标可用 `node scripts/create-icons.mjs` 重新生成。构建工具首次使用可能需要网络下载，离线缓存配置、验证命令、签名与升级策略见 [Windows 发布说明](docs/windows-release.md)。

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

07-06.5/07-06.6 新增 [PackyAPI 原生 Image 2.5 Adapter](docs/packy-image-25.md)：真实 `/v1/models` 鉴权与 Sunburst 模型可见性已验证。第三轮按 Token Group `image`、`POST /v1/images/generations`、USD 0.4000 / request 发送了只含 `model / prompt / n` 的请求。HTTP transport 收到 2xx，但返回内容未通过受控响应/图片校验，因此无候选图片或可核实费用，继续按 `unknown-submission` 冻结。paid generation 仍为 **Not validated**。

真实生产集成边界、运行产物及验收状态见 [09-01 Real Production Integration](docs/real-production-09-01.md)。全局服务目录保存于 userData 的 `ai-services.json`，密钥只保存在加密凭据存储；`production-validation/` 保存配置修订对应的单次提交意图和下载证据，不写入 Git。历史配置和凭据引用保留，停用/删除配置不会删除任务或素材。
`npm run test:smoke` 的自动失败截图与运行产物仅写入 `test-results/automated-smoke/`，不会清理其他 UI 审计或安装版截图目录。
# 批量试生产

分镜视频页新增 **批量生产**：选择正式镜头、一次整批授权、按适配器能力额度调度、独立候选、人工返工、暂停恢复和已采用镜头 MP4 合成导出。使用说明及真实验收范围见 [抽卡部门试生产指南](docs/batch-production-guide.md)。队列不自动重试或切换供应商，未知提交禁止补发；重启自动暂停后续付费提交，备份恢复不转移收费授权。人民币费用未知仍保留，不按零处理。H3 已有真实原生协议证据可用于同模型文生/首帧生产准入，各能力的实际成功证据仍分别记录。

V1.1 P0 修订：默认叙事生产要求角色、场景已采用主参考与镜头批准关键帧，缺失时阻断；独立文生视频技术测试需明确选择，不代表叙事验收。准备、预算确认及执行前复核版本和素材证据。旧版无指纹费用授权的视频入口关闭新增云端提交，保留本地测试与已知远端任务查询。图像及视频收费确认均拒绝零/负数预算；本地免费工具和明确的本机 Alpha 模拟工具独立处理。

分镜视频 → 批量生产 → **编辑/预览成片时间线**，只读取本批次已采用视频，按正式镜序设入点/出点、相邻预览、连续播放，保存后由应用内 FFmpeg 合成 MP4；剪辑、选片和导出记录可重启恢复。目前输出无声，不能据此宣称声音制作通过。Packy `gpt-image-2` 编辑协议已补齐，要求 `sora` 分组；账户编辑权限仍须单独真实验证。[首尾帧、最小编辑请求与声音待确认项](docs/p0-v11-input-plan.md)；[P0 验收表](docs/p0-v11-acceptance.md)。


### seedance-20 可选实验

剧本、分镜和生成页面提供单根 Skill 开关及三环节离线 A/B 提示词预览。固定上游提交、MIT 和逐文件 hash 随 Windows 应用分发；不自动改写正式数据。真实模型效果需另行授权的 6 次文本对比，本轮未调用收费 API。入口、边界和证据见 [实验说明](docs/seedance-20-experiment.md)。

### P0-1 不可变执行配置绑定

图像与视频任务在确认事务内保存原供应商、服务实例/修订、适配器能力与版本、参数、凭据引用及费用授权。切换默认模型后，旧任务按原绑定查询、下载和恢复；缺失或不匹配时阻断，不改用新默认配置，未知提交不补发。SQLite 升至 schema 11，备份 format 6 仍支持旧备份；缺证的旧任务不自动补造绑定。修改明细、Windows 构建、验证证据及遗留限制见 [P0-1 独立审计说明](docs/p0-execution-binding.md)。本轮没有收费 API 请求，也未修改 seedance-20 实验。

### P0-2 批量视频模型解耦

批量工作流仅提交能力需求，适配器规划参数与预算依据，Broker 选择能覆盖整批的同一适配器。批次准备时冻结模型、执行配置与能力额度；授权绑定参数、素材版本和预算单位，运行中不切换供应商。未声明批量能力的工具不会被猜测为可用。H3 是普通适配器；旧批次可查阅、原任务按 P0-1 绑定恢复，缺失冻结信息的旧批次不得新增收费提交。详见 [P0-2 独立审计说明](docs/p0-video-batch-decoupling.md)。本轮仅本地协议验证，没有真实生成请求，未修改 Skill 和成片导出实现。
