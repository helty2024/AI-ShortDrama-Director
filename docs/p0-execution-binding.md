# P0-1：不可变执行配置绑定（2026-10-22）

本轮为现有 Tool Protocol、Adapter、Broker、GenerationRecord 的增量整改，未替换供应商架构。收费 API 调用为零；保留此前工作区改动，本轮没有提交代码。

## 审计结论与实现

原有 GenerationRecord 已不可变保存模型、适配器版本、能力输入参数、路由、估价及费用授权；全局服务目录也保留配置修订和旧凭据引用。实际缺口是恢复入口按 toolId 查找当前实例，未验证原端点、服务实例、凭据与能力配置；Broker 的执行还会因当前注册项被替换而失效。

新增 `execution_bindings`，按项目以 GenerationRecord UUID 与 Task UUID 唯一关联。在现有确认事务中，创建原费用授权/预留和任务记录后、写入提交意图前，保存以下不可变快照：

- 供应商、服务 UUID、服务修订、端点；未纳入全局目录的本机/兼容工具保留明确空服务身份，以完整配置 hash 区分实例，不伪造服务 UUID。
- 原适配器 ID、版本、完整 Tool Descriptor 与能力配置、profile（含凭据引用，不含密钥/认证头）。
- 原能力输入、请求指纹、费用审批与条目完整快照、预留 UUID、币种及授权金额。

SQL 唯一约束、项目/记录/任务复合外键及不可更新触发器保护绑定。配置采用稳定键顺序的 SHA-256 校验。提交前复核配置；恢复前复核原任务、参数、配置、审批及预留的对应关系，不使用当前默认值填补未知信息。

Broker 仍负责指纹、句柄归属及输出入库。只有主进程绑定解析器能传入已核验的历史实例，该实例不加入新任务路由；同一执行中查询、结果下载、取消均保持原实例。远端句柄归属也按配置 hash 隔离，防止不同账户/端点的同名任务 ID 冲突。

恢复先使用匹配的旧实例；重启后以保存的 schema 配置与服务目录原修订重建现有适配器。没有动态加载第三方代码。配置、适配器版本、能力、凭据引用不匹配时，在供应商访问前拒绝替换；旧凭据失效只会使原查询失败，不尝试新凭据或默认供应商。恢复不会调用 submit。未知提交且没有远端 ID 的任务仍保持未知，不建立第二次请求。

图像/视频服务的默认选择、非文本配置编辑可在旧任务保留时进行；正在执行的旧任务拥有独立绑定。文本配置仍使用原有空闲门禁，seedance-20 的冻结配置与实验路径未修改。

## 修改文件

| 范围 | 文件与职责 |
| --- | --- |
| 新增契约与迁移 | `src/shared/execution-binding.ts`：无副作用 Zod 契约；`electron/main/generation/execution-binding-migration.ts`：schema 11 增量表/外键/触发器。 |
| 绑定与解析 | `electron/main/generation/execution-binding.ts`：捕获、hash、审批校验、历史实例缓存与安全阻断；`electron/main/generation/execution-recovery.ts`：复用既有适配器构造器重建原实例。 |
| 确认与恢复 | `electron/main/generation/image-service.ts`、`video-api-service.ts`：确认事务捕获绑定，查询/恢复/下载使用绑定，批次配置指纹纳入服务实例与修订。 |
| 现有基础设施 | `electron/main/tools/broker.ts`、`registry.ts`：受信任的绑定执行与句柄隔离；`electron/main/generation/ai-services.ts`：精确旧修订查询与非文本配置更新门禁；`electron/main/index.ts`：原生服务身份与恢复工厂组合；`electron/main/database.ts`：顺序执行 schema 11 迁移。 |
| 备份 | `electron/main/operations/backup.ts`：format 6 / schema 11；绑定配置脱敏、审批仅作历史保存、`recoveryAllowed=false`；继续支持旧 format 1–5。 |
| 新增/增强测试 | `tests/unit/execution-binding.test.ts`、`video-api.test.ts`、`ai-services.test.ts`：迁移逐行保持、失败回滚、旧任务缺证阻断、服务 r1→r2/模型/地址/密钥切换后恢复与授权隔离、未知不补发、备份恢复禁执行。 |
| 版本断言与夹具 | `tests/unit/{approval-migration,approval-backup,database,generation-backup,platform-migration,release-version,story-creator,workflow-migration,visual,video,production,operations,intelligence}.test.ts`、`tests/fixtures/provenance.ts`、`tests/electron.spec.ts`：只调整 schema/backup 预期和旧库模拟。 |
| 使用说明 | `README.md`、本文件。 |

