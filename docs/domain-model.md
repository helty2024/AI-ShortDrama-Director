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
