# AI ShortDrama Director v0.8.0 · Final Release

当前正式稳定版为 **v0.8.0**。这是已验收 0.8 Creator UI RC 的正式晋升，不新增生产功能、不重构、不改变数据格式。

## 发布身份与 Creator 六阶段

| 项目 | 正式版本 |
| --- | --- |
| Package | `0.8.0` |
| SQLite | schema `10` |
| Backup | format `5`；兼容 format 1–5 恢复 |
| Release commit | `v0.8.0` tag 的目标提交；应用内 About 的 build revision 可核对 |
| Windows installer | `AI-ShortDrama-Director-Setup-0.8.0-x64.exe` |
| 校验和 | 同名 `.exe.sha256`；Release 附件与最终验收汇报记录字节数及 SHA-256 |
| GitHub Release | 正式版，`prerelease=false`、`draft=false`，作为 Latest stable |

Creator Shell 提供 **故事 → 剧本 → 资产 → 分镜 → 生成 → 分镜视频** 六个主页面。Creator Context 跨页保持 Scene / Asset / Shot；Candidate 批准与正式采用独立。Legacy / Advanced 技术页面保留。详见 [Creator Closeout](creator-ui-closeout-0.8.md) 及其阶段文档。

## RC validation lineage 与 CI

- RC tag：`v0.8.0-rc.1`；产品提交：`0e76838d2bd5490442fef3087dd6140d06bf2dee`。
- RC 已通过 Creator UI Closeout、Windows 全新安装及 0.7 升级、schema 9→10、format 1–5 恢复、卸载重装数据保留。历史记录见 [RC 验收](release-0.8.0-rc.1.md)。
- RC installer SHA-256：`B8B51361D163762C4B712496B4CEFCDE3B6F2263A03351DF7F4D3BA15D4F7760`。
- CI Closeout 提交：`ebf95ca884717aa34fc838f1381e0e624d66f77f`。仅修复 smoke 流程，显式关闭 modal Inspector 后操作后台，不修改 Creator 产品行为。
- [Windows main CI Closeout](https://github.com/helty2024/AI-ShortDrama-Director/actions/runs/37179416932) 已 success，Unit 397/397、Electron smoke 22/22。
- 正式版本必须重新执行 `npm ci`、typecheck、lint、Unit、build、smoke；最低门禁为 397 Unit / 22 smoke 全部通过。正式提交推送后必须等待对应 Windows main CI success，再创建正式 tag。历史 RC PASS 不替代正式包验收。
- 2026-10-04 正式版本本地门禁：`npm ci`、typecheck、lint、build PASS；Unit **397/397**、Electron smoke **22/22** PASS。正式 commit 的线上结果以 [main Windows CI](https://github.com/helty2024/AI-ShortDrama-Director/actions/workflows/ci.yml?query=branch%3Amain) 和发布验收汇报核对。

## Windows installer 与安装验收

正式包由最终 Release commit 执行 `npm run dist:win` 构建，不复用 RC 二进制。产品名与 appId 不变，NSIS x64 当前用户安装，桌面和开始菜单快捷方式，卸载时 `deleteAppDataOnUninstall: false`。安装程序未代码签名。

支持正式 **v0.7.0 → v0.8.0** 原地升级：schema 9 自动迁移至 10，旧 Story 字段、项目 ID、实体、媒体版本和 confirmed 绑定保留。新增 Story 字段默认空。支持 **v0.8.0-rc.1 → v0.8.0** 原地升级，保留 RC Story 新字段且不增加 schema migration。正式包仍使用 backup format 5。

验收必须使用真实旧安装包创建隔离数据，然后由正式安装包原地覆盖；核对项目数据、六页面、confirmed 视频播放、空 Video Tool profiles、ComfyUI 离线不可用及卸载重装保留。真实 AppData 先备份，不用用户项目作测试数据，不调用付费 Provider。

可复用脚本（路径必须位于 OS temp 下的 `ai-shortdrama-director-release-tests` 子目录）：

```text
node scripts/verify-0.8-rc.mjs fresh08 <installed-exe> <userData> <fixtures> <report> 0.8.0
node scripts/verify-0.8-rc.mjs retained08 <installed-exe> <same-userData> <fixtures> <report> 0.8.0
node scripts/verify-0.8-final-upgrade.mjs seed <old-installed-exe> <userData> <fixtures> <fixtures/seed.json> <0.7.0|0.8.0-rc.1>
node scripts/verify-0.8-final-upgrade.mjs check <final-installed-exe> <same-userData> <same-fixtures> <report> 0.8.0
```

升级脚本仅在隔离项目中导入本地 FFmpeg 测试视频并明确确认，验证升级后播放。ComfyUI 离线诊断使用未运行的 loopback 地址，不提交生成任务。脚本、截图、数据库、媒体和凭据不进入安装包。最终校验和在构建后生成，commit 通过 tag/内嵌 build revision 关联，避免把构建产物或自引用 commit hash 提交到源码。

## Known Limitations

- 尚无正式 Video Provider；Reference Video Protocol 仅测试，不代表真实供应商兼容或验收。
- Shot Videos 不是 Timeline。
- 无 Final Movie Editor。
- 无 Canvas。
- Blender 未接入 Creator 主流程。
- Legacy / Advanced 页面继续保留。
- Windows installer 未签名，不宣称具备 SmartScreen 信任。

本次不改变 Tool Protocol、Routing/Broker、GenerationRecord、Approval/Reservation、Workflow、Image/Video API 或 ComfyUI Adapter。正式发布只在全部门禁、安装升级验收与 main CI 通过后执行；不移动 v0.7.0 或 v0.8.0-rc.1 tag。