## 兼容性与遗留限制

1. schema 10→11 只新增绑定表，不回填、不改写历史 GenerationRecord、UUID、素材、任务或费用记录。真实旧库在只读备份上的迁移已逐字节比较历史行，原生产库未打开写入。
2. 缺乏可信原配置证据的旧未完成任务保留可读历史，但不能根据今天的默认配置猜测恢复。后续若要解锁，须独立审计原配置证据，不能静默回填。
3. 恢复能力仍取决于原适配器已经支持的协议；不为同步或不支持恢复的供应商新增接口。不兼容版本、撤销的凭据、不可用的旧服务或失效的旧下载安全边界会安全阻断。
4. 非文本执行绑定不转移本地费用审批，更不代表供应商已提供人民币硬限额。seedance-20 A/B 预览及其费用阻断成果未变，本轮未执行该 A/B。
5. 升级后的 schema 11 由本构建读取；旧应用不支持数据库降级，回退应使用升级前备份。备份恢复仅转移历史与素材，不转移远端任务执行/收费权限。

## 验收证据

| 项目 | 结果与证据 |
| --- | --- |
| 静态检查、构建 | `npm run lint`、`npm run build` 通过；`test-results/p0-binding-{lint,build}.log`。 |
| 全量 unit | **492/492**；`test-results/p0-binding-unit.log`。 |
| 最终受影响回归 | **48/48**；`test-results/p0-binding-final-regression.log`。进一步加强同一服务 r1→r2 断言后，目标测试 **1/1**；`test-results/p0-binding-final-isolation.log`。 |
| Electron smoke | 首轮 **42/43**，唯一失败是 About 测试仍断言 schema 10；改为 11 后该项 **1/1** 复验通过。其余42项未重复运行。日志 `p0-binding-smoke.log`、`p0-binding-smoke-recheck.log`。 |
| 双服务协议行为 | 两个本地 HTTP fixture：旧任务只向旧地址查询并下载真实本地 MP4；替代服务查询/下载计数均为0；新模型使用新审批，旧审批不能绑定新模型；未知任务不补发。不是供应商真实生成验收。 |
| 真实库迁移 | `test-results/p0-execution-binding-20261022/real-db-migration.json`：10→11、历史行逐字节一致、原库未改、外键违规0、未伪造历史绑定。 |
| Windows 打包应用 | `packaged-bootstrap.json`：隔离真实旧库副本两次启动/重启，schema 11，历史行未改变，生成 POST 为0。没有安装覆盖用户旧版本。 |
| 包内容 | `package-integrity.json`：ASAR 中主进程与当前构建字节一致。Skill 源文件无 diff，原 A/B 四份请求的 hash 未变。 |

Windows 测试安装包：`release/p0-execution-binding-20261022/AI-ShortDrama-Director-P0-Execution-Binding-0.9.0-alpha.2-x64.exe`。

安装包 SHA-256：`901bcf91b8294dd3ce1d17941e8a214dc4061bcf2ca0059cbefcdd792db64715`。

本轮结论仅为执行绑定、授权隔离及本地恢复技术验收通过，不代表新供应商权限、真实收费边界、画面质量或全链路生产质量通过。
