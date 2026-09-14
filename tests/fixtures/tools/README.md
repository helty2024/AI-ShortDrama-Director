# 07-02 模拟工具行为验证

施工依据仅为 [Baseline v2](../../../docs/platform-architecture.md) 与 [Roadmap v2](../../../docs/implementation-roadmap-v2.md)。本目录是测试 fixture，不被应用导入，不登记到现有 Provider。

## 运行与设计

`npx tsx --test tests/unit/tool-behavior.test.ts` 单独运行；`npm run test:unit` 包含本组测试。无需 API Key、HTTP 服务、媒体文件、数据库或真实收费请求。

- `sync-image.ts` 实现两个图片能力。submit 直接 completed；没有远端任务，status/result 拒绝任务查询，cancel/recover 为 unsupported。支持最多 3 张参考图和三种声明分辨率。
- `async-video.ts` 实现两个视频能力。submit accepted 后保存模拟远端任务；测试通过 advance 注入远端事件，查询不会自行推进状态。支持 queued、running、succeeded、failed、unknown、cancelled；未完成时 result 返回 not-ready。
- `support.ts` 提供纯预检、模拟报价、计数器、Abort 等待、错误注入与测试用宿主输出签发器。billingCount/uploadCount 仅代表模拟行为次数，没有账单或真实上传。报价 unknown 保留 unknown，不能当作 0 或免费。healthTimeout 是确定性超时故障注入，不验证真实网络栈的超时实现。
- `harness.ts` 仅演示一次请求的提交锁和归属检查。并发或再次等待同一次含糊提交复用原 receipt，submitCount 保持 1；没有自动重试、工具选择或 fallback。锁不持久化，不保证重启后的幂等性，也不是生产调度器。

## 关键边界

07-01 契约未修改。output handle 按原约定由宿主/Broker 签发；这里的 OutputIssuer 是宿主行为的测试替身，签发并保存 projectId、taskId（requestId）、requestFingerprint 归属。公开输出先通过对应 Capability schema，再检查签发归属、MIME、数量、尺寸和视频时长。路径、URL、供应商地址、未签发但格式合法的 handle 都被拒绝。图片结果中出现 duration 也属于非法字段。

ToolTaskHandle 是工具/版本/外部任务身份，不能单凭 schema 证明项目权限。Adapter 检查工具身份、任务存在与 capability；测试 harness 在 status/result/cancel/recover 前检查请求拥有的 handle 和调用上下文。A 请求不能使用 B 的合法 handle 或读取 B 的输出。07-03 的生产调用边界必须实现等价的授权与签发控制，不能把本测试通过解释为应用已有此能力。

describe 仅静态能力声明，availability 为 unknown。health 动态区分可用/不可用及原因。现有 schema 没有 degraded 枚举，用 available + resource-insufficient issue 表达容量降低；validate 同时返回 warning。缺依赖或模型是阻塞状态。

真正取消返回 cancelled；只停止等待返回 waiting-stopped + computationMayContinue；不支持返回 unsupported。停止等待后远端仍可成功，因此 recover/status 可以报告远端 succeeded，但 result 仍拒绝自动接纳迟到输出。Abort 只结束该次等待，不隐式调用 cancel。recover 只查询已知身份，未知任务返回 unknown，不重新 submit。

## 07-03 前的明确事项

没有发现必须改变九动作签名或新增 schema 的阻塞。后续仍需生产实现请求归属校验、受控输出签发、预检与路由；describe 的静态可用性不得取代 health，未知费用不得当免费。提交不明的重启恢复、持久化意图和付费授权留给 Roadmap 后续步骤。本轮不验证真实网络、下载安全、真实模型产物或 GPU 行为。
