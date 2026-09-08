# 首次设置与发布信息

启动后提供非阻塞 Setup Wizard：创建项目、检查 FFmpeg/FFprobe、可选 ComfyUI、可选 Seedance、进入工作台。可跳过；设置入口始终保留。关闭向导只保存本机 UI 偏好，不表示服务通过验收。

FFmpeg/FFprobe 需在 PATH 中，或通过主进程 DIRECTOR_FFMPEG / DIRECTOR_FFPROBE 指定；需要 libx264 和 WebP 支持。检查失败显示安装提示，不自动下载软件。Seedance Key 使用既有主进程安全导入，renderer 不获取明文。

“验收与维护 → About / 检查环境”显示应用版本 0.6.0、系统平台、构建时源 Git revision / 时间、SQLite schema 6 与工具版本。构建元数据对应构建时工作树基线；开发构建可含未提交修改，不冒充已发布签名包。打包继续使用 npm run pack / dist，本阶段未增加发布签名或自动更新。

默认生产看板为 Simple Mode；顶部 Advanced / Simple Mode 切换保存到 localStorage，不改变项目或 Provider 数据。数据库无法迁移时原生提示保留数据库并使用兼容应用或备份，不自动降级或重建数据。
