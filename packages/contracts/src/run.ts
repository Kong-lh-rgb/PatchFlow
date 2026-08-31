import { z } from 'zod';

/**
 * Run 生命周期状态全集。
 *
 * `status` 是 Run 的唯一权威状态，覆盖排队、执行、审批与终态，
 * 与 docs/architecture.md 中的状态机保持一致；转换必须由统一函数校验。
 */
export const RUN_STATUSES = [
  'queued',
  'preparing',
  'analyzing',
  'reproducing',
  'planning',
  'editing',
  'verifying',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;

export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.output<typeof RunStatusSchema>;

/** 终态：到达后不再发生状态转换。 */
export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export const TerminalRunStatusSchema = z.enum(TERMINAL_RUN_STATUSES);
export type TerminalRunStatus = z.output<typeof TerminalRunStatusSchema>;

/**
 * 执行阶段：处于执行期（非 queued、非终态）时的细分阶段。
 *
 * `phase` 与 `status` 分开存储：status 回答“Run 处于生命周期哪一层”，
 * phase 回答“Agent 正在做什么”。phase 只在 Run 激活期间有值。
 */
export const RUN_PHASES = [
  'preparing',
  'analyzing',
  'reproducing',
  'planning',
  'editing',
  'verifying',
  'awaiting_approval',
] as const;

export const RunPhaseSchema = z.enum(RUN_PHASES);
export type RunPhase = z.output<typeof RunPhaseSchema>;

export function isTerminalRunStatus(status: string): status is TerminalRunStatus {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** 单次 Run 的预算与停止条件（见项目说明 8.5）。 */
export const RunLimitsSchema = z.object({
  maxIterations: z.number().int().positive().max(100).default(6),
  maxToolCalls: z.number().int().positive().max(1_000).default(40),
  timeoutSeconds: z.number().int().positive().max(86_400).default(1_200),
});
export type RunLimits = z.output<typeof RunLimitsSchema>;

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxIterations: 6,
  maxToolCalls: 40,
  timeoutSeconds: 1_200,
};

/**
 * 创建 Run 的输入契约（对应未来的 POST /api/runs）。
 * Foundation 阶段仅约束字段形状，实际创建接口在后续阶段接入。
 */
export const CreateRunInputSchema = z.object({
  taskId: z.string().min(1),
  baseRef: z.string().min(1).default('main'),
  model: z.string().min(1).optional(),
  limits: RunLimitsSchema.default(DEFAULT_RUN_LIMITS),
});
export type CreateRunInput = z.input<typeof CreateRunInputSchema>;
export type ParsedCreateRunInput = z.output<typeof CreateRunInputSchema>;
