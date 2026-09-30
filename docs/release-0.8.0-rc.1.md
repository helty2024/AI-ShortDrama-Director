# AI ShortDrama Director 0.8.0-rc.1 · Windows RC 验收

> 候选版，不是正式 0.8.0 Release。正式稳定版仍为 v0.7.0。

## 版本与范围

| 项目 | RC 状态 |
| --- | --- |
| Package | `0.8.0-rc.1` |
| SQLite | schema `10`；0.7.0 的 schema `9` 启动时升级一次 |
| Backup | format `5`；可恢复 format 1/schema 6 至 format 5/schema 10 |
| RC commit | 最终 `v0.8.0-rc.1` tag 的目标提交；构建元数据可用应用内「关于」核对 |
| Installer | `release/AI-ShortDrama-Director-Setup-0.8.0-rc.1-x64.exe`，Windows x64、NSIS、当前用户安装 |
| Checksum | 最终构建后生成的同名 `.exe.sha256` 是权威 SHA-256 记录；最终字节数和哈希同时记录在验收汇报中 |

Creator 主流程：**故事 → 剧本 → 资产 → 分镜 → 生成 → 分镜视频**。Creator Context 贯穿页面；候选结果的批准与采用为独立操作。旧项目无需手工转换或先访问 Legacy 页面。生产架构仍通过现有 Tool Protocol、Routing/Broker、GenerationRecord、Approval/Reservation 和 Workflow 运行；本次 RC 没有扩展生产工具或业务模型。

## Windows 安装与升级

- `appId` 保持 `com.aishortdrama.director`，产品名保持 `AI ShortDrama Director`；NSIS 单击、per-user、x64，创建桌面和开始菜单快捷方式。卸载配置 `deleteAppDataOnUninstall: false`。
- 正式 v0.7.0 安装包 SHA-256：`80C9D1E181D04C6B91712C933417FECBF4F671099412F4319694E054EFCD8A7B`。用该安装包创建含剧本、分集、场次、角色、场景、道具、分镜、镜头及导入图片的 schema 9 测试项目，再由 RC 安装包原地覆盖。
- 升级保留原项目 ID、Story 旧字段、实体/素材版本及时间戳；新增 `logline`、`style`、`worldview`、`creativeRequirements` 默认为空。再次启动不改写项目 revision/updatedAt。
- 实测 Windows 卸载项版本为 `0.8.0-rc.1`；已安装 EXE 的 Windows ProductVersion 映射为 `0.8.0.0`。安装程序未代码签名，不宣称具备 SmartScreen 信任。
- 验收全部使用 OS 临时目录下的隔离 userData；真实 AppData 在测试前已备份，卸载前后真实数据库 SHA-256 相同。不得把隔离测试数据、凭据或截图随安装包发布。

## 验收矩阵

| 验证项 | 实测结果 |
| --- | --- |
| `npm ci`、typecheck、lint、build | PASS |
| Unit | 397/397 PASS |
| Electron smoke | 22/22 PASS |
| `dist:win`、PE/版本/NSIS 信息 | PASS |
| 全新安装、schema 10、新建项目、六页面、关闭重启 | PASS |
| 正式 0.7 安装包 → RC 原地覆盖；schema 9→10 | PASS |
| 旧项目数据、Creator Journey、二次启动幂等 | PASS |
| format 1–5 恢复；恢复历史工作流不可执行 | PASS |
| RC format 5 备份与恢复 | PASS；打包版核对 Story 新字段、资产引用和镜头关键帧绑定；Generation provenance 的多输出与来源重映射由 unit 回归覆盖 |
| RC 卸载、快捷方式移除、userData 保留、重装项目读取 | PASS |
| 独立空 userData 的完全干净重装 | PASS |
| 打包版 Video Tool profiles 为空，测试适配器不注册 | PASS |
| 打包版 Creator 简化链路与图片导入 | PASS |
| 1920×1080、2560×1440 的分镜/生成/分镜视频 spot check | PASS |
| Media URL、越权路径及未知提交防重提回归 | PASS（unit + Electron smoke） |
| ComfyUI 离线、无有效 Video Profile | PASS（离线 unit + 打包版空 profile 验证） |
| 安装包 ASAR 中源码、测试数据、密钥、数据库检查 | PASS |

验收曾发现自动化在页面 `load` 完成前关闭窗口会触发通用启动错误框；测试加入加载完成等待后连续通过，全新启动、关闭与重启均无该错误。正式 RC 构建需以最终提交重新执行完整门禁并生成新的安装包/校验和；上述结果不得代替最终构建复核。

## 安全与限制

打包桌面端**没有真实 Video Tool**；Reference Video Protocol 仅供测试，不代表 Seedance、Kling、Veo、Sora、Runway 等服务兼容或已验证。测试环境变量不会在打包版注册 Video Adapter。没有配置有效云端 Profile 时，Creator 本地项目仍可使用；ComfyUI 未运行时应报告不可用，不自动启动、下载或调用付费服务。图片/视频由 `director-media://asset/` 受控访问，不以 `file://` 或 `storageKey` 暴露给渲染层。凭据仍由主进程加密存储，不进入备份、日志或安装包。

`shot.imagePrompt` 仍是 Legacy 字段；Shot Videos 不是 Timeline。尚无 Final Movie Editor 或 Canvas，Blender 未接入 Creator 主流程；Legacy / Advanced 技术页面继续保留。Windows RC 未代码签名。

## RC 结论与发布说明

在最终提交、最终安装包重新构建与复核、`origin/main` 同步及工作区干净后，才允许创建 `v0.8.0-rc.1` tag。正式 `v0.8.0` 不在本轮范围。

Release Notes：**0.8 Creator UI RC** 提供 Creator Shell、Story/Script、Assets、Storyboard、Generate、Shot Videos 与 Creator Context；批准和采用分离，schema 10、backup format 5。当前暂无正式 Video Provider。
