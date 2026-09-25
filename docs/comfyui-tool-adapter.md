# ComfyUI Optional ToolAdapter

07-08 将 ComfyUI 作为可选的本机外部工具接入统一 Tool Protocol。它实现 `local-service`，与 Cloud Image API 并列提供 `image.generate`；具有参考图绑定的可信模板可独立提供 `image.referenceGenerate`。Project Core、Shot、Asset 和公共 Image Capability 不含 ComfyUI 节点 ID 或私有参数。

## 运行边界

`ComfyUIToolAdapter` 实现 describe / health / validate / estimate / submit / status / result / cancel / recover。`ComfyUIRuntime` 只负责受控 HTTP 协议：system_stats、object_info、prompt、queue、history、upload/image 和 view。它只接受 `http://127.0.0.1`、`http://localhost` 或 `http://[::1]`，拒绝凭据、query、fragment、路径、LAN 与公网地址，也不跟随重定向。

应用永远不会启动、停止、重启、安装或修改 ComfyUI，不调用 `child_process.kill`、`process.kill`、taskkill 或 Stop-Process。外部服务不可达时 health 为 unavailable；FIXED 路由阻塞，AUTO 可在提交前选择另一个合格工具。路由一旦确认不会在执行中切换。

## 可信工作流契约

模板固定保存 templateId、version、capability、workflow、requiredNodes、requiredModels、inputBindings、outputNode、分辨率、画幅和参考图上限。prompt、negativePrompt、width、height、seed 以及可选 referenceImage/referenceWeight 绑定到具体节点输入。节点 ID 与工作流私有设置只存在模板和 Adapter 中。

validate 读取 ComfyUI `object_info`，逐项检查节点、明确配置的模型、绑定、输出节点、分辨率、画幅和参考图数量。模型仅从 API 返回的节点定义识别，不扫描磁盘、不猜 checkpoint。缺模型或节点会在 submit 之前返回明确阻塞项。health 可用只说明 HTTP 服务可达，不等于模板已 Ready。

内置注册只信任仓库内置模板。应用启动时可读取已有项目明确保存的 loopback URL、checkpoint 和内置模板；没有配置时使用 `unconfigured-checkpoint` 形成可见的缺模型阻塞，不会自动选择本机模型。用户导入的任意工作流继续走 legacy Provider，未自动提升为新 Tool 的可信模板。

## 执行与产物

本机估价固定为 USD 0 micro，耗时 unknown；这只表示没有供应商计费，不估算电费、GPU、模型或维护成本。确认文案为本机执行确认，仍创建 RoutingDecision、Approval、Reservation、AITask 和 GenerationRecord。GenerationRecord 使用现有 workflowTemplateId/workflowVersion 记录模板身份，不修改 schema v8。

submit 冻结绑定后的 API workflow，获得 prompt_id 并写入 ToolTaskHandle。status 只查 queue/history；result 只读取该 prompt_id 的 history 输出描述并通过 `/view` 获取字节。它不扫描 ComfyUI output 目录，也不接收绝对路径。输出继续经过 ImageGenerationService 的大小、Sharp 解码、真实尺寸、hash、MediaStorage、Candidate AssetVersion、Review 和 Adopt。

参考图只能来自项目 AssetVersion 的已校验字节。Runtime 用任务控制的随机文件名上传，不向 ComfyUI 传本地绝对路径，不删除用户输入。无法证明临时输入归属时保留，避免误删外部服务中的文件。

cancel 只调用官方 queue 删除接口；服务不支持时返回 unsupported。recover 只查询已有 prompt_id，历史缺失返回 unknown 且 `resubmitAllowed=false`。它不会重新 POST workflow。

## 路由与验证

FIXED ComfyUI 缺服务、模型、节点或绑定时不回退。AUTO 先使用静态约束和只读预检；local-only / sensitive-local-only 排除 Cloud，ComfyUI 不 Ready 时可在允许 Cloud 的策略下选择 Image API。资源信息只来自路由输入和工具声明，RoutingPolicy 不主动探测 GPU。

fixture 覆盖可达/离线、object_info、模型/节点缺失、prompt_id、queued/running/completed/failed、history、view、上传、取消支持/不支持、重启历史缺失与 malformed response。fixture 通过仅代表模拟协议验证，不代表本机 GPU 或真实模型出图通过。实机验证只在用户已运行并配置服务时允许一次最小生成；应用不会为验收启动服务。

旧 `ComfyUIImageProvider`、旧队列、旧项目设置与导入工作流继续保留。07-08 未增加 migration，SQLite schema 仍为 8，package 仍为 0.6.0。
