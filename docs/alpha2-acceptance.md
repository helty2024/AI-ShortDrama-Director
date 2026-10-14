# 09-01 Alpha.2 模拟验收历史记录（2f81c73）

内部测试版本：0.9.0-alpha.2。测试范围为公司内部本地模拟工作流。

## 结果

- Unit 433/433；Desktop/Smoke 36/36；lint、build 通过。原有 429/29 项保留，新增 4 项单元测试和 7 项桌面操作测试。
- 实际执行 NSIS 安装，使用安装后的程序在隔离数据目录完成全新项目：故事 → 剧本 → 角色/场景/道具 → 分镜 → 模拟关键帧/视频 → 候选批准 → 明确采用 → 可播放的确认视频。
- 批准后尚未绑定；采用后才产生镜头绑定。lineage 查询成功；重启可恢复确认视频、项目偏好与全局 ComfyUI 配置，不重复提交视频。
- 使用 alpha.1 验收数据副本进行升级兼容验证：原项目快照保持一致，未删除或重置用户数据。数据库 schema 10、备份格式 5 未修改。
- 设置页默认 AI 服务，基本设置/AI 服务/高级与诊断三个入口。无项目也能配置全局服务；项目偏好明确要求先选项目。技术表格、模拟工具、旧版兼容配置在高级入口访问。
- 1920×1080 和 2560×1440 实测设置页及六步页面无横向溢出；默认设置三个服务卡片完整可见。
- ComfyUI 真实本地 HTTP 就绪、模型缺失、离线、保存与重载有桌面测试；待确认预览期间拒绝更换连接。Packy 导入取消/格式失败与高级配置保存、检测有实际操作结果断言。
- CompShare 安装版原生导入已验证加密落盘、重启解密和无效测试凭据只读检测失败。没有伪造成功响应或真实生成。

## 云服务边界与实际影响

有效 CompShare API Key 的成功鉴权本轮未重新验收。复制到独立隔离环境的旧加密凭据未能解密，UI 如实提示连接检测未通过；未读取或输出真实密钥。安装版安全导入测试使用公开占位值 sk-ml-FIXTURE_ONLY，供应商只读请求真实拒绝该值。

当前导入行为保留已有配置不可覆盖的限制：缺失密钥时保留原配置，显示原因并禁用不能完成的重复导入。普通真实 Packy 生成受既有独立验收门禁约束。CompShare generationEnabled 仍为 false，不提供真实付费生成按钮。以上限制不影响已完整验收的本地模拟公司测试，也不代表真实图像/视频质量已验收。

## 安装包

- 文件：release/AI-ShortDrama-Director-Setup-0.9.0-alpha.2-x64.exe
- 大小：202295970 字节
- SHA256：c7bf9b38e17fd2828226ae624b45eee81140cf7cdcd0d2225e363fbcaa8f767d
- alpha.1 安装包保留；v0.8.0 tag/release 未修改；不创建正式 v0.9.0 tag。

## 本地证据

截图和验收 JSON 保存在 Git 忽略的 test-results/alpha2-installed/，不提交密钥、SQLite、原始 HTTP 响应或本机用户路径。

- 截图总览：test-results/alpha2-installed/截图总览.md
- 设置完整截图：fresh/settings-1920.png、fresh/settings-2560.png
- 设置操作：fresh/settings-comfy-offline.png、fresh/settings-h3-readonly.png、fresh/settings-packy-readonly.png、fresh/settings-advanced.png、fresh/settings-test-tools.png、fresh/settings-basic-project.png、fresh/settings-project-test-tools.png
- 六步：fresh/01-story.png、02-script.png、03-assets.png、04-storyboard.png、05-generate.png、06-confirmed-video.png；每步另有 -2560.png。
- 重启与兼容结果：fresh-acceptance.json、upgrade-acceptance.json；升级数据对应截图在 upgrade/。
- 安全导入：credentials/acceptance.json、credentials/installed-key-import-and-rejection.png。

## 本轮全部修改文件

- .gitignore
- README.md
- docs/alpha2-acceptance.md
- docs/test-ready-alpha-09-01.md
- electron/main/generation/comfy-settings.ts
- electron/main/generation/image-service.ts
- electron/main/index.ts
- electron/main/ipc.ts
- package-lock.json
- package.json
- playwright.config.ts
- scripts/prepare-alpha-runtime.mjs
- scripts/verify-alpha.ts
- src/App.tsx
- src/alpha.css
- src/components/creator-shell/ProjectNav.tsx
- src/components/creator-shell/TopBar.tsx
- src/components/creator-shell/modules.ts
- src/features/generate/GenerateCreatorPage.tsx
- src/features/operations/ProvenancePanel.tsx
- src/features/shot-videos/ShotVideosCreatorPage.tsx
- src/features/storyboard/StoryboardCreatorPage.tsx
- src/features/video/ProductionSettings.tsx
- src/features/visual/ProviderSettingsPage.tsx
- src/features/visual/ServiceCards.tsx
- src/features/visual/service-status.ts
- src/shared/alpha.ts
- src/shared/api.ts
- src/shared/compshare-minimax-h3.ts
- src/shared/service-settings.ts
- tests/electron.spec.ts
- tests/fixtures/alpha-journey.ts
- tests/fixtures/settings-audit.ts
- tests/settings.spec.ts
- tests/unit/release-version.test.ts
- tests/unit/service-settings.test.ts

COMPANY ALPHA ACCEPTANCE READY：YES（本地模拟工作流测试范围）。
