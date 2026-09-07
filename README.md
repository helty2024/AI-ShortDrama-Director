# AI ShortDrama Director

面向 AI 短剧创作的桌面工作台，基于 React + TypeScript + Electron。
当前版本为工程骨架：提供桌面启动、React 欢迎页和只读 preload 桥接；剧本、分镜、素材生成等业务功能尚未实现。

## 环境与启动

- Node.js 24 LTS、npm 11、Git。
- 首次安装需要访问 npm registry 和 Electron 下载服务。

```bash
npm ci
npm run dev
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Electron 与 React 热更新开发服务 |
| `npm run typecheck` | 检查全部 TypeScript 源码 |
| `npm run lint` | 静态检查 |
| `npm run build` | 类型检查并构建到 out/ |
| `npm run preview` | 启动构建后的桌面应用 |
| `npm run test:smoke` | Electron 启动与 preload 隔离测试（先 build） |
| `npm run pack` | 生成当前平台的未安装应用目录 |
| `npm run dist` | 生成当前平台的分发包 |

开发主进程或 preload 变更由 electron-vite 处理重启/重载。
桌面命令会清除父环境的 ELECTRON_RUN_AS_NODE，避免被当作 Node 进程启动。
分发配置包含 Windows NSIS、macOS DMG、Linux AppImage；在对应系统构建。
正式发布前需另行配置应用图标、代码签名与 macOS 公证。

## 目录

```text
electron/
  main/           窗口与系统能力
  preload/        隔离的桌面 API 桥接
src/
  components/     可复用组件
  features/       剧本、分镜、素材等业务模块
  hooks/          React hooks
  services/       渲染侧服务
  shared/         跨进程类型约定
  assets/         静态资源
  App.tsx         初始工作台
public/           原样复制的资源
docs/             架构与项目文档
scripts/          工程脚本
tests/            桌面冒烟测试
.github/workflows/ 持续集成
```

## 工程约定

参见 [AGENTS.md](AGENTS.md) 和 [架构说明](docs/architecture.md)。
渲染进程禁用 Node 集成，开启上下文隔离和沙箱；仅通过 preload 暴露最小 API。
密钥不能写入源码或 VITE_ 环境变量，后续外部模型调用应在主进程中实现。
本项目尚未指定开源许可证。

## 参考

- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
- [Vite 文档](https://vite.dev/guide/)
- [electron-vite](https://electron-vite.org/)
