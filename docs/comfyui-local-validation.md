# 07-08.5 Real Local ComfyUI Validation

验证日期：2026-09-26。仅一次用户明确授权的本机生成。ComfyUI 外部服务使用 `http://127.0.0.1:8188`；没有启动、终止或修改服务，没有安装节点或下载模型。

## 已执行链路

Electron 主进程中的 ImageGenerationService → PromptPackage → FIXED RoutingDecision → known-zero Estimate → 本地执行确认 → Approval/Reservation → AITask/GenerationRecord → ComfyUIToolAdapter → prompt_id → queue/history → view → Sharp 全像素解码 → hash/MediaStorage → Candidate AssetVersion → 单独 Review → Adopt → 正式主参考绑定。

实际参数：`sd_xl_base_1.0.safetensors`，Prompt `A red apple on a white table`，negative prompt 空，1024×1024，batch/count 1，20 steps，cfg 7，euler/normal。没有参考图、批量、云端请求或自动重试。工具费用 USD 0，不估算 GPU 和电费。

| 验收项 | 真实结果 |
| --- | --- |
| POST /prompt | HTTP 200，仅一次 |
| prompt_id | 684b2865-eea0-44b8-bd26-70d9ef478980 |
| history / view | HTTP 200 / 200 |
| 输出 | image/png，1024×1024，Sharp 可完整解码 |
| SHA-256 | b26e4a336b6cb92e7d000b17bd8ed3f6d3f7acaf995205569a6387398d038075 |
| 项目 | 8ba2130f-6b64-4c41-aca2-bbf89736bf0a |
| AITask | 26354305-38b9-41d8-8184-5dc57334d93a |
| GenerationRecord | 42409194-ded3-464d-9277-7e8b1ec11389，succeeded |
| Candidate AssetVersion | 54021919-ef37-4574-9b74-09c2ce69523e，先 draft，人工授权审核后 approved |
| Review / Adopt / 正式绑定 | 全部通过 |
| Reservation / actual cost | consumed / 0 micro USD |
| 重启恢复 | 首个 Electron 进程退出，新进程重建 DB/service/adapter；经新 Broker 恢复同一 handle，history=succeeded |
| 重启 POST 次数 | 0；整个验证累计 1 |

恢复验证限定为**成功完成后的既有任务查询**，不是生成中途崩溃恢复入库验收。恢复时核对持久化 AssetVersion、正式绑定和不可变 GenerationRecord，不产生第二张图片或第二条输出记录。

## 请求前发现并修正的问题

- 07-08 内置组合仅绑定 checkpoint，sampler 的 `steps`/`cfg` 仍为模板变量。`builtinComfyProfile` 复用现有 substituteWorkflow，在可信模板 1.0.1 中完整解析常量；validate 拒绝残留变量。
- queue 判断曾通过整个 JSON 包含 `queue_running` 字符串区分状态，导致 queued 被误判 running。现在按队列数组中精确 prompt_id 判断，并测试相似 ID 不匹配。
- 本地冷加载使用最长 30 分钟的已有 prompt 轮询窗口；不会增加 submit 次数。ImageGenerationService 补记真实 startedAt，完成后形成耗时审计。

公共 Capability、Project Core、migration、package version 与 UI 结构均未修改。

工程验证：`npm run typecheck`、`npm run lint`、`npm run build` 全部通过；`npm run test:unit` 340/340 通过，`npm run test:smoke` 8/8 通过。自动化回归使用隔离数据和 fixture，没有再次向真实 ComfyUI 提交任务。

## 脱敏与防重复提交

`tests/fixtures/comfyui-real-envelope.json` 仅记录实测响应字段结构、HTTP 状态、MIME、尺寸和 hash 摘要；用于回放的 prompt_id、文件名、序号与内容为合成值，不包含真实图片字节、路径、工作流正文或系统隐私。回放测试动态生成合成 PNG，再通过相同 ImageGenerationService 验证 Candidate/Review/Adopt 与重建 service 后查询恢复。

真实图片和项目记录保存在现有应用 userData；诊断目录中的 `comfyui-07-08-5-intent.json`、`comfyui-07-08-5-profile.json`、`comfyui-07-08-5-report.json` 保留本次审计，不提交 Git。

验证 transport 在网络 POST 前以 `wx` 创建并 fsync 持久化 intent。每个执行进程限一次，重新启动也不能越过原 intent；恢复模式完全拒绝 POST。没有“清除 intent 后重试”的自动操作。

```powershell
# 仅查询本次已经完成的 prompt_id，不提交生成
node scripts/comfyui-local-validation.mjs --recover-only

# 仅首次、且明确获得单次本机执行授权时允许使用；本次已执行，会被 intent 拒绝
node scripts/comfyui-local-validation.mjs --confirm-one-local-image
```

脚本启动的是本应用的无窗口 Electron 验证进程，SQLite 仍只由 Electron 主进程访问。输出原图保存在 MediaStorage，仓库不含生成媒体。
