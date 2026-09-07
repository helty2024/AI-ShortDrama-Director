# AI ShortDrama Director

面向 AI 短剧创作的本地桌面工作台，基于 React + TypeScript + Electron。

## Phase 1 已实现

- 11 个严格类型化领域实体，共享 Zod schema 校验输入、数据库记录和渲染层响应。
- SQLite 本地项目持久化、版本化 migration、事务、项目级联删除与引用校验。
- 新建、列表、打开、重命名、删除项目；最近打开列表与启动恢复。
- 项目 / 剧本 / 角色 / 场景 / 道具 / 分镜 / 生成 / 素材库八个模块。
- 各业务模块可读取当前项目数据并创建基础草稿；分集、场次、分镜、镜头的新增需选择父级对象。
- 开发模式可手动载入“雨夜来信”示例：1 个项目、1 个剧本、1 集、2 个场次、3 个角色、2 个场景、2 个素材占位、2 个道具、1 个分镜表、6 个镜头。

当前不包含剧本编辑/自动拆解、媒体文件导入、AI Provider 调用、任务调度、完整版本历史界面。
生成任务只保存草稿，素材只保存元数据；示例资产不包含真实图像。

## 环境与启动

Node.js 24 LTS、npm 11、Git。首次安装/启动需要访问 npm 和 Electron 下载服务。

```bash
npm ci
npm run dev
```

启动后点击“新建项目”；或点击“载入开发示例”验证完整关系。
示例入口仅开发环境可用，同一数据库重复点击不会重复插入；删除示例后可以重新载入。
重命名通过 revision 检测过期更新。删除项目必须输入完整名称，关联记录同时删除。

## 命令

| 命令 | 用途 |
| --- | --- |
| npm run dev | Electron + React 开发与热更新 |
| npm run typecheck | 严格 TypeScript 检查 |
| npm run lint | Oxlint 静态检查 |
| npm run test:unit | 领域、持久化、迁移、引用和事务测试 |
| npm run build | 类型检查并构建到 out/ |
| npm run test:smoke | 先 build，再执行独立数据库的 Electron 端到端测试 |
| npm run preview | 启动构建后的桌面应用 |
| npm run pack | 生成当前平台未安装应用目录 |
| npm run dist | 生成当前平台分发包 |

开发启动脚本会清除 ELECTRON_RUN_AS_NODE。Vite 固定在 electron-vite 5 支持的 7.x 系列。
分发使用 electron-builder；图标、签名、公证仍需在正式发布前配置。

## 数据存储与测试隔离

数据库位置：Electron app.getPath('userData') 下的 workspace.sqlite。
默认 Windows 位置通常是 %APPDATA%/ai-shortdrama-director/workspace.sqlite。
SQLite 使用 WAL 模式；备份时先关闭应用，再复制整个 userData 目录，避免遗漏未检查点的 WAL 数据。
首次运行自动迁移，未知的高版本数据库会拒绝打开。数据库与媒体不进入 Git。

单元测试使用内存库或独立临时目录。桌面测试设置 DIRECTOR_TEST_USER_DATA 指向随机临时目录，完成后清理；打包应用忽略此变量。
不要用日常 userData 目录运行测试。Windows 沙箱若阻止 Electron GPU 子进程，需在允许桌面进程的环境执行冒烟测试。
Node 24 的 node:sqlite 可能输出实验性 API 提示；当前使用的 API 已在实际 Electron 运行时测试。

## 代码结构

```text
electron/main/       SQLite、迁移、领域写入、seed、安全 IPC、窗口生命周期
electron/preload/    只暴露类型化白名单请求 API
src/shared/         Zod 领域 schema、IPC 协议、桌面接口
src/services/       renderer 数据访问与响应校验
src/features/workspace/  Context/reducer、页面、表单对话框
src/components/     后续跨模块共享组件
src/assets/ public/ 静态资源
tests/unit/         关键业务单元测试
tests/electron.spec.ts  桌面端到端验证
docs/               架构和领域说明
```

详见 [架构说明](docs/architecture.md)、[领域模型](docs/domain-model.md)、[协作规则](AGENTS.md)。
项目尚未指定开源许可证。
