# PackyAPI Image 2.5 — 07-06.5

## 当前状态

2026-09-17 本机验证：真实 GET `https://cf.api.fan/v1/models` 接受已加密保存的凭据，精确模型 ID `gpt-image-2.5-sunburst` 可见。退出探测进程后再次读取 CredentialStore 探测成功。真实生成请求数为 **0**。

- Native Adapter：Implemented，JSON / multipart 映射经过本地 HTTP fixture 验证。
- Real connectivity / authenticated models listing：Validated。
- Image token group：按用户配置记录；`/models` 不证明令牌分组。
- 模型生成能力、参数限制、真实费用和图片质量：Not validated。
- Real paid generation：Not authorized / Not executed。

## 独立适配器

`electron/main/tools/adapters/packy-image-25.ts` 的 `PackyImage25Adapter` 实现既有 ImageApiTool。注册工厂是唯一选择具体适配器的位置，未修改 Project Core、公共 Image Capability、数据库或已发布 migration。Packy 不接收 `director-image-reference-v1`，旧 Reference Adapter 不变。

固定地址与模型：

- API base：`https://cf.api.fan/v1`
- Text → `POST /images/generations`，`application/json`
- Reference → `POST /images/edits`，`multipart/form-data`，二进制 `image` 文件字段
- Model：`gpt-image-2.5-sunburst`；Token Group 配置：`Image`

原生映射：`prompt`、`model`、`n`、`size=WIDTHxHEIGHT`、`output_format=png`、`response_format=b64_json`。负面描述并入 prompt 的 Avoid 段，参考角色作为文字意图传入，不声称供应商存在角色或权重参数。私有字段完全留在 Adapter。

依据为用户指定的模型和端点，以及 [Packy Images 官方说明](https://docs.packyapi.com/docs/paint/GPTImage.html)。该公开页当前描述 gpt-image-2 / sora，不能据此声称 Sunburst 参数全部验证。保守本地限制：1 输出、最多 1 参考、权重 1、PNG、无 seed；尺寸仅开放 1024×1024、1536×864、864×1536。4 输出、seed、其它尺寸/格式会拒绝，不循环生成四笔费用。多参考、mask、远端取消和恢复未实现。

## 付费门禁

07-06.5 中真实 Packy submit 被主进程 Adapter 硬性拒绝，连拥有 Approval 的调用也不例外。没有 renderer 开关、环境变量或 Profile 字段可以启用真实生成。仅显式注入的精确 loopback fixture transport 可验证原生提交映射。

health 只 GET `/models`，可见也返回 unknown（生成可用性未知）。validate / estimate 仅本地校验，估价保持 unknown。后续真实付费测试须重新取得用户明确授权，并保留 07-06 Approval / Reservation / intent 门禁后再开放；模型列表成功不会解锁生成。

响应 `data[].b64_json` 或 `data[].url` 交回既有受控 ingestion：HTTPS、DNS 固定、无重定向、大小限制、MIME / 解码 / 尺寸 / hash 验证。API Key 只发往固定 API host，下载无认证头；usage tokens 不是货币费用，不据其虚构 actualCost。

## 安全配置与探测

凭据来自现有 CredentialStore / Electron safeStorage，保存在 `%APPDATA%/ai-shortdrama-director/credentials`。Profile 仅保存 UUID 引用，位于同目录 `image-api-profiles.json`。导入入口支持以下无密钥 Profile：

```json
{
  "adapter": "packy-image-25",
  "toolId": "packy.image-25",
  "displayName": "PackyAPI · GPT Image 2.5 Sunburst",
  "modelId": "gpt-image-2.5-sunburst",
  "tokenGroup": "Image",
  "credentialRef": null,
  "currency": "USD"
}
```

currency 是本地账本设置，不是供应商报价。当前探测导入默认 USD，真实生成前必须核对账户实际计价币种。

生成页选择 Packy 后可点击“检测连接与模型（不生成）”。窄 IPC 只接受 toolId，不接收 endpoint、路径或 Key，不创建 Task、Record 或 Reservation。

开发环境也可从仓库根目录执行：

```powershell
node scripts/packy-connectivity.mjs
```

首次隐藏输入并加密导入可执行 `node scripts/packy-connectivity.mjs --import-key-stdin`。不要把密钥放在命令参数、环境变量或脚本文件里。启动器通过临时 Windows named pipe 把隐藏输入传递给 Electron 主进程；不落地明文。临时 bundle 在忽略的 `.cache` 内。该工具仅针对 Windows，不打开数据库，也不调用生成服务。

安全报告路径：`%APPDATA%/ai-shortdrama-director/diagnostics/packy-connectivity.json`。报告只包含时间、鉴权/模型可见性、未验证标记；不保存模型列表原文、认证头、响应敏感数据或密钥。

## 测试

新增 15 项单元测试覆盖模型探测、401/403/429/500/非法 JSON、缺少凭据、保守能力校验、原生 JSON / 二进制 multipart、单次授权句柄、下载拒绝后的提交状态、费用未知、真实 submit 关闭及独立工厂注册。所有网络生成测试只连接本地 fixture。

鉴权对照：同日未携带密钥的 GET `/v1/models` 返回 HTTP 401；使用 CredentialStore 中密钥的模型列表请求成功。探测与复核均未调用生成端点。
