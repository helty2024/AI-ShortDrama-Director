# 核心领域模型

唯一事实来源：src/shared/domain.ts。使用 Zod strictObject 校验，TypeScript 类型通过 z.infer 推导，无运行时循环依赖。
所有实体都有 UUID id、UTC ISO createdAt/updatedAt 和正整数 revision。由主进程创建 ID 与时间戳；renderer 不能指定。
除 Project 外，全部实体包含 projectId、name、description 和 kind 判别字段。

| 实体 | 主要字段与关系 |
| --- | --- |
| Project | name、description、genre、aspectRatio、language、lastOpenedAt |
| Script | content、previousVersionId |
| Episode | scriptId、order |
| Scene | episodeId、locationId、order；表示剧本中的一个场次 |
| Character | appearance、assetIds |
| Location | assetIds；表示可复用的物理/虚拟场景 |
| Prop | assetIds |
| Storyboard | episodeId、previousVersionId |
| Shot | storyboardId、sceneId、order、durationSeconds、characterIds、locationId、propIds、assetIds、imagePrompt、videoPrompt、previousVersionId |
| Asset | mediaType、uri、status、source、previousVersionId |
| GenerationTask | taskType、status、shotId、source、inputAssetIds、outputAssetIds、providerTaskId、error |

## 生成与版本扩展

source 包含 providerId、modelId、prompt 和 JSON parameters，用于记录可复现的模型调用输入，不含认证信息。
Asset 支持 image/video/audio/document；状态 placeholder/ready/failed，placeholder 可以没有 uri。
GenerationTask 支持 image/video/script；状态 draft/queued/running/succeeded/failed/cancelled。当前新增只创建 draft，不执行状态调度或外部请求。
revision 当前用于 Project 乐观并发，其他实体初始为 1；previousVersionId 为后续不可变版本记录预留，当前没有版本创建/回滚 UI。

## 引用约束

Project → Script → Episode → Scene；Episode → Storyboard → Shot。
Shot 同时引用 Scene 与 Storyboard，二者必须同属一集；可引用同项目的 Character / Location / Prop / Asset。
Character、Location、Prop 可以绑定参考 Asset；GenerationTask 可以绑定 Shot 和输入输出 Asset。
写入时验证引用 UUID、类型、归属与非自引用。所有 ID 仅存储引用，不嵌入循环对象。

基础草稿入口只填写名称和必要父级，其他字段使用显式空值或默认值。完整字段编辑、角色资产绑定和真实媒体写入将在后续阶段接入。
示例项目由 electron/main/seed.ts 在主进程生成；测试验证每个引用可解析、6 个镜头跨 2 个场次且素材与地点一致。
