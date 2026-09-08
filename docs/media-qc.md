# Visual / Video QC

在生产看板展开 Shot 的 Visual / Video QC，选择具体素材版本，运行 Mock QC。报告显示 identity、costume、location、prop、action、camera、visualIntegrity、continuity 和 overall 九项 0–100 分数，以及 category/severity/description/affectedSubject/suggestedFix 和 suggestions。

当前 Mock 是确定性元数据规则：时长与 Shot 不符产生 severe action 问题，低尺寸产生清晰度 warning，生成指纹与当前连续性不符产生 severe continuity 问题。其余高分只是测试占位数值，页面明确显示 Mock；不能据此判断真人脸、服装或动作视觉质量。

## 人工审核

- Accept QC：接受报告，不批准或确认素材。
- Ignore warning：保留报告并记录人工忽略；Advisory 可采用，Strict 的严重问题仍不能满足完成。
- Reject version：用户明确拒绝该版本，报告与版本变更在同一事务。当前已绑定/主版本受到既有保护，需先确认替代版本，不能删除生产依赖。
- Regeneration Plan：按 issue 类型产生具体指令；人工确认后仅创建一个新候选任务。

报告固定绑定 AssetVersion，不追随 Asset Promote。连续性或导演动作变化会使报告过期，审核时校验 fingerprint；旧报告不会被覆盖。QC Provider 返回无效 schema 或调用失败不写报告，不修改资产。

## 重生策略

身份问题强化 Character reference；服装强化当前 costume；道具明确持有/可见状态；camera 明确运动；action 分成开始/过程/结束；artifact 保持语义并换 Seed。计划保存输入版本、报告、指令和 taskId，通过 ready/submitting/submitted 门闩禁止重复执行同一计划。被拒绝旧版保持不变，新版仍需 Review。

若提交准备过程失败后计划停留 submitting，请核对任务列表再明确新建计划；不会自动重复云请求。导入视频没有原 Provider 请求时，使用批量预览选择 Profile 后重新生成。

## Provider 扩展

MediaQCProvider 接收版本、Shot、已确认关键帧元数据、角色/地点/道具实体参考、连续性上下文和受控读取的媒体 bytes，返回 QCOutput。当前只有 Mock，无付费 Vision API。后续实现应在主进程通过 CredentialStore 取得 Key；图片/视频采样与上传限额、HTTPS、MIME、schema、timeout/abort、日志脱敏应成为适配器测试。renderer 不能自行获取凭据或任意媒体路径。
