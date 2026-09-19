# PackyAPI Image 2.5 — 07-06.5 / 07-06.6

## 当前状态

2026-09-17 本机验证：真实 GET `https://cf.api.fan/v1/models` 接受已加密保存的凭据，精确模型 ID `gpt-image-2.5-sunburst` 可见。退出探测进程后再次读取 CredentialStore 探测成功。

2026-09-18 经明确确认执行一次真实文生图：PackyAPI、`gpt-image-2.5-sunburst`、1 张、1024×1024、1:1、`quality=low`，不含参考图。该次使用 `/images/generations`，但请求体包含尚未验证的可选字段；供应商返回 validation，未返回图片。最新口径确认该 HTTP path 正确，但不回写历史 `unknown-submission`、计费状态或预留额度。

2026-09-19 曾将供应商的 Endpoint Type `image-generation` 误解为 HTTP path，第二次授权请求发送到 `/image-generation`，收到 validation 类 4xx，未返回图片或可核对费用。该记录继续保持 `unknown-submission`，不重试、不切换工具、不释放 USD 0.4000 预留。

当前待验证配置恢复 Token Group `image`、`POST /v1/images/generations`、USD 0.4000 / request。第三次请求将只发送 `model`、`prompt`、`n`，不发送 `size`、`quality`、`output_format`、`response_format`。本轮只修正代码与 fixture，未发出付费请求。

- Native Adapter：Implemented，JSON / multipart 映射经过本地 HTTP fixture 验证。
- Real connectivity / authenticated models listing：Validated。
- Image token group：固定配置为 `image`；`/models` 不单独证明令牌分组权限。
- 模型生成能力、参数限制、真实费用和图片质量：Not validated。
- Real paid generation：Attempted twice in total (one correct path with unverified optional fields, one mistaken path) / Not validated。

## 独立适配器

`electron/main/tools/adapters/packy-image-25.ts` 的 `PackyImage25Adapter` 实现既有 ImageApiTool。注册工厂是唯一选择具体适配器的位置，未修改 Project Core、公共 Image Capability、数据库或已发布 migration。Packy 不接收 `director-image-reference-v1`，旧 Reference Adapter 不变。

固定地址与模型：

- API base：`https://cf.api.fan/v1`
- Text → `POST /images/generations`，`application/json`
- Reference → `POST /images/edits`，`multipart/form-data`，二进制 `image` 文件字段
- Model：`gpt-image-2.5-sunburst`；Token Group 配置：`image`
- Text price：USD 0.4000 / request（400,000 micro USD）

文生图 JSON 只映射 `model`、`prompt`、`n`。负面描述并入 prompt 的 Avoid 段；不发送 `size`、`quality`、`output_format`、`response_format`。参考图仍走独立 `/images/edits` multipart 映射；不声称供应商存在角色或权重参数。私有字段完全留在 Adapter。

依据为用户指定的模型和端点，以及 [Packy Images 官方说明](https://docs.packyapi.com/docs/paint/GPTImage.html)。该公开页当前描述 gpt-image-2 / sora，不能据此声称 Sunburst 参数全部验证。保守本地限制：1 输出、最多 1 参考、权重 1、PNG、无 seed；尺寸仅开放 1024×1024、1536×864、864×1536。4 输出、seed、其它尺寸/格式会拒绝，不循环生成四笔费用。多参考、mask、远端取消和恢复未实现。

## 付费门禁

默认组合中真实 Packy submit 仍被主进程 Adapter 硬性拒绝，连拥有 Approval 的调用也不例外。没有 renderer 开关、环境变量或 Profile 字段可以启用真实生成。07-06.6 只能通过主进程一次性 `PackyPaidValidationGate` 开启固定单图请求；门闩在远端调用前以独占文件记录 submission intent。v1 和 v2 intent 保留不变；新契约使用独立 v3 门闩，只有再次取得精确确认后才会创建。显式注入的精确 loopback fixture transport 继续用于无费用协议测试。

默认 health 只 GET `/models`，可见也返回 unknown（生成可用性未知）。validate / estimate 仅本地校验；文生图 estimate 固定为 USD 0.4000 / request，参考图费用仍为 unknown。一次性门闩仅在用户确认的独立验证进程内让 health 可进入 available；模型列表成功本身不会解锁生成。

响应 `data[].b64_json` 或 `data[].url` 交回既有受控 ingestion：HTTPS、DNS 固定、无重定向、大小限制、MIME / 解码 / 尺寸 / hash 验证。API Key 只发往固定 API host，下载无认证头；usage tokens 不是货币费用，不据其虚构 actualCost。

## 安全配置与探测

凭据来自现有 CredentialStore / Electron safeStorage，保存在 `%APPDATA%/ai-shortdrama-director/credentials`。Profile 仅保存 UUID 引用，位于同目录 `image-api-profiles.json`。导入入口支持以下无密钥 Profile：

```json
{
  "adapter": "packy-image-25",
  "toolId": "packy.image-25",
  "displayName": "PackyAPI · GPT Image 2.5 Sunburst",
  "modelId": "gpt-image-2.5-sunburst",
  "tokenGroup": "image",
  "credentialRef": null,
  "currency": "USD"
}
```

Packy Profile 将 currency 固定为 USD。旧版 `tokenGroup: "Image"` Profile 读取时会规范化为 `image`，新写入只保存小写值；CredentialStore 引用和密钥不变。

生成页选择 Packy 后可点击“检测连接与模型（不生成）”。窄 IPC 只接受 toolId，不接收 endpoint、路径或 Key，不创建 Task、Record 或 Reservation。

开发环境也可从仓库根目录执行：

```powershell
node scripts/packy-connectivity.mjs
```

首次隐藏输入并加密导入可执行 `node scripts/packy-connectivity.mjs --import-key-stdin`。不要把密钥放在命令参数、环境变量或脚本文件里。启动器通过临时 Windows named pipe 把隐藏输入传递给 Electron 主进程；不落地明文。临时 bundle 在忽略的 `.cache` 内。该工具仅针对 Windows，不打开数据库，也不调用生成服务。

安全报告路径：`%APPDATA%/ai-shortdrama-director/diagnostics/packy-connectivity.json`。报告只包含时间、鉴权/模型可见性、未验证标记；不保存模型列表原文、认证头、响应敏感数据或密钥。

## 测试

新增 16 项单元测试覆盖模型探测、401/403/429/500/非法 JSON、缺少凭据、保守能力校验、精确 URL / Headers / JSON / multipart、单次授权句柄、下载拒绝后的提交状态、文生图固定报价、参考图费用未知、真实 submit 关闭、独立工厂注册，以及稀疏工作区中的完整 Approval / Reservation / Task / Record / Candidate 链路。自动测试的网络生成仍只连接本地 fixture。

鉴权对照：未携带密钥的 GET `/v1/models` 返回 HTTP 401；使用 CredentialStore 中密钥的模型列表请求成功。07-06.5 探测与复核未调用生成端点；07-06.6 的前两次人工授权请求均没有生成可采用图片。新的最小 Images API 契约目前只有 fixture 验证。

前两次本机审计证据位于 `%APPDATA%/ai-shortdrama-director/diagnostics/packy-paid-validation-{intent,report}.json` 和 `packy-paid-validation-v2-{intent,report}.json`。它们不含 Key、认证头或供应商原始错误正文，也不会被当前代码改写。待授权的第三次验证将使用独立 `packy-paid-validation-v3-{intent,report}.json`；本轮没有创建 v3 intent。
