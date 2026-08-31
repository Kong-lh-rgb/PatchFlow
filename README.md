# PatchFlow

> 面向 GitHub Issue 和代码缺陷的可验证 AI Coding Agent：在隔离环境中理解仓库、复现问题、生成补丁、运行测试，并交付带证据的修改结果。

## 当前阶段：Foundation

本仓库刚完成**工程环境与基础骨架**。已实现：

- pnpm Monorepo（TypeScript strict、ESLint、Prettier、Vitest、GitHub Actions CI）。
- `@patchflow/contracts`：Run 状态机 / 阶段 / 事件 / 输入的 Zod 契约与环境变量校验。
- `@patchflow/db`：Drizzle Schema（`runs`、`run_events`）+ 第一份 migration + 惰性客户端。
- `@patchflow/observability`：统一 Pino Logger 工厂（级别可控、开发可读 / 生产 JSON、凭据脱敏）。
- `apps/api`：Fastify 5，`GET /health`（进程存活）、`GET /ready`（探测 PostgreSQL + Redis，失败返回 503 结构化错误）、`GET /api/version`。
- `apps/worker`：BullMQ `run.execute` 任务 Schema、队列封装、校验型消费者（仅结构化日志，不执行 Agent）、SIGTERM/SIGINT 优雅关闭。
- `apps/web`：Next.js 16 + React 19 的 Foundation 状态页（API 实时探测 + PostgreSQL/Redis/Worker 占位卡；API 不可用时显示错误横幅而非白屏）。
- Docker Compose：本地 PostgreSQL 18 + Redis 8（命名 Volume、healthcheck、端口账号可覆盖）。

**尚未实现**（不要指望它们现在能用）：Agent 执行状态机、模型调用、Git Worktree / Docker 沙箱、工具执行、SSE 实时进度、审批、恢复、评测系统。

## 技术栈

| 层次     | 选择                                                    |
| -------- | ------------------------------------------------------- |
| Runtime  | Node.js 24 LTS（本地开发机使用 25 亦满足 engines 约束） |
| 语言     | TypeScript 5.9（`strict: true`）                        |
| 包管理   | pnpm 11 workspace（catalog 统一版本）                   |
| Web      | Next.js 16 + React 19                                   |
| API      | Fastify 5                                               |
| 后台任务 | BullMQ 6 + Redis 8                                      |
| 持久化   | PostgreSQL 18 + Drizzle ORM                             |
| 校验     | Zod 4                                                   |
| 日志     | Pino（+ pino-pretty 开发输出）                          |
| 测试     | Vitest                                                  |
| 质量     | ESLint 10 + Prettier 3                                  |
| 本地依赖 | Docker Compose                                          |
| CI       | GitHub Actions                                          |

## 前置环境要求

