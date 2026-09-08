# 受控媒体流

MP4 不再通过 IPC 返回 base64 整段内容。可信 media.read 请求由主进程签发随机 UUID 能力 URL：director-media://asset/token。renderer 只把 URL 交给 video 元素；URL 不含文件路径，无法解释为任意磁盘读取。

MediaBroker 每次请求重新按 projectId/versionId 查询登记版本，只接受 MP4；目录 key 格式和 realpath 必须位于受控 media 根内。删除项目/版本会使后续请求失效。令牌限 4096 项并在进程退出后失效，页面重新加载取得新 URL。

GET 支持单段 bytes=start-end、bytes=start- 和 suffix Range，返回 206/Content-Range；非法、多段或越界返回 416。HEAD 返回相同元数据但不读取内容，其他方法拒绝。文件句柄流会随读取结束/取消关闭，响应禁止缓存；不为播放完整读取 256 MB。CSP media-src 仅 self 和 director-media，协议声明 secure/standard/stream，未开放 file:、任意 HTTP 或 bypassCSP。

图片仍用主进程校验后的 data URI。生成下载、导入和当前 QC 的媒体缓冲属于其他路径，仍有 256 MB 视频上限；本阶段不把这些路径描述为全程零复制。测试覆盖 MP4 实际 Electron 播放、Range、后缀/越界/方法、删除后的 URL 失效与伪造路径拒绝。
