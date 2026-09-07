# 视觉资产管线

## Asset 与 AssetVersion

Asset 仍为 entities 中 kind=asset 的稳定实体，保存项目、名称、mediaType、状态与 approvedVersionId。所有 Bible、Shot 都引用 Asset ID，不保存文件路径。新 AssetVersion 表保存每次不可变的图片内容信息；审核只改变 status/revision/updatedAt，绝不覆盖旧文件。

AssetVersion 包含 assetId、versionNumber、sourceType、MIME、宽高、字节数、SHA-256、storageKey、thumbnailPath、provider/model、正负 Prompt、generationTaskId、sourceAssetIds 与 metadata。来源枚举为 imported/generated/edited/derived/reference；本阶段实际创建 imported/generated，其他来源预留。

## 安全导入

素材库或 Bible 的导入按钮 → 固定 visual IPC → Electron 原生文件选择器 → 主进程大小/扩展名/实际解码校验 → 复制原图与生成缩略图 → 事务写入版本。

支持单帧 PNG、JPG/JPEG、WEBP，单图不超过 30 MB、4000 万像素，单次最多 20 张。sharp 验证实际格式并生成最长边不超过 320px 的 WEBP 缩略图。原图保留原始字节，hash 对原字节计算。新资产导入相同项目已有内容时返回既有资产；同一资产重复导入返回既有版本。向不同指定资产导入同内容允许各自版本，仍可由 hash 识别。

文件位于 userData/media/{projectId}/{assetId}/{随机文件名}。数据库只保存受控相对 key；外部导入路径不持久化。原文件搬走后仍可读取。预览只接受项目/版本 UUID，主进程查库并校验路径、真实路径边界后返回图片 data URL，不暴露任意文件读取接口。renderer 没有 Node 或文件系统权限。

## 文件系统与数据库一致性

先完成原图/缩略图临时写入与 rename，再进行短 SQLite 事务；图像任务的版本与 succeeded 状态一起提交。文件失败不会留下成功任务/版本。数据库失败、取消、重复导入或崩溃可能留下未引用文件，素材库提供“扫描孤儿文件”。扫描跨项目收集全部 live keys，仅报告，不自动删除。

删除 Asset 前检查实体引用、派生版本来源与任务来源；被引用则拒绝。删除记录时不删除文件，因此不会误删共享或旧版本文件。项目删除后的媒体同样可由孤儿扫描识别。需要管理员关闭应用、备份 userData 后处理孤儿文件；当前没有自动磁盘回收。

## 审核和引用

版本状态 draft/approved/rejected/archived。生成与导入默认 draft。Approve/Promote 在同一事务中修改 approvedVersionId、版本状态和用户明确选择的目标引用；旧主版本变 archived，文件不动。旧版本也可重新批准。

Bible 支持多图角色分类，只有一个主参考。主参考必须使用已批准资产，移除引用不会删除资产。编译器优先排列主参考，其他已批准参考也可传入图像任务。

Shot 保存 approvedKeyframeAssetId 与 approvedKeyframeVersionId：前者是正式资产关系，后者是审核时的版本固定标记。后续仅提升 Asset 主版本不会改变已确认 Shot。用户必须在批准界面明确选择 Shot 才替换其固定版本。仍被固定的版本不能 Reject；旧主版本被新版本替代后虽归档，仍能供已确认镜头读取。

## 素材库

网格、搜索、媒体类型/来源/版本状态筛选；点卡片查看原图、全部版本、Prompt、模型、生成元数据、实体引用。支持双版本 Compare、导入新版本和通过所选 Bible/Shot 重新生成。视觉生产面板每个版本支持 Regenerate：载入该版本正负 Prompt 后可编辑并再次生成。
