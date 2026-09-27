# AI ShortDrama Director 0.7.0 Release Candidate

## 发布身份

- Release type：**Release Candidate**
- Product version：`0.7.0`
- Architecture：**0.7 frozen**
- SQLite schema：`9`
- Backup format：`4`
- Windows deliverable：x64 NSIS installer

本候选版本用于验证冻结架构的安装、升级、恢复与兼容性。它不是新增能力的开发版本，也不代表所有第三方供应商已经达到生产可用状态。

## 已验证的架构范围

- Tool Protocol 与版本化 Capability Contract
- RoutingPolicy、Tool Registry 与 Broker
- Generation provenance、lineage 与不可变输入快照
- 人工 Approval、Budget Reservation 与未知提交处理
- 第三方 Image API 的生产路径架构
- 第三方 Video API 的异步生产路径架构
- ComfyUI 的真实本地连接、单次生成、结果导入和恢复验证
- 最小 Workflow orchestration、人工审核与恢复语义
- schema 6–9、backup format 1–4 的兼容性与 lineage 降级显示

## Provider 验证边界

| Provider / Tool | 0.7.0 RC 状态 | 边界 |
| --- | --- | --- |
| ComfyUI Local | `VALIDATED` | 已完成一次真实本地图像生成及重启恢复；当前运行状态仍需现场只读探测，不自动启动服务。 |
| Packy Image | `PARTIAL REAL VALIDATION` | 已验证真实计费请求与部分响应处理；尚未完成稳定的 live E2E 输出采用，不能标记 production ready。 |
| Real Video Provider | `NOT VALIDATED` | 只有通用协议、fixture 与恢复验证；没有真实付费视频供应商验收。 |
| Reference Image / Video | `development-test-only` | 只供开发与诊断，不进入正式 packaged 生产工具列表。 |

Packy、Seedance、Kling、Veo、Sora、Runway、Hailuo 等名称不构成真实供应商可用性承诺。没有凭据或外部服务时，应用应保持可启动，并明确显示 `configuration-required`、`configured-unverified` 或 `offline`。

## 数据与升级边界

0.7.0 沿用稳定 `appId` 和 userData 目录。0.6.0 数据库启动时只执行已发布的 migration，目标 schema 为 9；旧项目、素材、任务和 Provider 数据保留。旧素材没有 GenerationRecord 时显示 `Legacy / provenance unavailable`，不会伪造来源记录。第二次启动不得重复 migration、生成 WorkflowRun 或修改历史远端任务标识。

备份 format 1/schema 6 至 format 4/schema 9 均可恢复。恢复后的任务、审批与工作流只保留审计历史：`executionAllowed=false`，历史审批不能再次消费，历史工作流不能 resume，活动 `providerTaskId` 会被清除并仅保留历史标识。

## 发布限制

- 安装包暂未代码签名，Windows SmartScreen 可能显示“未知发布者”。
- 应用不捆绑 FFmpeg / FFprobe；缺失时给出提示，基础工作台仍可使用。
- 不捆绑 ComfyUI、模型或 checkpoint，不自动安装节点，也不自动启动或终止 ComfyUI。
- 不执行真实 Packy、Video API 或其他付费生成来完成 RC 安装验收。
- 本候选版本不包含 Blender、Canvas、插件市场或最终剪辑功能。

## RC 通过条件

只有源码门禁、x64 NSIS 构建、全新安装、0.6.0 覆盖升级、schema 幂等、备份恢复、卸载、重装保留数据以及 secret/package audit 全部通过，才能标记 `0.7.0 RC PASSED`。任一项失败则保持 `0.7.0 RC BLOCKED`，且不创建 tag 或 GitHub Release。

安装验收使用主进程专用的 RC 隔离入口。它要求显式 `DIRECTOR_RELEASE_VALIDATION=0.7.0-rc`，并只接受系统临时目录下 `ai-shortdrama-director-release-tests` 的子目录；普通 packaged 启动不会读取测试路径，renderer 也不能设置该路径。
