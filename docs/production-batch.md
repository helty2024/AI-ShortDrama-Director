# 批量关键帧生产

分镜页展开批量面板。可按 Scene 或 Episode 筛选、当前范围全选、仅选缺少 approved keyframe，或逐 Shot 多选。单批最多 20 个，超过范围请分批操作。

批量编译逐镜头展示 Prompt；批量生成创建持久化 BatchGenerationGroup，各 Shot 独立 Asset 和 Task。批次聚合成功/失败计数及任务进度，错误不会提升正式资产，也不阻断后续准备。执行任务失败使用原 Task 重试；准备阶段失败没有 Task，可点击准备失败项重试生成一个单镜头批次。

暂停/继续保留状态字段与禁用入口，尚未实现调度暂停。批量视频成本确认保留禁用入口；底层 shot-video Task 与 kind=video 批次结构可复用，但当前不自动提交整集付费视频。

## ComfyUI 实机准备

设置图片 Provider 为 ComfyUI，配置本机 URL、实际 Checkpoint 和 API 工作流，保存后运行 Diagnostics。它查询 system_stats / object_info，检查节点存在、必需输入、Checkpoint、变量替换和输出节点，列出具体缺失项。未知自定义节点不会被假定已安装。每次 Comfy 生成也执行预检。

Provider Ready 表示静态诊断通过，不代表 GPU 内存足够或模型加载成功。选一个测试 Shot，点击一键 Test Generation，之后到生成页查看任务及报错，审核结果后才能作为关键帧。

本次开发机已有 FFmpeg/FFprobe，但默认 `http://127.0.0.1:8188` 未连通。已验证 Mock 和 Comfy HTTP/WebSocket 替身，真实 Comfy GPU 出图未验证。启动 ComfyUI 后重新诊断并做单镜头测试。