- Node.js ≥ 24（推荐 24 LTS）
- pnpm ≥ 10（`npm install -g pnpm`，或使用 [corepack](https://nodejs.org/api/corepack.html)）
- Docker + Docker Compose（仅本地 PostgreSQL/Redis 需要）

## 从克隆到运行

```bash
git clone <repo-url> patchflow
cd patchflow

# 1. 安装依赖（生成/使用 pnpm-lock.yaml）
pnpm install

# 2. 准备环境变量
cp .env.example .env        # 本地默认值即可直接使用

# 3. 启动 PostgreSQL + Redis（等待两个容器 healthy）
docker compose up -d
docker compose ps           # STATUS 应为 Up (healthy)

# 4. 建表（应用第一份 migration）
pnpm db:migrate

# 5. 启动 API（端口 3001）
pnpm --filter @patchflow/api dev

# 6. 启动 Worker（另一个终端）
pnpm --filter @patchflow/worker dev

# 7. 启动 Web（另一个终端，端口 3000）
pnpm --filter @patchflow/web dev
```

验证：

```bash
curl http://localhost:3001/health   # {"status":"ok",...}
curl http://localhost:3001/ready    # 依赖正常 → {"status":"ready",...}
curl http://localhost:3001/api/version
open http://localhost:3000          # Foundation 状态页
```

Worker 队列冒烟（投递一个 run.execute 任务并观察消费与优雅退出）：

```bash
pnpm --filter @patchflow/worker smoke
```

## 环境变量

复制 `.env.example` 为 `.env`（已被 git 忽略，严禁提交真实密钥）：

| 变量                       | 说明                                  | 默认                                                        |
| -------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `NODE_ENV`                 | `development` / `test` / `production` | `development`                                               |
| `LOG_LEVEL`                | `trace`…`fatal`，控制 Pino 级别       | `info`                                                      |
| `API_PORT`                 | Fastify 监听端口                      | `3001`                                                      |
| `NEXT_PUBLIC_API_BASE_URL` | Web 服务端请求 API 的基础地址         | `http://localhost:3001`                                     |
| `DATABASE_URL`             | PostgreSQL 连接串                     | `postgresql://patchflow:patchflow@localhost:5433/patchflow` |
| `REDIS_URL`                | Redis 连接串                          | `redis://localhost:6380`                                    |

Compose 专用覆盖变量（非应用运行时变量）：`POSTGRES_PORT`（默认 `5433`）、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`REDIS_PORT`（默认 `6380`）。

> **端口说明**：Compose 默认映射宿主 `5433/6380`（而非 `5432/6379`），避免与开发机已有的本地 PostgreSQL/Redis 冲突。本机端口空闲时可改回标准端口。

所有服务在启动时用 Zod 校验必要变量，缺失或非法时立即失败并输出可读错误。

## 常用命令

```bash
pnpm dev           # 递归启动各包 dev 脚本（建议按服务单独启动，见上）
pnpm build         # 构建全部（web: next build；api/worker: tsup bundle）
pnpm typecheck     # 全部包 tsc --noEmit
pnpm lint          # ESLint（含类型感知规则）
pnpm format        # Prettier 写入
pnpm format:check  # Prettier 校验
pnpm test          # 全部包 Vitest
pnpm db:generate   # 由 Drizzle Schema 生成 migration
pnpm db:migrate    # 对 DATABASE_URL 应用 migration
docker compose up -d      # 启动 PostgreSQL + Redis
docker compose down       # 停止（数据保留在命名卷）
docker compose down -v    # 停止并删除数据卷（危险）
```

## Monorepo 目录说明

```text
patchflow/
├── apps/
│   ├── web/                 # Next.js 16 前端（Foundation 状态页）
│   ├── api/                 # Fastify 5 控制面 API（health/ready/version）
│   └── worker/              # BullMQ 消费者（校验 + 结构化日志骨架）
├── packages/
│   ├── contracts/           # Zod 契约：Run 状态、事件、输入、环境变量
│   ├── db/                  # Drizzle Schema、migration、客户端工厂
│   ├── agent-core/          # 状态机转换表与阶段工具策略（契约，未实现执行）
│   ├── model-providers/     # 模型 Provider 统一接口（契约，未接入 SDK）
│   ├── tools/               # 受控工具接口与输出上限（契约，未实现执行）
│   ├── sandbox/             # 沙箱限制与命令 Allowlist（契约，未实现容器）
│   ├── observability/       # Pino Logger 工厂 + 脱敏规则
│   └── evals/               # 评测指标口径与 Case 契约（未建数据集）
├── docs/
│   ├── architecture.md      # 架构说明
│   └── progress/            # 每日开发进度（强制记录）
├── .github/workflows/ci.yml # CI：format/lint/typecheck/test/build
├── docker-compose.yml       # 本地 PostgreSQL + Redis
└── 项目说明.md               # 产品需求与总体设计
```

各包均为"内部源码包"（exports 指向 `src/index.ts`，由 tsx / Next / tsup 直接消费），版本集中在 `pnpm-workspace.yaml` 的 catalog 中。

## 当前非目标

以下能力是设计目标但**尚未实现**，README 不宣称其已完成：

- Agent 执行（分析/复现/计划/编辑/验证的完整状态机驱动）。
- 模型调用（Anthropic/OpenAI Provider 只定义了接口）。
- Git Worktree、Docker 命令沙箱、命令 Allowlist 执行。
- SSE 实时进度、审批流、断点恢复、Run 租约与幂等重试。
- 评测数据集与指标报告。

明确不引入（见架构文档理由）：LangChain/LangGraph、Turborepo、Prisma、GraphQL、WebSocket、向量数据库、多 Agent 编排。

## 下一阶段计划

按项目说明的路线图，下一阶段最有价值的增量是：

1. **最小 CLI 闭环**：导入一个本地 Git 仓库 → 创建 Worktree → 执行 `read_file`/`search_code`/`apply_patch` 三个受控工具 → 产出可查看的 Diff（不接模型，先用脚本驱动，验证工具与隔离边界）。
2. 随后接入 model-providers 与 agent-core 状态机，形成"分析 → 编辑 → 验证"循环。

进度与决策记录见 [docs/progress/](docs/progress/)。
