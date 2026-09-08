# 核心领域模型

唯一事实来源为 src/shared/domain.ts 与 src/shared/intelligence.ts。类型从 Zod strictObject 推导；所有持久化领域记录使用主进程生成的 UUID、UTC createdAt/updatedAt 和正整数 revision。正式子实体有 projectId、name、description、kind；智能记录有独立的结构化输入/输出。ID 引用避免循环对象。

| 实体           | 主要字段与关系                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Project        | name、description、genre、aspectRatio、language、lastOpenedAt                                                                                 |
| Script         | 原始 content、previousVersionId；编辑事实来源是下属 Scene.content                                                                             |
| Episode        | scriptId、order                                                                                                                               |
| Scene          | episodeId、locationId、order、结构化 content                                                                                                  |
| Character      | appearance（保留旧字段）、assetIds、bible                                                                                                     |
| Location       | assetIds、bible；可复用地点，与剧本 Scene 区分                                                                                                |
| Prop           | assetIds、bible                                                                                                                               |
| Storyboard     | episodeId、previousVersionId                                                                                                                  |
| Shot           | storyboardId、sceneId、order、durationSeconds、characterIds、locationId、propIds、assetIds、imagePrompt、videoPrompt、previousVersionId、plan |
| Asset          | mediaType、uri、status、source、previousVersionId                                                                                             |
| GenerationTask | 原有媒体任务元数据、输入/输出素材、shotId、providerTaskId、error                                                                              |

## 剧本与 Bible

Scene.content 包含 sceneNumber、heading、location（文本地点）、interiorExterior、timeOfDay、characters（临时角色名）、action、dialogue、narration、notes。对白逐项包含 nullable characterId、characterName、parenthetical、text。正式 locationId 与临时地点文本并存，未审核的名字不会自动变成正式实体。

Character.bible 包括姓名以外的别名、年龄、性别、身高、体型、面部、发型、肤色、性格、服装、配饰、妆容、行为/表情习惯、声音描述、continuityNotes、visualPrompt、negativePrompt；姓名使用实体 name，参考素材使用 assetIds。

Location.bible 包含 type、interiorExterior、geography、architecture、colors、lighting、timeState、weather、fixedAreas、continuityNotes、visualPrompt。Prop.bible 包含 type、appearance、material、size、condition、usedByCharacterIds、sceneIds、continuityNotes、visualPrompt。二者参考素材均使用 assetIds。

Shot.plan 保存审核后的 shotNumber、shotType、framing、cameraAngle、cameraMovement、focalLengthSuggestion、subject、action、emotion、durationSuggestion、characterRefs、locationRef、propRefs、continuityNotes；确认时同步写入 Shot 标准引用和时长字段。旧 Shot 的 plan 为 null。

## 智能记录

| 记录              | 职责                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| ImportPreview     | name、rawText、parsed（分集/场次/警告）、confirmedScriptId；确认前不创建正式剧本    |
| AITask            | input、status、attempt、error、sourceRevisions、resultIds                           |
| IntelligenceDraft | sceneId、sourceRevision、taskId、provider、promptVersion、payload、status、targetId |
| ProductionElement | category、name、description、sceneIds、draftIds、notes                              |

BreakdownItem 包含 category、name、description、confidence（0–1）、reason、attributes。13 类为 character/location/prop/costume/makeup/vehicle/vfx/sfx/environment/timeOfDay/mood/keyAction/continuityNote。前三类确认到现有实体，其余确认到 ProductionElement；多个场次的 Draft 可合并到同一目标。

Draft 状态 pending/confirmed/ignored；AI 只能生成 pending。人工编辑保留来源，确认检查 Draft、Scene 与合并目标 revision。同名也不自动合并；合并优先保留已有 Bible 字段，补充空字段和连续性说明，角色新名称补入别名。来源可经确认 Draft 的 targetId 回溯。

AITask 状态 queued/running/succeeded/failed/cancelled，输入类型 parse/breakdown/characterBible/shotPlanning；来源为当前场次、分集或剧本。原 GenerationTask 保留 Phase 1 媒体字段和 draft 状态，本阶段媒体任务不执行，后续迁移到统一媒体执行队列时保留 ID 与来源。

## 引用、事务与版本

Project → Script → Episode → Scene；Episode → Storyboard → Shot。Shot 引用的 Scene 与 Storyboard 必须同集，其角色/地点/道具/素材必须同项目且类型匹配。结构化对白角色、Bible 参考素材及道具使用角色/场次同样受引用检查。

revision 用于乐观并发和分析过期检测；previousVersionId 为不可变版本链预留，当前没有完整历史版本 UI。source 的 providerId/modelId/prompt/parameters 用于媒体来源描述，不得放密钥。Asset 支持 image/video/audio/document；placeholder 可以没有 uri，当前 seed 只有元数据。

v2 migration 为旧实体补默认字段，保留旧 Script 原文和既有关系；旧 Scene 的 name/description/order 映射为 heading/action/sceneNumber。新增字段默认值让 Phase 1 seed 和已保存实体继续有效。导入、审核与关系更新均有事务保护；失败不留下部分正式数据。

## Phase 3 视觉模型

