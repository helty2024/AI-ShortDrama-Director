# Seedance / Ark-compatible 接入

## 设置

1. 打开项目的设置 → 新增 Seedance / Compatible Profile。
2. 官方预设 baseUrl 为 `https://ark.cn-beijing.volces.com/api/v3`，任务路径为 `/contents/generations/tasks`；填写账号实际已开通的模型或推理端点 ID。名称、endpoint、model、轮询与超时都可在普通表单设置。
3. 保存 Profile 后，从本地只包含 Key 的文本文件安全导入凭据。主进程加密存储，UI 仅显示已配置。原文本不会被应用自动删除，勿放进仓库。
4. “测试视频 Provider”只查询任务列表，不发付费生成；成功并不能证明模型权限及所有能力已开通。
5. 按模型真实能力设置支持时长/分辨率、首尾帧、Seed 和取消。默认保守能力为 5/10 秒、720p、首帧；尾帧与远端取消默认关闭。模型限制应以当前供应商文档为准。
6. 在 Shot 视频生产选择此 Profile、编译 Prompt、勾选费用确认并提交。

## 协议

适配器使用 Bearer 认证的 POST 任务接口，content 包含 text 与 image_url（base64 首帧，role=first_frame），可选 last_frame；duration、ratio、resolution、seed 按能力传递。GET `/任务ID` 轮询，成功后读取 content.video_url，单独下载并校验 MP4。DELETE 仅在明确支持 cancel 时调用。

接口字段和图像角色参考 [Byteplus ModelArk API reference](https://github.com/byteplus-sa/modelark-mcp/blob/main/docs/api-reference.md)、[BytePlus 视频生成](https://docs.byteplus.com/en/docs/Byteplus_LAS/video_gen_enhanced)；火山引擎官方创建任务文档入口：[创建视频任务](https://docs.volcengine.com/docs/82379/1520757)。不同区域和模型支持的参数可能不同，请核对账号文档；本项目不硬编码某个付费模型 ID。

Custom Compatible 使用相同表单更换 baseUrl / taskPath，但必须实现上述 Ark-compatible content/status/result 契约，任意第三方 URL 不会自动兼容。reference_image 与首尾帧模式不混用，本适配器不开放多参考图模式。不是所有成功健康检查都能证明取消、首尾帧或模型支持有效。

## 验证记录

本阶段通过本地 HTTP 替身验证认证 API、POST、状态、MP4 下载（不带 Authorization）和取消。没有提供真实账号密钥，也未执行 Seedance 付费生成；接入生产后应先手动确认单个短 Shot 的成本与质量，再扩大使用。
