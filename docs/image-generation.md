# 图像生成与关键帧

## 可操作流程

1. 新建/打开项目，在“设置”选择 Mock Image 或 ComfyUI，并设置工作流、尺寸、seed、steps/cfg 与风格。
2. 进入角色/场景/道具，展开“视觉生产”。可导入或选择已有参考资产，审核批准后设主参考。
3. “编译并编辑 Prompt”查看结构化 Bible 的编译结果，必要时改正负 Prompt；“生成视觉资产”提交对应任务。
4. 图片以 AssetVersion draft 回到审核卡片；选择绑定目标后 Approve/Promote，将版本设为主版本并设置 Bible 主参考。
5. 在“分镜”展开 Shot 的“视觉生产”，可选择上一镜头关键帧作为参考，生成、对比并确认关键帧。
6. 改 Prompt、切 Provider 或再次生成可创建同一 Asset 的新版本。任务重试保存原 request/seed；成功任务的重新生成是新任务。

Mock 生成由 Prompt 与 seed 决定的彩色测试图，完整走文件、版本、审核和绑定流程，不伪装成真实角色图。不接真实视频 Provider。

## 任务队列复用

沿用 Phase 2 AITaskQueue、ai_tasks 表、单 worker 与任务状态机，增加 character-image/location-image/prop-image/shot-keyframe 输入。图像 input 包含 targetId、assetId 与标准 ImageGenerationRequest 快照；业务只知道 provider ID，不知道节点细节。

新增 providerTaskId、progress、outputAssetVersionIds、provider、model（工作流标识）、costMetadata 预留、startedAt/completedAt。版本记录 model 是具体 Checkpoint 或 custom-workflow；metadata 包括工作流、seed、prompt package、来源版本和目标 ID。

ImageTaskExecutor 异步调用 Provider、回收图片并准备文件，然后向公共队列返回事务提交函数；所有版本与任务成功状态原子提交。任意图片解码/存储失败，整批版本不发布。版本只进 Draft，不更新正式主参考或 Shot。

## 取消、失败和恢复

取消后本地结果不入库。Mock 响应 AbortSignal；ComfyUI 删除本任务的待运行 prompt，不调用影响其他任务的全局 interrupt。已经运行的上游工作流可能继续消耗 GPU，但本地取消不接收其结果，UI 保留 providerTaskId。

正常退出图像任务只停止本地等待，保留 running 和 prompt ID；重启时已有 ID 的任务恢复查询历史，不重新 POST。无 ID 的 running 标记 INTERRUPTED，用户先检查服务端再显式重试，避免提交响应丢失导致重复任务。失败且有 ID 的重试继续查询同一 prompt；已取消任务的显式重试会新提交。若服务端历史已清理，等待超时后需人工重新生成，不自动重复提交。

文本任务保持 Phase 2 恢复逻辑。所有自动回调检查取消状态，取消的迟到结果不会发布。用户点击重新生成可能触发真实计算，且自定义工作流可能包含外部计费节点；应用不自动进行提交重试。

## 连续性

关键帧编译从同一份 Character/Location/Prop Bible 注入稳定描述，结合 Scene 时间与 Shot 构图/机位/焦距/动作/情绪。保存 Prompt 版本、实体 revision、参考 Asset ID 和已批准 AssetVersion ID。可选上一镜头引用使用该 Shot 固定版本，不跟随 Asset 后来提升的新版本。

当前只是描述与参考素材层的连续性上下文，没有视觉相似度检测或自动 QC。下一步适合先加强关键帧批量生产、镜头版本锁定、素材磁盘回收和可复现工作流管理，再进入视频生成。
