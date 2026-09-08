# ComfyUI 图像 Provider

## 接入

运行本机 ComfyUI（通常为 http://127.0.0.1:8188），确保已安装至少一个适配标准 SD 文生图节点的 Checkpoint。在本应用“设置”选择 ComfyUI，填写 Base URL，点击“保存并测试连接”。连接结果展示 CheckpointLoaderSimple 可用模型；将实际文件名填入 Checkpoint。

Base URL 允许 HTTPS 或本机 loopback HTTP，不接受 URL 账号/密码、查询参数、片段或重定向。不在 renderer 发网络请求，不通过 UI 收集 API Key。本版面向无认证本地 ComfyUI；不是 Comfy Cloud 认证客户端。

选择标准 character-base/location-base/prop-base/shot-keyframe 任一模板，配置宽高、seed、steps/cfg，保存后在相应 Bible 或 Shot 中生成。标准模板使用 CheckpointLoaderSimple、CLIPTextEncode、EmptyLatentImage、KSampler、VAEDecode、SaveImage；没有写死模型名，但用户需选择与这些标准节点兼容的本机模型。Flux/SD3 等不同模型架构应导入对应自定义工作流。

## 工作流模板

从 ComfyUI 导出 API-format JSON，再通过原生选择器导入，最大 1 MB、500 节点。普通前端画布 JSON（nodes/links）不是 API 格式，会拒绝。未知 class_type 原样提交由 ComfyUI 验证，本应用不执行脚本或安装节点。

在节点 inputs 中填写变量：positive_prompt、negative_prompt、seed、width、height、steps、cfg、checkpoint、reference_image，以及 reference_image_2、reference_image_3 等多图槽。用双大括号包围，例如 {{positive_prompt}}。完整数字变量槽保持数字类型；字符串内插值保持字符串类型；缺少变量明确报错，不猜测节点结构。

标准模板为文生图，不含图像条件节点。要实际利用参考图，需要导入含 LoadImage/对应图像条件节点的工作流，并配置 reference_image 槽；已批准参考图由主进程上传，slot 替换成上传名。自定义节点须由用户在 ComfyUI 安装，本应用不假定存在 IPAdapter、ControlNet 等节点。

## 协议与错误

健康检查 GET /system_stats 与 /object_info/CheckpointLoaderSimple；提交 POST /prompt，保存 prompt_id；/ws?clientId=... 读取匹配 prompt_id 的 progress。HTTP /history/{prompt_id} 是完成与输出的最终依据，WebSocket 断开时仍轮询历史。

POST /upload/image上传参考；GET /view 回收历史返回的图片。拒绝路径穿越描述符，单图最多 30 MB、单任务最多 8 图，下载后再次实际解码。HTTP 请求超时 15 秒，完成等待上限 30 分钟。节点错误、无图输出和协议错误都规范化为可见失败，不写正式资产。

POST /queue 的 delete 只取消本任务排队项。本版不使用全局 /interrupt，避免停止别人的工作流；已经运行的计算可能继续，结果在本地被丢弃。恢复使用已有 prompt_id，绝不在不确定状态下自动重交。

已用本地模拟 HTTP/WebSocket 服务验证提交、上传、进度、历史、下载、取消、恢复和错误。本次没有连接用户真实 ComfyUI、具体 Checkpoint 或自定义节点做实机出图验收；Mock 完整闭环可直接体验，真实环境需上述配置。

协议依据：[ComfyUI Server Routes](https://docs.comfy.org/development/comfyui-server/comms_routes)、[ComfyUI Server Messages](https://docs.comfy.org/development/comfyui-server/comms_messages)。

## Phase 4 Diagnostics

新增可达性、Checkpoint、缺失节点、必需输入、工作流变量及输出检查，以及 Provider Ready 和单镜头 Test Generation。详见 [生产批次与实机准备](production-batch.md)。Ready 是预检结果，仍需实际执行测试确认 GPU 与模型运行能力。
