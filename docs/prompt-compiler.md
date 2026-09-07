# Prompt Compiler v1

实现位于 electron/main/visual/prompt-compiler.ts，是独立纯函数模块。Provider 仅做协议适配，UI 只编辑编译结果，不拼接角色或镜头提示。

- compileCharacterPrompt：注入稳定外貌、服装、声音/性格等 Bible 信息，默认清晰定妆构图。
- compileLocationPrompt：地点空间/建筑材质、色彩、光线/天气/时间、空镜母版。
- compilePropPrompt：外观/材质/尺寸/状态，道具母版。
- compileShotKeyframePrompt：当前 Shot 引用的角色/地点/道具 Bible、镜头计划与 Scene 时间，优先使用固定描述。

返回 ImagePromptPackage：positivePrompt、negativePrompt、subjectDescription、composition、camera、lighting、style、continuity、referenceAssetIds、providerHints、promptVersion。promptVersion 当前为 visual-compiler-v1。

Shot 自动加入 framing、cameraAngle、cameraMovement、focalLengthSuggestion、action、emotion、lighting 和 continuityNotes。连续性短语覆盖同一人物外貌、服装、地点、时间和道具状态。providerHints 记录源实体 revision 与可选上一 Shot 固定版本 ID；ComfyUI 节点配置仍只在 providerOptions。

主参考排列优先，其他参考图也参与；生成前解析为已批准版本 ID 并保存在请求快照中。没有批准版本的参考明确报错。是否将图像用于模型条件取决于工作流是否有 reference_image 槽，标准文生图模板只用文字。

用户改写正负 Prompt 后，任务保存实际使用文本与编译上下文。Regenerate 可载入历史版本文本，再编辑生成；任务重试使用原 request/seed/参考版本和工作流快照。重新编译会读当前 Bible。没有自动质量保证、外观识别或视觉 QC，后续可在此模块之上接 Prompt Compiler v2 / Skill，而不改 Provider 协议。
