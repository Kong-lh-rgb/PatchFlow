/**
 * @patchflow/agent-core
 *
 * Agent 执行核心。职责（Foundation 阶段仅契约，实现后续阶段补齐）：
 * - 维护 Run 状态机的合法转换（转换必须经统一函数 + 数据库事务）。
 * - 按阶段构建模型上下文（只带当前阶段需要的信息）。
 * - 管理预算与停止条件（模型调用数、工具调用数、Token、墙钟时间）。
 * - 驱动"模型请求 → 工具执行 → 检查点"循环。
 *
 * 注意：本项目刻意不使用 LangChain/LangGraph，理由见 docs/architecture.md。
 */
import type { RunPhase } from '@patchflow/contracts';

/** 暴露给模型的受控工具名（与 @patchflow/tools 保持一致）。 */
export type AgentToolName =
  | 'list_files'
  | 'search_code'
  | 'read_file'
  | 'apply_patch'
  | 'run_tests'
  | 'run_typecheck'
  | 'git_diff';

/**
 * 阶段工具策略：每个阶段允许的工具集合（见项目说明 8.1）。
 * planning/delivery 阶段不执行工具，只输出结构化内容。
 */
export interface PhaseToolPolicy {
  readonly phase: RunPhase;
  readonly allowedTools: readonly AgentToolName[];
  /** 该阶段是否允许执行任何工具。 */
  readonly canUseTools: boolean;
}

export const PHASE_TOOL_POLICIES: Record<RunPhase, PhaseToolPolicy> = {
  preparing: {
    phase: 'preparing',
    allowedTools: ['list_files'],
    canUseTools: true,
  },
  analyzing: {
    phase: 'analyzing',
    allowedTools: ['list_files', 'search_code', 'read_file'],
    canUseTools: true,
  },
  reproducing: {
    phase: 'reproducing',
    allowedTools: ['run_tests', 'read_file'],
    canUseTools: true,
  },
  planning: {
    phase: 'planning',
    allowedTools: [],
    canUseTools: false,
  },
  editing: {
    phase: 'editing',
    allowedTools: ['apply_patch', 'read_file', 'list_files'],
    canUseTools: true,
  },
  verifying: {
    phase: 'verifying',
    allowedTools: ['run_tests', 'run_typecheck', 'read_file', 'git_diff'],
    canUseTools: true,
  },
  awaiting_approval: {
    phase: 'awaiting_approval',
    allowedTools: [],
    canUseTools: false,
  },
};

/** 状态转换表：key 为当前状态，value 为允许进入的状态集合。 */
export const RUN_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  queued: ['preparing', 'cancelled', 'failed'],
  preparing: ['analyzing', 'failed', 'cancelled'],
  analyzing: ['reproducing', 'failed', 'cancelled'],
  reproducing: ['planning', 'failed', 'cancelled'],
  planning: ['editing', 'failed', 'cancelled'],
  editing: ['verifying', 'failed', 'cancelled'],
  verifying: ['editing', 'awaiting_approval', 'completed', 'failed', 'cancelled'],
  awaiting_approval: ['verifying', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

/** 校验状态转换是否合法；实际落库必须配合事务与版本号使用。 */
export function canTransition(from: string, to: string): boolean {
  const allowed = RUN_STATUS_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}
