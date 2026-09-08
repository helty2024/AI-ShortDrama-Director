# Text / Image Provider 与通用 AI 队列

## 接口

主进程接口 TextGenerationProvider 提供 generateStructured<T>，接收独立 system prompt、结构化 input、Zod schema、schemaName 和 AbortSignal，返回经过 schema 校验的 T。
ValidatedTextProvider 统一负责超时、取消、有限重试和错误规范化；CompatibleTextProvider 仅负责 HTTP 协议，MockTextProvider 负责确定性的开发演示结果。
Prompt 位于 electron/main/intelligence/prompts.ts，带 PROMPT_VERSION，可在未来替换成 Skill/Prompt Compiler；Provider 不拼接业务提示。

## 默认 Mock

默认 mock-text 使用本地规则识别对白角色、地点、常见道具与制作元素，并生成三段镜头建议。无密钥可走完整确认链路，但它不等同于真实模型理解，结果卡明确显示 Mock 和来源理由。
所有单元/桌面测试默认使用 Mock 或注入的内存 HTTP response，不调用外部模型。

## 兼容文本服务

可在启动 Electron 的主进程环境配置以下变量，然后运行 npm run dev 或构建后的应用：

| 变量                   | 含义                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| DIRECTOR_TEXT_PROVIDER | mock（默认）或 compatible                                           |
| DIRECTOR_TEXT_BASE_URL | 含 /v1 的兼容 API 根地址；compatible 默认 https://api.openai.com/v1 |
| DIRECTOR_TEXT_MODEL    | 使用服务实际支持的文本模型 ID；compatible 必填                      |
| DIRECTOR_TEXT_API_KEY  | 可选认证密钥；云端通常必填，本地服务可不填                          |

程序没有自动读取 .env；这些值由启动进程环境传入。不要添加 VITE_ 前缀，不要把密钥写入配置源码或 Bible。renderer 只看到 Provider 名称，看不到密钥/URL。
仅允许 HTTPS，或 localhost/127.0.0.1/::1 的 HTTP；不跟随重定向，避免认证信息被转发。
适配器发送 POST /chat/completions 和 response_format=json_schema（strict），从 choices[0].message.content 读取 JSON，再进行 Zod 校验。服务需要支持该协议与结构化输出；不支持的 API 会返回可见错误，不降级为未校验文本。
OpenAI、支持该协议的本地模型服务器或其他兼容服务可复用适配器。尚未用真实账户密钥进行联网验收。

参考：[OpenAI Structured Outputs 官方文档](https://developers.openai.com/api/docs/guides/structured-outputs)。

## 错误、重试和取消

单次请求默认 30 秒，最多额外重试 1 次。仅 NETWORK/RATE_LIMIT/TIMEOUT 自动重试；认证、输出无效、拒绝回答或其他 Provider 错误直接失败。重试等待同样响应取消。
错误只返回规范化 code/message，不返回 HTTP 响应正文、堆栈或认证值。队列另外使用 INTERRUPTED/STALE_SOURCE 标记进程中断或来源变化。
即使测试 Provider 忽略 AbortSignal，超时/取消的迟到结果也不能发布到数据库。

## 持久化任务队列

AITask 是供文本与后续媒体共用的任务记录，保存项目、输入类型、目标、sourceRevisions、attempt、状态、错误和结果 ID。Phase 1 GenerationTask 记录继续保留；Phase 2 不执行旧 image/video 草稿。
队列当前全局并发为 1，每项目最多同时等待 20 项，每次批量分析最多 100 个 Scene。SQLite 保存状态，异步网络请求不阻塞 renderer。
queued 从数据库读取；文本 running 启动恢复时改为 failed/INTERRUPTED。正常关闭取消正在执行的文本任务，未运行的 queued 下次继续。图像恢复逻辑见下文。失败/取消后显式重试更新源快照与 attempt，成功任务重新分析则创建新任务。
结果、Draft 和 succeeded 状态在同一事务中提交。取消不会改变已成功任务，重新分析不会自动忽略或覆盖历史 Draft。

## 图像 Provider（Phase 3）

ImageGenerationProvider 提供 id/displayName/capabilities、healthCheck、generate、cancel、normalizeError。MockImageProvider 使用确定性图片；ComfyUIImageProvider 使用本机 HTTP/WebSocket。图像业务接收标准 ImageGenerationRequest（Prompt package、宽高、seed、引用版本），ComfyUI 工作流与 URL 仅在 providerOptions 快照。

复用 AITaskQueue 单 worker 与 ai_tasks 表，ImageTaskExecutor 处理异步媒体准备并返回事务提交函数；成功时一起写版本与任务结果。网络请求不自动重交。恢复时有 providerTaskId 的 running 改 queued，查询既有历史；无 ID 则 failed/INTERRUPTED，人工确认后重试。取消删除本 prompt 的队列项，不全局 interrupt；运行中的上游计算可能继续，本地丢弃迟到结果。

主进程配置无图像密钥输入。本版 ComfyUI 面向本机无认证服务；未来商业 Provider 的密钥需加主进程安全存储，不能放 providerOptions 持久化请求。

详见 [ComfyUI](comfyui-provider.md)、[图像任务与恢复](image-generation.md)、[Prompt Compiler](prompt-compiler.md)。视频 Provider 尚未接入。

## Phase 4 视频适配器

文本、图像、视频使用独立契约。VideoGenerationProvider 是 submit → getStatus → fetchResult 的长任务接口，详见 [视频 Provider](video-provider.md)。统一 AITaskQueue 根据 input.type 路由执行器，所有生成结果均为候选版本，审批仍由业务服务执行。

云视频认证通过 CredentialStore，由 Electron safeStorage 加密。公开 Profile 仅保存认证引用；请勿将文本 Provider 的旧环境配置方式误用于视频页面。当前默认 mock-video 生成真实短 MP4，不访问外网。

## Phase 5 QC 与路由

MediaQCProvider 与 TextGenerationProvider / ImageGenerationProvider / VideoGenerationProvider 分离。当前实现为 MockMediaQCProvider，规则校验元数据/连续性并返回 Zod QCOutput；不接真实视觉 API，也不上传图片到外部。

Generation Router 只推荐可用且满足能力的 Profile，不替用户提交。路由偏好、时长、分辨率、参考需求与报价可解释。未来 Vision API 可注入主进程 QC Provider 并复用 CredentialStore，必须在增加真实实现时验证 HTTPS、媒体上限、MIME、响应 schema 与错误脱敏。
