# LocalMiniDrama 源码比较与落地清单

核查日期：2026-10-19。我方基线 `3a223013f359db0c016bc832fe725bbba2029af2`，分支 `codex/09-01-test-ready-alpha`，版本 0.9.0-alpha.2。

参考：[LocalMiniDrama 固定提交 abcec932](https://github.com/xuanyustudio/LocalMiniDrama/tree/abcec932e2395bad2fdb298dac95d59c7c6a83a3)，提交日期 2026-10-16，包版本 1.2.9，MIT。本轮读取仓库树并静态核查 35 个文本文件，缓存仅在 `.cache/localminidrama-study/`，没有 clone 本工程、运行外部代码、导入第三方配置或素材。没有安装并独立验收对方全部功能，不能把 README 或协议分支当成真实服务验收。“本地存储”也不代表调用云模型时故事和参考图不会离开本机。

## 核心判断

对方领先的是制作操作覆盖面：多服务配置、按集批量处理、画布、配音和视频合成。我方已有项目/剧本/资产/分镜、候选审核、明确采用、持久化任务、费用审批与溯源，但真实文本—图像—视频链尚无完整安装版验收证据，输出主要止于确认镜头与制作清单。差距集中于服务可用性、批量操作和成片交付。版本号、供应商数量与测试数量不能换算完成百分比。

| 能力 | 对方源码 | 我方基线 | 差距与决策 |
| --- | --- | --- | --- |
| 桌面与本地数据 | Electron、loopback Express、Vue、SQLite | Electron 主进程、最小 preload、React、SQLite | 都有基础，无需换框架 |
| 文本配置 | 独立配置、默认模型、JSON 模式 | 加密配置已有，只发送严格 JSON Schema | 本轮补显式兼容模式与连接模板 |
| 故事创作 | 梗概生成多集、异步入库 | 故事/已有剧本整理为预览，确认入库 | 多集扩写、篇幅控制仍缺；“解析”不能说成完整编剧 |
| 长文导入 | 章节识别、逐章处理 | 单次输入与解析 | 缺少逐集分段审核流程 |
| 角色/场景/道具 | 提取、形象生成、库复用 | 实体、Bible、多版本、来源 | 基础可用，真实参考图一致性仍需验证 |
| 跨项目复用 | 角色/场景/道具库、去重 | 项目内资产、备份恢复 | 跨项目素材库缺失，后置 |
| 视觉风格 | 预设、自定义提示词覆盖 | 项目风格、Bible、编译器 | 缺少普通用户可选样例与预设 |
| 分镜 | 经典/全能、参考图、首尾帧 | 镜头计划、连续性、关键帧、参数编辑 | 常用机制已有，先整合操作，不扩张多段协议 |
| 云图像 | 多家原生/兼容分支 | Packy、ComfyUI | 对方覆盖广；我方先完整验证一家云图像 |
| 视频 | 多协议分派，包含 H3 | H3 原生、受控首试；真实 MP4 未验证 | 真实结果与恢复证据优先于第二家 |
| 批量制作 | 制作页一键流程、镜头组执行、进度 | 固定工作流、预览授权、审核采用、高级批次 | 普通用户批量入口与跨阶段引导落后 |
| 恢复 | 已存远端 ID 可继续查询 | 已知任务恢复；未知提交保留预算、不重提 | 复用已有机制，不照搬通用重试 |
| 候选与正式素材 | 历史版本及替换 | approve 与 adopt 独立、固定绑定 | 保持现有语义 |
| 一致性 | 外观锚点、阶段、参考图 | 连续性快照、lineage、固定版本 | 质量需同剧本实测，不能凭字段判输赢 |
| QC | 本轮未完整审计 | 默认 Mock QC，非真实视觉质检 | 不把规则评分宣称 AI 质量验收 |
| 配音/旁白/SRT | TTS、旁白后处理、SRT | 无正式音频制作链 | 明确缺失，当前不扩张冻结范围 |
| 合成 | FFmpeg concat、转码 | 无成片编码或时间线 | 明显差距；先安全交付，再最小顺序合成 |
| 导出 | 项目/媒体 ZIP、分镜 HTML | 项目备份、JSON Manifest | 本轮补文字分镜表；媒体交付包仍缺 |
| 画布 | Vue Flow，同源实体与节点操作 | 无画布 | 借鉴同源视图，非 Alpha 前置条件 |
| 剧内助手 | Mastra 上下文与工具 | 无对话式项目操作 | 后置，先让直接操作闭环 |
| 密钥 | 配置服务层直接读写、返回 api_key | safeStorage 加密、公开配置只留引用 | 不复制其凭据方式；非完整安全审计结论 |
| 验证 | 有协议、恢复、合成测试 | 基线 Unit 446、Smoke 39；真实全链未通过 | 两者测试都不能代替实际供应商与作品验收 |

## 源码证据与可取舍的做法

所有链接均固定在上述提交，不随 main 漂移。

- [aiClient.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/backend-node/src/services/aiClient.js#L376)：按默认模型/任务配置调用，支持 JSON 模式和输出上限。部分参数错误会重发；我们保留明确选择与一次请求，不自动改变协议、重复计费。
- [aiConfigService.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/backend-node/src/services/aiConfigService.js#L124)、[AIConfigContent.vue](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/frontweb/src/components/AIConfigContent.vue)：配置按用途分组，默认模型作用于实际执行；配置层直接持有密钥，不适合移植到我方安全边界。
- [imageClient.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/backend-node/src/services/imageClient.js#L89)、[videoClient.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/backend-node/src/services/videoClient.js#L25)：多协议存在，不保证全部账户、地区、代理均可用。
- [FilmCreate.vue](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/frontweb/src/views/FilmCreate.vue#L356)、[画布工作流](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/frontweb/src/composables/useCanvasWorkflowRunner.js)：学习按镜头连续操作、显示阶段与失败，避免照搬超长页面。
- [videoService.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/backend-node/src/services/videoService.js#L326)：已有 provider_task_id 后继续查询，与创建新任务区分。
- [videoMergeService.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/backend-node/src/services/videoMergeService.js#L188)：该提交在实际合并失败时可用首段作为结果并标记完成。我们不会引入此兜底；未来合成必须验证镜数、缺片与实际时长，失败就报告失败。
- [novelImportService.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/backend-node/src/services/novelImportService.js)、[dramaExportService.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/backend-node/src/services/dramaExportService.js)、[exportStoryboardSheet.js](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/frontweb/src/utils/exportStoryboardSheet.js)：提供导入及交付出口；长文截断、失败降级等细节仍应单独验证。

## 本轮已实施

1. DeepSeek、百炼北京、方舟北京文本连接模板。模型由用户填写，不猜测账户权限、价格或可用模型；模板不联网、不代表检测通过。
2. 显式选择严格 JSON Schema 或兼容 JSON；兼容模式把 Schema 放入系统约束，返回后仍执行同一 Zod 校验。旧配置保持严格模式，不静默切换、不修补错误 JSON、不增加自动重试。
3. 长度截断、内容过滤、工具调用等不完整结束均拒绝写入结果。输出上限仍为 4000；兼容模式发送 max_tokens，严格模式保留 max_completion_tokens。修改协议使旧校验失效；更换地址必须重新输入对应密钥，原密钥不会交给新地址。
4. 服务卡片指出下一步：保存密钥 → 只读检测 → 独立确认结构化测试 → 设为默认 → 回到故事整理。
5. 分镜页“导出分镜表”导出当前分集/场次筛选范围，沿已存顺序排列，包含画面、角色、景别、运镜、计划时长、连续性和确认状态。主进程通过既有可信 IPC 校验项目和镜头归属，调用系统另存为并写出 HTML；取消不写文件，渲染层不持有任意文件写入能力。HTML 可离线查看、打印，无脚本或远端资源。不导出服务配置、原始 Prompt、媒体路径或媒体文件。批准候选不算已确认，模拟来源明确标记。

以上为独立实现，没有复制对方程序、素材或提示词资产。[MIT 许可](https://github.com/xuanyustudio/LocalMiniDrama/blob/abcec932e2395bad2fdb298dac95d59c7c6a83a3/LICENSE)允许学习与复用；后续若实际引入其代码，需随分发保留许可和版权声明。

请求依据：[DeepSeek JSON 输出](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)、[百炼 Chat Completions](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/)、[方舟结构化输出](https://console.volcengine.com/ark/region%3Acn-beijing/docs/structured-output-beta)。文档证明协议，不证明本机账户已经验证。

## 最短落地顺序

| 顺序 | 工作包 | 硬验收与限制 |
| --- | --- | --- |
| P0 | 一家真实文本 | 安装版新故事 → 预览 → 人工确认 → 提取 → 分镜。仍需真实地址、模型和软件内密钥；模板不能代替验收 |
| P0 | 一家云图像 | 实际角色/场景/关键帧 → Candidate → Approve → Adopt；记录费用、失败与恢复。Packy 完整真实生成仍未通过 |
| P0 | H3 单次视频 | 4 秒 480P，明确额度；任务 ID、MP4、FFprobe、采用、重启不重提。10 月 14 日记录余额 0，本轮未刷新，不能推断今日余额；仍需额度授权 |
| P1 | 媒体交付包 / 最小顺序合成 | 仅确认版本，镜数、缺片、顺序、时长、路径、哈希均校验；不可用首段假装成片。尚未实现 |
| P1 | 批量生产入口 | 展示阻塞原因、补缺跳过已确认；复用现有预览、预算与持久化工作流，未知提交停止 |
| P2 | 长文逐集导入、资产复用、风格模板 | 分段不静默截断，逐集可审核，复制资产保留来源 |
| P3 | 画布、更多服务、对话助手 | 与现有实体同源，不另存正式素材或执行权；不阻塞首次内部验收 |

按工作包验收，不给缺乏同口径实测的完成百分比或固定交付天数。落地门槛是用户在安装版使用实际账户完成新项目到可交付素材，并能解释费用、失败和恢复。当前仍未满足；本轮无付费生成请求。

## 本轮回归

Unit 457/457、Desktop/Smoke 41/41、lint/build 通过；旧基线 446/39 项全部保留。新增覆盖显式协议、旧配置兼容、截断拒收、不自动重试、改地址不复用密钥、配置重启、项目归属、HTML 转义、筛选顺序/原镜号、批准与采用、系统保存实际写盘与取消。文件选择器在自动化中指定隔离目标，内容由真实主进程写出后读取校验。截图与示例分镜表保存在本机忽略目录 `test-results/localminidrama-study/`，不进入 Git。真实供应商 E2E 尚未通过。
