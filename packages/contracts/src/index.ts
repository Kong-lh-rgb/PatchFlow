/**
 * @patchflow/contracts
 *
 * PatchFlow 的共享契约层：所有跨服务边界的数据形状都以此处的 Zod Schema
 * 为唯一来源，覆盖 API 输入、队列消息、数据库状态与 SSE 事件。
 * 状态机与事件类型定义必须与 docs/architecture.md 同步演进。
 */
export {
  RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  RUN_PHASES,
  RunStatusSchema,
  TerminalRunStatusSchema,
  RunPhaseSchema,
  RunLimitsSchema,
  CreateRunInputSchema,
  DEFAULT_RUN_LIMITS,
  isTerminalRunStatus,
} from './run.js';
export type {
  RunStatus,
  TerminalRunStatus,
  RunPhase,
  RunLimits,
  CreateRunInput,
  ParsedCreateRunInput,
} from './run.js';

export { RUN_EVENT_TYPES, RunEventTypeSchema, RunEventSchema } from './event.js';
export type { RunEventType, RunEvent } from './event.js';

export { NodeEnvSchema, LogLevelSchema, BaseEnvSchema, formatZodError, parseEnv } from './env.js';
export type { NodeEnv, LogLevel, BaseEnv } from './env.js';
