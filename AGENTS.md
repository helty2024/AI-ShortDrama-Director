# 项目协作指南

## 项目目标
构建 AI 短剧创作桌面工作台。当前为初始化阶段，不将占位模块描述为已实现功能。

## 架构边界
- electron/main/：Electron 生命周期、窗口、文件系统与系统能力。
- electron/preload/：通过 contextBridge 提供最小化、明确类型的 API。
- src/：React UI；禁止直接导入 Electron 或 Node 原生能力。
- src/shared/：跨进程类型，不放置带副作用的运行时代码。
- src/features/：按业务功能组织；共享组件放 src/components/。

## 编码要求
- 使用 TypeScript，开启严格类型检查；避免 any。
- 2 空格缩进、UTF-8、LF，遵循已有代码风格。
- 优先最小可维护实现，不引入未被需求使用的框架或抽象。
- UI 默认中文，注意键盘访问和可读性。
- 保留其他协作者的改动，不擅自清理用户文件。
- 新增命令、目录或行为时同步更新 README。

## Electron 与数据
- 保持 contextIsolation、sandbox 开启，nodeIntegration 关闭。
- 不向渲染层暴露原始 ipcRenderer、任意文件操作或 shell 执行接口。
- 新增 IPC 时校验参数、发送方和访问范围。
- 密钥、用户素材、生成视频和本地缓存不得提交到 Git。
- 依赖变更同步提交 package-lock.json。

## 验证
提交前运行 npm run lint 和 npm run build。
修改窗口、preload 或启动流程后运行 npm run test:smoke。
新增业务逻辑时添加覆盖真实行为的测试。
验证失败时说明实际原因，不声称未执行的检查通过。

## Git
- 默认主分支 main；后续工作分支使用 codex/ 前缀。
- 使用 Conventional Commits，例如 feat:、fix:、chore:、docs:。
- 不强制推送，不重写已共享历史。
