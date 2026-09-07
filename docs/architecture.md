# 架构说明

React 渲染进程负责展示；Electron 主进程负责桌面生命周期与未来系统能力。
preload 在隔离环境中通过 contextBridge 暴露 window.desktop，只包含平台和运行时版本。
类型接口位于 src/shared/desktop.ts，目前没有 IPC 通道或外部 API 请求。

开发由 electron-vite 启动本地 Vite 服务并加载页面；构建后加载 out/renderer/index.html。
preload 输出为 CommonJS，以兼容 Electron 沙箱；主进程输出为 ESM。
默认拒绝新窗口、页面导航和权限请求。CSP 允许本地开发 WebSocket 与样式注入。
仅开发模式通过 Vite 插件允许 React Refresh 内联启动脚本；生产构建保持 script-src 'self'。
Vite 使用 electron-vite 5 支持的 7.x 系列，升级时先核对 peerDependencies。

后续模块建议按 src/features/ 下的 script、storyboard、assets 划分。
持久化、模型提供商、生成队列与素材存储方案待业务需求确定后再引入。
