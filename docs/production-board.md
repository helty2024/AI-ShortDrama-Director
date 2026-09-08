# Production Board

独立主导航“生产看板”，按 Episode → Scene → Shot 展示。筛选支持缺关键帧、待审核关键帧、缺视频、失败、待审核视频、QC 问题、已完成。卡片显示缩略图、Shot number、角色、地点、时长、Provider、keyframe/video/QC、成本，并可展开已有图片/视频审核。

每集摘要汇总 Shot 总数、关键帧和视频确认数、QC 通过、待审核、失败与成本。Scene 同样汇总，状态从实体、AssetVersion、Task 和 QCReport 计算，禁止人工维护另一份完成状态。

## 批量视频

1. 按 Scene / Episode 筛选后当前范围全选，或选择“仅选可生产视频”（已确认 keyframe 且没有 confirmed video），单批最多 20 Shot。
2. 可仅选 QC Reject 镜头；“仅重试 failed”重试现有 Task，保留远端 ID，不等于创建新任务。
3. 选择规则路由或指定 Profile，点击预览，查看各镜头 Prompt、Provider 与预计区间/未知项。
4. 勾选确认并开始生产。主进程验证预览未过期且有费用确认，先持久化批次/消费预览，再创建独立 Task。准备失败不阻断其他镜头。
5. 通过视频批次 TaskList 查看总进度、状态和错误，单项失败重试；取消将移除 queued 工作，running 按 Provider 能力尽力取消，不能保证停止远端计费。
6. 结果全部 draft；必须人工审核与 Confirm，批次不会自动批准或替换旧视频。

中断后已有 Task 按 Phase 4 providerTaskId/提交回执恢复。还没有 taskId 的准备项保留错误，可核对后重新选择未提交镜头预览。暂停/继续仍未实现，本阶段实现的是取消及重试。

## 完成定义

必须有正式 Shot、已批准固定关键帧和已确认视频。Strict：当前两种媒体都要有新鲜 accepted 且无 severe 问题的报告。Advisory：视频需 accepted 或明确 ignored；存在关键帧报告时同样需要处理，可人工忽略。未 QC 不会静默当作通过。严重问题在 Strict 下即便 ignored 也不能完成。

当前 QC 是 Mock 规则，Production Complete 只表示项目所选流程已满足，不证明视觉质量达到商业交付标准。本页面不包含时间线或成片剪辑。
