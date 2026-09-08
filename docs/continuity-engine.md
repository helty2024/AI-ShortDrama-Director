# Continuity Engine

## 使用

生产看板选择 Shot → 读取 / 编辑连续性。字段表单可修改角色服装、发型、妆容、伤势、持物、身体/情绪状态与位置；道具持有角色、状态、位置及可见性；地点时间、光照、天气、环境和损伤。选择“剧情动作更新”记录剧情造成的状态变化，再保存；后续镜头即时使用新状态。这里的剧情更新由人确认输入，不自动猜测剧本事实。

保存范围可选当前 Shot 或当前 Scene 初始快照。连续性表单具有未保存保护，修改后离开沿用工作台保护；版本冲突保持表单内容，重新读取再决定合并。

## Resolver

按当前 Storyboard 的 Shot.order 排序，依次计算：Bible 基础值 → 上一 Shot 的结构化状态 → 进入新 Scene 时的初始快照 → 当前 Shot 的显式快照。角色/道具暂未出现时仍保留其最近状态，重新出现时可继承；跨场次地点的光照/天气以新场次初始化，避免错误沿用。

覆盖按 characterId/propId/locationId 匹配，不覆盖基础身份实体。快照存在代表该主体字段的明确完整覆盖，不采用空字符串代表“继承”的隐式语义。后续镜头的显式快照优先于上游变化。当前继承边界是同一 Storyboard，不自动连接不同 Storyboard 或不同 Episode。

ContinuityContext 输出结构化 state、previousShotId、snapshot sources 与 fingerprint。指纹由当前状态、导演动作/计划/时长及 Bible 引用 revision 生成；单纯 Confirm 视频导致 Shot revision 变化不会误判连续性已变。图片/视频编译器使用相同 Resolver，并在生成版本记录指纹。QC 检查状态变化，历史报告继续绑定原版本。

解析器不会对画面做视觉识别，不会把自然语言动作自动转成伤势/服装事实。未来可接文本模型生成 continuity change draft，经人工确认后再调用当前保存接口。
