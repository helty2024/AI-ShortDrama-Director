# 生产验收

## 开始一个可复查的小场景

在“验收与维护”创建 3 Shot 验收项目，得到 1 集、1 场、2 角色、1 地点、2 道具。先在剧本和 Bible 页面修改为实际需要的内容。进入默认生产看板：生成关键帧 → 展开审核并批准绑定 → 预览单镜头视频 → 明确确认提交 → 审核视频 → 连续性与 QC → 接受报告 → 确认视频 → 导出分集 Manifest。Advanced 保留批量生产。Checklist 和 Summary 不把失败、未知费用或 Mock 当作实机成功。

## ComfyUI

在设置中配置本机地址、工作流和 checkpoint。Test Connection / Workflow / Results 读取 system_stats / object_info 并保存报告；离线或缺节点时是 Not validated。ready 不是全部验收通过。

通过看板执行真实图像任务。测试参考输入前，在素材库导入参考图片、审核后绑定 Bible，并配置支持 reference 槽的 API 工作流。默认文生图模板不能替代参考图输入验收。生成后检查原件、缩略图和版本审核；回到验收页重新检测。只有实际 Comfy 任务、匹配配置、参考输入、导入、保存、缩略图和批准版本都有证据时报告才为 validated。报告包含 baseUrl、testedAt、workflow、checkpoint、requiredNodes、result、executionMs、outputDimensions 与错误提示。

## 付费验证

选择一个已有批准关键帧的 Shot 与视频 Profile。最短支持时长和最低支持分辨率由主进程选择，展示 provider、endpoint、model、duration、resolution、首帧、完整 Prompt、费用估算和 credentialConfigured。未知价格不是免费。用户勾选确认后提交一次；当前输入与预览签名不同、或预览已经消费时拒绝提交。任务中心展示 remote ID、polling 状态、结果与错误。结果必须经过受控保存、FFprobe、AssetVersion Draft 和人工审核。

## 恢复验收

在任务中心找到运行中且已取得 remote ID 的真实 ComfyUI / Seedance 任务，选择“验证关闭后恢复”。保存编辑后确认关闭并重启；应用会使用既有 ID 继续等待或取回结果。验收记录跨进程 session 比较同一 ID 和输出版本。现有适配器支持已知 ID 恢复；未知提交不能保证恢复，Seedance 的持久化提交回执会阻止不明确提交再次计费。

HTTP 协议替身和模拟重启测试证明调用逻辑；它们不是云端实机证明。本次本机 ComfyUI 127.0.0.1:8188 不可达；真实 Seedance 未提交，二者均 Not validated。真实 3～6 镜头生产、参考输入质量、视觉连续性与云端恢复需要在配置完成后运行。Mock QC 仅验证规则和元数据，不证明真实画面质量。

## 本次自动化验证

执行 typecheck、lint、test:unit、build、test:smoke。单元用例包含 78 项；桌面用例包含项目 CRUD、剧本拆解、图片版本、实际 MP4 播放、QC/Manifest、Simple Mode 备份恢复和大项目启动/切换，共 7 条。规模夹具为 1 集、20 场、100 Shot、500 AssetVersion、500 Task；规模测试的媒体元数据不冒充真实生成素材。