新增 src/shared/visual.ts 叶子 schema：AssetVersion、AssetSource、ImagePromptPackage、VisualReference、ImageGenerationRequest、WorkflowTemplate、ProviderSettings 与 visual command 协议。domain.ts 与 intelligence.ts 引用该叶子，无运行时循环。

Asset 新增 approvedVersionId；旧 uri 在 v3 清为空，不授权访问旧外部路径，旧记录保留并等待明确导入。AssetVersion 使用独立 UUID、projectId、createdAt/updatedAt/revision、assetId、versionNumber、status、sourceType、mimeType、width/height/fileSize/hash、storageKey/thumbnailPath、provider/model/prompt/negativePrompt/generationTaskId/sourceAssetIds/metadata。

Character/Location/Prop 新增 visualReferences，项为 assetId/role/primary，assetIds 同步维护。Character 四类 face/fullBody/costume/expression；Location master/angle/lighting；Prop master/detail。主参考只有一个且必须已批准。

Shot 新增 approvedKeyframeAssetId 和 approvedKeyframeVersionId，后者固定审核版本，防止 Asset 提升影响已确认镜头。Prompt 参考快照同时保存 Asset 与版本 ID；新图只能生成 AssetVersion Draft。

AITask 扩展四种图像 input，保存完整 ImageGenerationRequest 和 providerOptions。新增 providerTaskId、progress、outputAssetVersionIds、provider、model、costMetadata、startedAt/completedAt。节点细节只在 Provider Options 和版本 metadata，Character/Shot 不包含 ComfyUI 节点配置。原 GenerationTask 媒体草稿继续保留，真实图像执行统一由 AITask 管理。

## Phase 4 视频与批次

`src/shared/video.ts` 为独立叶子 schema，集中定义 ShotDirection、VideoPromptPackage、VideoProfile、VideoGenerationRequest、ProviderDiagnostics、BatchGenerationGroup 和 CostMetadata。domain / visual / intelligence 引用叶子，Provider 网络实现只在主进程。

Shot.direction：startState、action、endState、subjectMovement、cameraMovement、performance、environmentMotion、speed、continuityNotes；时长沿用 durationSeconds。confirmedVideoAssetId 与 confirmedVideoAssetVersionId 引用同项目视频资产和审核版本。导演保存使用 expectedRevision。

Asset 仍以 kind=asset + mediaType=video 区分媒体，不另造重复实体。AssetVersion MIME 扩展 video/mp4，增加 duration/fps/codec、promptVersion、sourceKeyframeVersionIds 和 cost；其 UUID、hash、存储键及原始文件仍不可变。Approve 设置资产主版本；Confirm 显式固定 Shot 视频，生成新的 draft 不改正式引用。

AITask.input 增加 shot-video，保存 Prompt、Profile、参数、关键帧版本和 credentialRef 快照，绝无 Key；providerTaskId 负责恢复。costMetadata 与 AssetVersion.cost 包含 provider/model/duration/resolution/estimatedCost/actualCost/currency/billingMetadata，未知价格为 null，不能解释为免费。

BatchGenerationGroup 具有稳定 id、projectId、createdAt/updatedAt、kind、status 和每 Shot 的 taskId 或准备错误。它聚合任务状态，不持有资产审核权。v4 新建 video_profiles / production_batches，解析旧实体、版本和 Task 以补默认值，原始图片文件不移动；历史 migration 未修改。

## Phase 5 领域扩展

ContinuitySnapshot 具有 UUID、projectId、targetId（Scene 或 Shot）、source（manual/plot）、createdAt/updatedAt/revision 和结构化 state。CharacterContinuity 保存 costume/hairstyle/makeup、injuries 数组、carriedProps ID 数组、physicalState/emotionalState/position/notes；PropContinuity 保存 holderCharacterId/state/location/visible/notes；LocationContinuity 保存 timeOfDay/lighting/weather/environmentState/damage/notes。

QCReport 具有稳定 ID、shotId、versionId、Provider、连续性指纹、九类评分、issues/suggestions、审核状态和 revision。状态 pending/accepted/ignored/rejected 属于报告；只有用户选择 Reject version 才调用资产拒绝事务。报告不会因 Asset 主版本变化改绑。

BatchPreview 持久化每个 Shot 编译后的 Prompt、Profile、分辨率、预计区间、币种、错误和输入指纹，以及 submittedGroupId。RegenerationPlan 绑定 reportId/versionId/shotId，保存具体策略、换 Seed 选择、一次性执行状态和新 taskId。不同计划可以由用户明确再次创建，但没有自动循环。

ProductionSettings 保存 strict/advisory、preferredProfileId、resolution、motionComplexity 与手工报价；revision 防止设置覆盖。CostLine 一条对应一个媒体 Task 或 QC 报告，通过 Shot → Scene → Episode 归属汇总。Provider 请求/报告/版本历史不因报价设置变化重新计价。

ShotProductionStatus 与 Episode/Scene Summary 全部派生。Strict 完成要求当前关键帧和视频均有新鲜、人工 accepted、无 severe issue 的 QC；Advisory 要求视频报告 accepted 或明确 ignored，若存在关键帧报告也要接受或忽略。当前模型尚未强制电影级视觉模型认证；Mock 分数不证明视觉质量。
