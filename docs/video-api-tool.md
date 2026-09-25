# Third-party Video API Production Path

状态：07-07 fixture-first implementation complete；真实供应商生产验证未开始。

本路径实现 `video.textToVideo` 与 `video.imageToVideo` 两个既有 Capability Contract，不修改 Project Core、SQLite schema 或已发布 migration。它与旧 `MockVideoProvider` / `SeedanceVideoProvider` 并存，旧路径标记为 legacy compatibility path；同一请求只进入其中一条路径。

## 生产链

```text
Shot / PromptPackage
  → RoutingDecision
  → Broker validate / estimate
  → 用户确认云端上传与费用上限
  → GenerationApproval / Reservation
  → AITask / GenerationRecord
  → markSubmissionIntent
  → VideoApiAdapter.submit
  → accepted providerTaskId
  → status / recover / result
  → 受控下载
  → MP4 magic + FFprobe + thumbnail
  → Candidate AssetVersion
  → Review
  → Adopt to Shot
```

Preview 只编译并冻结 PromptPackage、执行路由和只读预检，不上传素材、不创建远端任务、不产生费用。Confirm 是唯一的提交入口；主进程在网络调用前按顺序持久化 Approval、Reservation、AITask、GenerationRecord 和 submission intent。

## Reference Video Protocol v1

`VideoApiAdapter` 是生产级 adapter 基础，但当前 HTTP envelope 只定义测试用 Reference Video Protocol：

- `POST {baseEndpoint}/tasks`：接受任务并返回 `{ "taskId": "..." }`。
- `GET {baseEndpoint}/tasks/{taskId}`：返回 accepted / queued / running / succeeded / failed / cancelled / unknown。
- `GET {baseEndpoint}/tasks/{taskId}/result`：返回受控下载引用列表及可选结构化费用。
- `DELETE {baseEndpoint}/tasks/{taskId}`：请求远端取消。
- `recover` 使用已有 taskId 查询，不重新 submit。

该协议不表示兼容 Seedance、Kling、Veo、Sora、Runway、Hailuo、Packy 或其他供应商。真实供应商应建立独立 adapter，把私有 endpoint、字段、签名、状态和误差策略限制在 adapter 内；业务服务只看公共 Capability 和九动作生命周期。

## Video Profile

Profile 是受信主进程配置，不是任意 API DSL。它声明：

- toolId、显示名、base endpoint、modelId、CredentialStore 引用；
- 支持的文本/图生视频能力、时长、画幅、分辨率；
- exact 或 provider-auto 分辨率语义；
- 时长容差、尾帧能力、输出数量上限；
- polling 初始/最大间隔与单次等待上限；
- 下载大小上限、允许的资源 host/suffix；
- 费用币种及 cancel / recover 支持状态。

密钥由 `CredentialStore` / Electron `safeStorage` 的主进程闭包提供。renderer、Profile、RoutingDecision、GenerationRecord、日志和 Git 均不保存密钥。

## 异步任务与重启恢复

远端接受后，`AITask.providerTaskId` 是唯一远端身份。`AITask` 仍是任务状态的唯一事实来源，不新增 scheduler 或第二张远端任务表。

轮询使用有限、递增间隔。单次本地等待结束、网络暂时失败或 renderer 关闭都不等于远端取消，也不会释放预算。重启后，主进程从 AITask、GenerationRecord、Reservation 和 providerTaskId 重建 Broker ownership，再执行 `recover → status → result`；不会创建新 Approval、Reservation、Task、Record，也不会调用 submit。

提交响应不明时，记录 `unknown-submission`，Reservation 转为 `pending-unknown`。系统禁止自动重试、自动切换工具、自动释放预算或创建第二个远端任务。已取得 providerTaskId 的状态查询失败保持 pending 与 submitted hold，可在以后继续恢复。

远端 cancel 结果只说明取消语义；它不证明没有计费。`cancelled` 或 `waiting-stopped` 不会自动释放已提交预算。

## 受控输入、下载与探测

图生视频只接收项目内 AssetVersion ID。主进程核对项目、媒体类型和受控 storageKey 后读取字节；renderer 不能传任意文件路径或远端 URL。

输出 URL 只在 adapter 的一次结果处理中使用，不写入 AssetVersion。下载复用 07-06 的安全 HTTP transport：

- 真实服务只允许 HTTPS；每个 hop 都重新 DNS 解析并拒绝 private/reserved IP；
- 最多 3 次重定向，每次重新执行 scheme、host、DNS、SSRF 与大小限制；
- Content-Length 预检加流式硬上限、timeout、abort；
- 安全诊断只允许 status、Content-Type、Content-Length、host、redirect count 与 request id，不记录完整 URL、query、Authorization 或响应正文。

下载后先检查 MP4 `ftyp` magic，再由现有 `MediaStorage.storeVideo` 调用 FFprobe 与 FFmpeg thumbnail。最终采用真实 probe 的 container/stream、duration、width、height、fps、codec 和 file size；HTML、JSON、零字节、截断 MP4、无视频流、损坏文件和超出 Profile 容差的时长/尺寸都会在 asset ingestion 前拒绝。`application/octet-stream` 配合法 MP4 可通过，伪造 `video/mp4` 但无法解码必须拒绝。

任务查询只返回脱敏的当前诊断阶段：generation-response、response-envelope、status-response、result-response、output-reference、output-download、redirect-validation、mime-detection、container-probe、duration-validation、dimension-validation、contract-match、asset-ingestion。诊断字段不包含完整资源 URL、signed query、响应正文、base64 或凭据；GenerationRecord 的终态 outcome 与费用证据仍是持久化审计事实。

当前候选输出仅接受 MP4。一次远端 submit 可产生多个 Candidate AssetVersion，它们属于同一个 GenerationRecord；需要多个独立付费 submit 时必须分别建立 Task、Record 与 Reservation。

## Candidate / Review / Adopt

成功结果创建新的 video Asset，并把每个输出保存为 draft AssetVersion。GenerationRecord 通过 generation_outputs 关联所有候选。工具不会直接修改 Shot；只有 `review` 可以批准版本，只有显式 `adopt` 才把固定 AssetVersion 绑定为 Shot 的 confirmed video。

供应商已完成生成但下载、probe 或 ingestion 失败时，当前 v8 outcome 使用最接近的 `malformed-output`。如果结果 envelope 提供可信费用，Reservation 可先 consume 并保留 actual cost；失败不会创建 AssetVersion。没有可信费用时继续持有 submitted/pending reconciliation，不能伪造 0。

## Fixture 验证

`tests/fixtures/video-http.ts` 运行本地异步 HTTP 服务，并在测试期间用 FFmpeg 动态生成极小 MP4；仓库不提交二进制媒体。覆盖：

- accepted → queued → running → succeeded；远端 failed / cancelled / unknown；
- submit unknown；status 401 / 429 / 500 / malformed / missing remote；
- 结果 URL、安全多重 redirect、危险 redirect；
- `application/octet-stream` + MP4、HTML masquerade、truncated MP4；
- 错误时长、错误分辨率、多输出；
- cancel、重启 recover、providerTaskId 归属与 submitCount=1；
- Candidate → Review → Adopt 与 billing consume。

运行：

```bash
npx tsx --test tests/unit/video-api.test.ts
```

`REAL_PAID_VIDEO_TEST=false`。当前没有注册或调用真实付费视频供应商，也没有真实供应商 Profile。已有密钥不构成授权；任何真实请求都必须先新增独立供应商 adapter、完成 connectivity/capability 核对，并在显示 Provider、Model、Prompt、输入帧、时长、尺寸、费用与云端上传说明后取得一次性明确授权。
