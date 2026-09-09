# Windows 0.6.0 发布

## 产品与包

| 项 | 固定值 |
| --- | --- |
| package name / userData 子目录 | ai-shortdrama-director |
| productName | AI ShortDrama Director |
| appId / AppUserModelID | com.aishortdrama.director |
| version | 0.6.0 |
| 主交付 | AI-ShortDrama-Director-Setup-0.6.0-x64.exe |
| 目标 | Windows x64 NSIS，当前用户一键安装 |

`package.json` 与 `electron-builder.yml` 是构建配置来源。安装程序无需提升权限；创建开始菜单和桌面快捷方式，安装后通过快捷方式启动。`runAfterFinish: false` 避免静默安装隐式打开应用。不是仅提供 portable。

## 构建

Windows x64 / Node.js 24：

```powershell
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:smoke
npm run dist:win
```

`build` 只编译；`pack` 编译并生成当前平台 unpacked；`dist` 编译并生成当前平台分发包；`dist:win` 明确生成 x64 NSIS 且不发布。打包复用 `node_modules/electron/dist` 中 npm 安装的 Electron，与开发/测试运行时一致。锁文件固定实际依赖版本。构建工具依然可能从上游下载 NSIS、7-Zip，构建机需要网络或预置可信缓存。

本次网络连接 GitHub 超时，使用已有缓存成功构建。electron-builder 原生支持以下构建环境变量（不写入应用，不提交缓存二进制）：

```powershell
$env:ELECTRON_BUILDER_NSIS_DIR = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis\nsis-3.0.4.1'
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis\nsis-resources-3.4.1'
$env:ELECTRON_BUILDER_7ZIP_PATH = (Resolve-Path 'node_modules/electron-winstaller/vendor/7z.exe').Path
npm run dist:win
```

仅在这些缓存确实存在时使用；其他构建机应使用已验证的本机工具路径或让 builder 下载，不能照搬开发机绝对路径。

产物（相对仓库根目录）：

- `release/AI-ShortDrama-Director-Setup-0.6.0-x64.exe`
- `release/win-unpacked/AI ShortDrama Director.exe`
- `release/build-windows.log`（本次构建日志）
- `release/windows-validation.json`、`release/installed-test.log`、`release/installed-about.png`、`release/missing-ffmpeg.png`
- `release/shortcut-launch.json`、`release/uninstall-validation.json`

release 和测试产物不进入 Git。`latest.yml` / blockmap 是 builder 元数据，不代表已部署自动更新。

## 资源和运行时边界

Electron 44.2.0 自带 Node 24.20.0，安装版实际验证了 `node:sqlite`。React、React DOM、Zod、Sharp 位于 dependencies；构建、测试工具位于 devDependencies。Sharp / @img 原生模块配置 asarUnpack，已通过安装版 Mock 图片生成验证加载。

临时原创图标源为 `build/icon.svg`，PNG 和多尺寸 ICO 通过 `scripts/create-icons.mjs` 生成。Windows EXE 使用 ICO；窗口图标从 `process.resourcesPath/icon.png` 加载。renderer/preload/main 均打进 asar。内置 workflow templates、Prompt Compiler、Mock Provider 编译进主进程，不从源码目录读取。

| 数据 | 正式路径 / 来源 |
| --- | --- |
| SQLite | app.getPath('userData') / workspace.sqlite |
| 媒体与缩略图 | userData / media 内的登记资源 |
| 凭据 | userData / credentials，Electron safeStorage 加密 |
| 视频中间文件 | userData / video-work |
| 日志目录 | userData / logs（app.setAppLogsPath） |
| workflow / ComfyUI / Seedance Profile | SQLite 持久化；内置模板编译进主进程 |
| 备份、诊断、导出 | 主进程系统对话框明确选择的路径 |
| 凭据临时写入、媒体临时写入 | 对应 userData 存储目录内，完成后原子替换 |

固定 userData 为 `%APPDATA%\ai-shortdrama-director`。本机为 `C:\Users\Administrator\AppData\Roaming\ai-shortdrama-director`。不依赖 cwd 或开发盘符；安装版从 System32 作为工作目录启动仍通过持久化验证。renderer 无 Node / SQLite，contextIsolation 和 sandbox 开启，nodeIntegration 关闭。测试隔离变量只在开发版本生效。

## FFmpeg 与首次启动

不捆绑 FFmpeg/FFprobe；通过 PATH 或 `DIRECTOR_FFMPEG` / `DIRECTOR_FFPROBE` 主进程环境变量查找。启动检查每个工具最多 5 秒，缺失显示说明而不崩溃。视频处理需要两者，Mock 视频也不例外。安装版实际验证了正常 PATH 与缺少工具两种环境。

首次启动创建 userData 并迁移数据库，空项目列表正常展示。Mock 无需 API Key；ComfyUI 与 Seedance 为可选配置，缺失不阻止进入 Setup Wizard / 工作台。本次没有调用付费服务，不能将安装验证解释为真实 Provider 生产验收。

## 安装验证与复验

本机真实 NSIS 静默安装 `/S`，退出码 0；Windows 卸载注册项显示 0.6.0。原始开始菜单快捷方式打开了已安装 EXE 的窗口，随后正常关闭。业务测试通过 Playwright 直接启动同一已安装 EXE：

```powershell
node scripts/verify-packaged.mjs "$env:LOCALAPPDATA\Programs\ai-shortdrama-director\AI ShortDrama Director.exe"
```

此脚本明确在真实 userData 创建两个验收项目，保留结果供检查，不自动删除数据；请在专门的验收 Windows 用户下运行，先关闭应用。验证 UI 新建项目、About 0.6.0、重启持久化、安全窗口设置、模板/配置读取、Mock 图片生成、缺少 FFmpeg 提示，并保存报告截图。快捷方式、NSIS 安装与卸载由独立系统检查覆盖，不伪称业务自动化通过快捷方式连接。

本次卸载 `/S /currentuser` 返回 0，程序、快捷方式和卸载注册项消失；userData 保留且 SQLite 卸载前后 SHA-256 完全一致。安装、卸载交互采用静默模式；发布前仍可在普通用户的干净 Windows 机器上手动检查双击安装、SmartScreen、快捷方式、Windows 设置卸载。

## 升级、卸载与签名

保持 appId、package name 与显式 userData 路径稳定。后续相同身份的 NSIS 安装覆盖程序，数据留在独立 userData，启动只运行新增 migration；升级前备份整个目录。不修改已发布 migration，不保证迁移后降级可读。当前未配置自动更新。

`deleteAppDataOnUninstall: false`。卸载不会删除项目和凭据；需要彻底清理时，由用户备份后单独删除 userData。本次按要求卸载了验收安装，安装包仍保留，可再次安装。

当前明确 `win.signExecutable: false`，安装包与程序未签名，SmartScreen 可能提示未知发布者。后续取得证书后启用签名，并由安全构建环境注入 `CSC_LINK` / `CSC_KEY_PASSWORD`（配置文件已预留说明），不得提交证书或密码。当前没有签名、公证或自动发布。
