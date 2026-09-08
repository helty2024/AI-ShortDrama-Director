# VideoGenerationProvider

契约位于主进程 video/providers.ts：id / displayName / capabilities / healthCheck / submit / getStatus / cancel / fetchResult / normalizeError。统一远端状态 submitted、queued、processing、succeeded、failed、cancelled；本地 Task 使用原有 queued/running/succeeded/failed/cancelled。

Profile 包含 baseUrl、taskPath、model、credentialRef、timeoutSeconds、pollingIntervalMs 和 capabilities。schema 与领域对象不包含具体 HTTP 请求实现；新增非兼容服务应实现独立 adapter 并加入 factory，不能靠更换 URL 假定协议相同。

每次任务保存 Profile 与请求快照，重试沿用原任务参数和认证引用。主进程执行 POST 一次，然后保存 providerTaskId 并异步轮询。回执位于 userData/video-receipts：发送前先创建 intent，返回 ID 后原子 rename 回执，再更新 SQLite。即使 SQLite 更新失败，重试仍可从回执恢复 ID。回执不含 Key、Prompt 或素材 URL。

查询失败、超时、结果下载失败和本地落盘失败均保留远端 ID。视频任务取消永不清除它；取消远端是尽力操作，capabilities.cancel=false 时只停止本地等待，不能宣称停止计费。进程关停停止本地轮询以供恢复，不主动取消付费远端任务。

默认 Mock 在可配置 FFmpeg 工具上产生真实确定性 MP4，无网络。CI 安装 FFmpeg 并使用临时数据库与媒体根目录。mocked HTTP 测试验证 Seedance 提交/查询/下载/取消协议，不能替代特定账号模型的付费验收。

云端 API URL 必须 HTTPS，本机 HTTP 为开发例外；禁止认证信息、查询串、hash、重定向。下载不携带 API Authorization，检查 HTTPS、内网 DNS、MP4 MIME、256 MB 流式大小上限，然后 FFprobe 实际解析。异常向 UI 返回规范化错误，不回传原始 Provider 响应正文或凭据。
