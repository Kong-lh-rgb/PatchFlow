/**
 * @patchflow/evals
 *
 * 评测系统。职责：维护固定 Case 数据集（修复前 Commit、Issue、隐藏测试）、
 * 批量运行并计算指标、输出可复现的评测报告。
 * Foundation 阶段只定义指标口径与 Case 契约，数据集与 Runner 后续建立。
 */
import type { RunLimits } from '@patchflow/contracts';

/** 评测指标全集（见项目说明 14.2）。 */
export const EVAL_METRIC_NAMES = [
  'issue_resolution_rate',
  'regression_safe_rate',
  'stable_pass_rate',
  'patch_apply_rate',
  'unsafe_action_rate',
  'recovery_success_rate',
  'efficiency',
] as const;
export type EvalMetricName = (typeof EVAL_METRIC_NAMES)[number];

/** 同一 Case 重复运行的固定次数（Stable Pass Rate 口径）。 */
export const STABLE_PASS_REPEATS = 3;

/** 一个固定评测样本：Agent 只能看到 issue 与可见命令，不能看到隐藏检查。 */
export interface EvalCase {
  readonly id: string;
  /** 修复前的仓库引用（Commit 固定，保证可复现）。 */
  readonly repoRef: string;
  readonly issue: string;
  /** Agent 可见的测试命令。 */
  readonly visibleTestCommands: readonly string[];
  /** 评测器独占的隐藏验收测试，严禁进入 Agent 上下文。 */
  readonly hiddenChecks: readonly string[];
  readonly allowedPaths: readonly string[];
  readonly budget: RunLimits;
}

/** 单次评测尝试的结果记录。 */
export interface EvalAttempt {
  readonly caseId: string;
  readonly runId: string;
  readonly seed: number;
  readonly resolved: boolean;
  readonly regressionSafe: boolean;
  readonly durationMs: number;
}

/** 计算稳定通过率：连续 N 次全部通过才计入分子。 */
export function computeStablePassRate(attempts: readonly EvalAttempt[]): number {
  if (attempts.length === 0) return 0;
  const byCase = new Map<string, EvalAttempt[]>();
  for (const attempt of attempts) {
    const list = byCase.get(attempt.caseId) ?? [];
    list.push(attempt);
    byCase.set(attempt.caseId, list);
  }
  let total = 0;
  let stable = 0;
  for (const list of byCase.values()) {
    if (list.length < STABLE_PASS_REPEATS) continue;
    total += 1;
    if (list.every((attempt) => attempt.resolved)) stable += 1;
  }
  return total === 0 ? 0 : stable / total;
}
