# PatchFlow 架构说明

> 当前阶段：Foundation（工程骨架）。本文描述已落地的结构，以及已确定但尚未实现的决策。

## 1. 组件关系

```text
Browser（Next.js 16，apps/web）
  │  HTTP（REST；实时进度后续走 SSE）
  ▼
Fastify API（apps/api，端口 3001）
  │  health / ready / version
  │  （后续：创建 Run、查询状态、审批）
  ▼
BullMQ（Redis，宿主 6380） ──投递──▶ Worker（apps/worker）
  │                                    │ 校验 run.execute 消息
  │                                    │ （后续：驱动 agent-core 状态机）
  ▼                                    ▼
PostgreSQL（宿主 5433）◀──── 业务事实来源（runs / run_events）
```

职责划分：

| 组件           | 职责                                          | 不负责               |
| -------------- | --------------------------------------------- | -------------------- |
| Web            | 展示状态、后续展示轨迹/Diff/审批操作          | 直接访问数据库或队列 |
| API            | 参数校验、健康探测、后续的任务创建与状态查询  | 执行长任务           |
| Worker         | 消费队列、后续持有执行租约并驱动 Agent        | 决定任务的最终状态   |
| PostgreSQL     | Run 状态、事件、后续的 Step/ToolCall/Artifact | 任务投递             |
| Redis + BullMQ | 任务投递、重试、并发控制                      | 业务事实             |

## 2. PostgreSQL 是唯一事实来源，BullMQ 只负责投递

这是本项目最重要的数据一致性决策：

- **队列消息不是状态**。`run.execute` 消息只携带 `runId`；Worker 处理任务前必须以 `runs` 表的当前状态为准（Foundation 阶段尚未实现该检查，但契约已如此设计）。
- BullMQ 提供至少一次投递，因此 Worker 必须通过 Run 状态 + 幂等键避免重复执行副作用。
- 即使 Redis 丢失待处理任务（或运维清空队列），系统也能从 PostgreSQL 中找到 `queued`/未终态的 Run 并重新入队——恢复路径不依赖 Redis 的持久性（AOF 只是降低概率，不是正确性来源）。
- `runs.version` 为乐观并发控制预留；`run_events` 以 `(run_id, sequence)` 唯一约束支撑 SSE 断线续传（`Last-Event-ID`）。

## 3. 为什么实时进度用 SSE 而不是 WebSocket

运行过程中数据流基本是**单向**的：服务端持续推送状态、日志、测试结果；用户操作（创建、取消、审批）是低频请求。

- SSE 原生支持断线重连与 `Last-Event-ID`，与我们"事件按 sequence 单调递增、存在 PostgreSQL"的设计天然对接：重连后从上次 sequence 继续回放即可。
- WebSocket 的双向能力在这里用不上，却带来连接管理、心跳、网关兼容与自定义重连协议等额外成本。
- 取消、审批等命令继续走普通 REST，语义清晰且容易鉴权。

## 4. 为什么模型执行层不用 LangChain / LangGraph

PatchFlow 的核心价值在于**对执行边界、状态转换、恢复语义和工具权限的显式掌控**：

- 每个状态为什么产生必须一目了然：我们用 `RUN_STATUS_TRANSITIONS`（agent-core 包）显式声明 11 个状态的合法转换，禁止跳阶段；框架内置的图执行把这份逻辑藏进通用引擎，排障时更难回答"为什么会到这一步"。
- 模型输入和工具输出需要完整、结构化地记录（审计与评测都依赖），自己写循环可以直接控制记录粒度，不经过框架的中间抽象。
- 恢复、重试、审批语义必须由项目自己定义（租约、版本号、幂等键），这些恰恰是通用框架不提供或提供得过于隐式的部分。
- 面试与复盘时能讲清底层机制，而不是只会调框架接口。

这不是否定这些框架的价值，而是第一版不需要它们；如果未来出现明确需求（例如复杂的多阶段编排可视化），再评估引入。

## 5. Foundation 阶段已落地的关键设计

### 5.1 status 与 phase 分离

`runs.status` 是生命周期唯一权威状态（queued → preparing → … → completed/failed/cancelled，共 11 个值）；`runs.phase` 只在执行期有值（preparing/analyzing/reproducing/planning/editing/verifying/awaiting_approval）。两列共用 contracts 中同一组常量生成的 PostgreSQL 枚举，Zod 契约与数据库不会漂移。

### 5.2 健康检查语义

- `GET /health`：进程存活，不触碰任何依赖（给进程级探针）。
- `GET /ready`：并行探测 PostgreSQL（`SELECT 1`）与 Redis（`PING`），单项 2s 超时；任一失败返回 503 与 `error.checks[]` 结构化明细（给负载均衡/编排系统）。所有依赖客户端都是惰性连接（pg.Pool 惰性、ioredis lazyConnect），测试通过注入替身完成，不需要真实基础设施。

### 5.3 内部源码包

`packages/*` 以 TS 源码发布（exports 指向 `src/index.ts`）：开发由 tsx 直接运行、Web 由 Next 编译、生产构建由 tsup `noExternal` 打进 bundle。收益是零构建顺序依赖、改动即生效；代价是这些包不能直接发布到 npm（当前私有 monorepo 无此需求）。

### 5.4 日志与脱敏

统一 `createLogger()`：`LOG_LEVEL` 控制级别；非生产输出 pino-pretty 可读格式，生产输出 JSON；按字段名脱敏（password/apiKey/token/secret/authorization/connectionString 及嵌套形式）。脱敏是最后防线——约定完整模型输入与仓库内容不进入日志。

### 5.5 队列骨架

Worker 的处理函数是纯函数（`processRunExecuteJob(data, logger)`），非法数据抛 `InvalidJobDataError` 由 BullMQ 标记 failed；模块导入零副作用（连接与消费只在入口显式启动）；SIGTERM/SIGINT 先停消费再关连接。

### 5.6 Git Worktree 生命周期

`packages/sandbox` 已实现受管 Worktree 的创建、检查与删除：每个 Run 从固定 Commit 创建 detached Worktree，不自动创建分支；系统校验 Worktree 与原仓库共享同一个 Git common directory，并记录 HEAD 与脏状态。普通删除遇到未提交修改时拒绝，只有保存 Patch 后显式 `force` 才能清理。Git 命令全部通过 `spawn(program, args[])` 执行，不经过 Shell；Run ID 和受管根目录都经过约束，错误配置不能在用户仓库内创建工作目录。

## 6. 已确定、待实现的决策

- **状态转换必须在统一函数 + 数据库事务中完成**（转换表已在 agent-core，事务包装未实现）。
- **Worker 租约**：`lease_owner`/`lease_expires_at` + `version` 乐观锁，防止两 Worker 同时执行同一 Run。
- **Docker 沙箱**：Git Worktree 生命周期已实现；下一步把 Worktree 挂载进受限容器（默认断网、非 root、只读根 FS、命令 Allowlist、超时与资源上限）。默认限制已固化为 `DEFAULT_SANDBOX_LIMITS` 常量。
- **工具层**：`list_files`、`read_file`、`search_code` 已实现；`apply_patch`、`run_tests`、`run_typecheck`、`git_diff` 待实现。所有命令使用参数数组交给 spawn，无任意 Shell。
- **评测**：固定 Case + 隐藏验收测试 + 连续 3 次稳定通过口径（`computeStablePassRate` 已实现）。
