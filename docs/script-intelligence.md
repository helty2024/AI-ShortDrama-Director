# Script Intelligence & Production Breakdown

## 可操作流程

1. 打开项目，在“剧本”页新建 Script、Episode、Scene。左侧树可切换分集与场次，修改分集名、上移/下移场次、删除分集或场次。
2. 中栏编辑 sceneNumber、heading、location、内外景、timeOfDay、角色名单、动作、结构化对白、旁白、备注。对白保留正式 characterId 或临时角色名、括注和文本。
3. 停止输入约 650–950 ms 后自动保存。可立即保存，Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做。最多保留本次编辑会话 100 步历史，离开场次后清空。
4. 保存冲突或失败时保留本地内容，并停止自动重试，防止重复覆盖。可再次“立即保存”，或明确放弃本地修改后重新载入。未保存时切换页面/项目/场次会询问；窗口关闭通过 beforeunload 与主进程确认保护。保存中先等待完成。
5. 右栏“剧本解析 / 导入”接受 UTF-8 TXT、Markdown 和粘贴文本，点击“解析为预览”。解析任务只产生 ImportPreview，不产生正式 Script/Episode/Scene。原文完整保留，可审阅结构化结果、修订预览 JSON，或修改原文重新解析。
6. “确认导入正式剧本”在同一事务中写入 Script 原文、Episode 和结构化 Scene；重复确认同一预览不会重复导入。导入后从左侧选择新剧本。
7. 已保存场次可执行当前 Scene、本集或整个 Script 的 Breakdown；也可执行角色 Bible 建议或当前场次导演拆镜。再次点击分析会创建新任务与新 Draft，不覆盖历史结果。
8. 每张 Draft 卡包含来源 Scene/revision、Provider、Prompt 版本和状态。制作元素卡还包含置信度、来源说明。可以编辑、忽略、确认新建或选择现有同类别对象合并。
9. 确认 Character/Location/Prop 后，到角色/场景/道具页面打开 Bible，填写完整设定和参考资产。合并默认保留已有非空 Bible 字段，只补空字段、合并别名/来源备注；后续覆盖必须通过人工 Bible 编辑。
10. 服装、妆容、车辆、VFX、SFX、环境、时间、情绪、关键动作与连续性元素进入 Production Bible，可在分析面板展开查看。多个 Scene 的同类别 Draft 可以合并为同一制作元素。
11. Shot Planner 的结果先是 Shot Draft，可以调整镜号、景别、构图、机位、运镜、焦段、动作、情绪、时长、引用和连续性。确认才会创建正式 Shot，并为该集复用或新建 Storyboard。

## 解析策略与边界

第一版解析器是确定性本地解析器，不消耗模型额度。识别“第 N 集”“第 N 场”、1-1 场次标记、INT./EXT.、内/外景、日/夜、人物名单、角色（括注）：对白、动作和旁白。Markdown 标题符号会被识别为结构前缀。
未识别行放入动作，缺少标记时生成待整理场次并提示；所有情况都保留完整原文。第一版不支持 PDF/DOCX、扫描件、复杂 Fountain 格式或非 UTF-8 文件自动编码识别。
导入单次限 100000 字符，文件选择限 500 KB。预览 schema 校验失败时不写正式数据，原预览与原文仍在。

## AI 到正式数据的边界

Text Provider → Zod 校验 → 待审核 Draft → 人工编辑/确认/合并 → Entity 或 ProductionElement。
模型不能指定正式实体 ID，也不持有数据库写入能力。Shot 引用只能指向同项目的已知 Character/Location/Prop。
单任务批量结果在所有 Scene 成功后原子写入 Draft；任一输出无效、取消或源 revision 改变，整批不发布 Draft。
审核时再次核对 Scene revision、Draft revision 和合并目标 revision；过期草稿必须重新分析。确认有幂等保护，同一 Draft 不会重复创建实体。
正式 Scene 不因 AI 拆解而被修改；生产实体来源由确认后的 Draft 关联保留，Prop 额外记录出现场次。

## 删除与任务

删除 Scene 会删除关联 Shot/Draft；删除 Episode 会同时删除其 Scene/Storyboard/Shot。正式角色、地点、道具保留，删除的 Scene 引用从 Prop/ProductionElement 中清理。
项目删除会取消当前项目任务并级联删除全部数据。任务运行中源场次被删除，结果不会写入。
任务列表可在剧本右栏和“生成”页查看。支持 queued/running/succeeded/failed/cancelled，取消与显式重试；重新启动后中断的 running 任务标记 failed，等待用户重试。

## Phase 3

优先增加素材文件管理与引用预览，随后接入单张角色/场景参考图生成。复用任务队列、取消/重试、Provider 隔离和审核记录；图像/视频必须使用独立 Provider 接口。生成结果先成为待审核素材版本，再由人选择绑定到 Bible/Shot。
