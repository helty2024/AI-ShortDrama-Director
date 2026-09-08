# Generation Router 与能力矩阵

规则函数 routeGeneration 接收 Shot、Profile 能力矩阵、用户偏好、项目比例、时长、分辨率与 RoutingRequirements（任务类型、尾帧、多参考需求）。过滤不可用或不支持的候选，再按明确偏好、真实服务/Mock、同币种报价排序，返回推荐 ID、理由和备选 IDs；没有符合项即返回不可用，禁止静默替换参数。

现有两个适配器是 Mock Video 与 Seedance / Ark-compatible。矩阵描述本项目适配器实际开放能力：图生视频为 true，文生视频为 false；首尾帧、参考图、时长、分辨率、比例、取消来自 Profile capability。即使供应商另外支持某能力，也不能在未实现的适配器中冒充可用。

“可用”目前指 Mock 或凭据已配置，不保证远端服务和账号模型权限在线。请先在设置执行 Provider 健康检查。不同账号的 capabilities 需按供应商真实能力配置；无自动模型基准测试。

运动复杂度 subtle/normal/complex 作为明确路由输入和理由展示。现有 Profile 没有可核实的不同动作质量评分，因此不编造 A 模型擅长对白、B 模型擅长复杂动作的黑盒规则。未来新增 Kling/Veo/Hailuo/ComfyUI Video 时实现独立 VideoGenerationProvider，并扩展有证据的能力特征与排序规则。

报价只在币种相同的候选间比较，不用汇率猜测跨币种成本。批量预览展示每 Shot 的选中 Provider、理由、编译 Prompt 和估算；最终提交仍由人确认，不由 Router 自动进行。
