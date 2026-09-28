# 08-06 Shot Videos Creator Page

`分镜视频`是按分镜顺序审看镜头成片的 Creator 工作区，不是生产看板或剪辑时间线。左侧按持久化的 Episode / Scene / Shot 顺序列镜头，中央只播放当前镜头的一路视频，底部顺序条用于快速切换，右侧沿用 CreatorShell 的 ContextInspector。1920 宽度时检查器是 Overlay，主工作区不被三栏挤压。

正式视频严格由 Shot 的 `confirmedVideoAssetId` 和 `confirmedVideoAssetVersionId` 联合定位，并要求 `video/mp4`。绑定失效显示“当前确认视频不可用”；最新候选、最新任务输出都不会自动替代正式版本。没有确认视频时显示空状态；候选只能以明确的“候选预览”播放。

候选只从明确的 Shot 关系解析：视频 Task 输出、版本关联的生成任务、`shot.assetIds` 或 Legacy `metadata.targetId`。冲突归属不跨 Shot 借用。仅 MP4 进入候选；draft 待审核、approved 未绑定准备就绪、rejected 留在历史。批准不改变 Shot 绑定；“设为当前镜头视频”才执行采用。审核与 Generate 共用 `candidate-actions`，依次复用 Workflow、Direct Video API 和已有 Visual review 行为，没有新增生产 API。若生成工作流正等待用户，仍由其原有决策接口处理。

播放器只向 `media.read` 申请安全 `director-media://asset/` URL，不读取文件路径或 `storageKey`。原生 `<video controls>` 提供播放、进度、音量和全屏，切换镜头时卸载旧播放器，不自动播放。列表、候选卡和顺序条只读 WebP 缩略图；仅当前正式视频或被选中的候选加载 MP4。媒体错误在播放器内提供重试与查看来源，不使整页崩溃。画幅依据 AssetVersion 的宽高。

顺序条缩略图优先级：确认视频、固定关键帧、明确候选（标“候选”）、占位。它不提供刻度、轨道、剪辑长度、音频或转场；重排仍在“分镜”。SourceDetails 复用 `CandidateSource` 展示来源、工具、模型、时间、费用和可展开技术信息；无 provenance 的旧结果不会伪造记录。完整 QC、批量生产及成本看板仍在“验收与维护 → 旧版兼容入口 → 生产看板”。

分镜、生成、分镜视频共享 Creator 的 Shot 选中上下文。“去生成”带入 Shot 并请求视频模式；“查看分镜”保留 Shot。项目没有 Shot 时引导先建分镜；删除所选 Shot 后自动选择首个有效 Shot。当前正式包没有注册真实 Video Tool，这只影响新生成，不影响历史/还原项目中的已确认视频播放和候选审核。

本步不修改 package 0.7.0、SQLite schema 10、backup format 5，也不改 Tool Protocol、Broker、Routing、GenerationRecord、Approval、Reservation、Workflow transition 或 Video Adapter 注册。
