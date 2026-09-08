# Production Cost

CostLine 对应一个媒体 Task 或 QCReport，保留 taskId/versionId/shotId/sceneId/episodeId 归属。看板分别展示 image、video、qc 和总计，并可查看 Task/Shot/Scene/Episode 明细。

金额分为 estimatedMin/estimatedMax、actual 和 unknown。未知是 null，汇总单独显示 unknownEstimated/unknownActual 项数；“已知实际”小计不等于完整账单。不同币种分开汇总，不自动换汇或相加。无成功结果的 Task 仍可能产生费用，因此实际费用保持未知，不能据失败或取消写成免费。

生产设置可维护 Profile 每秒最低/最高价及币种，用户输入并保存后用于后续预览。批次确认保存报价快照到 Task.costMetadata，执行成功时保留到 AssetVersion.cost，修改当前报价不会重算历史任务。供应商未返回实际金额时 actualCost 为 null，usage 元数据也不被猜测为价格。

Mock 图片/视频/QC 标记 LOCAL，API 费用为 0；不包含本机电费、GPU 折旧、人工审核或磁盘费用。真实服务无报价时显示无法估算，必须明确确认费用后才批量提交。

重复重试同一远端 Task 不创建另一条成本行；明确重生创建新 Task，必须计为独立生产尝试。素材版本可追溯到对应 Task，历史 QC 保留各次报告成本，不因资产提升而错误改绑。
