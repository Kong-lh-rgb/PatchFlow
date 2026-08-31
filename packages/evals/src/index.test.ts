import { describe, expect, it } from 'vitest';
import { EVAL_METRIC_NAMES, STABLE_PASS_REPEATS, computeStablePassRate } from './index.js';
import type { EvalAttempt } from './index.js';

function attempt(caseId: string, resolved: boolean): EvalAttempt {
  return {
    caseId,
    runId: `run-${caseId}-${resolved ? 1 : 0}`,
    seed: 1,
    resolved,
    regressionSafe: resolved,
    durationMs: 1000,
  };
}

describe('EVAL_METRIC_NAMES', () => {
  it('覆盖 14.2 节要求的全部指标', () => {
    expect(EVAL_METRIC_NAMES).toHaveLength(7);
    expect(EVAL_METRIC_NAMES).toContain('issue_resolution_rate');
    expect(EVAL_METRIC_NAMES).toContain('regression_safe_rate');
    expect(EVAL_METRIC_NAMES).toContain('stable_pass_rate');
  });
});

describe('computeStablePassRate', () => {
  it('全部通过时为 1', () => {
    const attempts = [attempt('case-1', true), attempt('case-1', true), attempt('case-1', true)];
    expect(computeStablePassRate(attempts)).toBe(1);
  });

  it('任一次失败则该 Case 不计入稳定通过', () => {
    const attempts = [attempt('case-1', true), attempt('case-1', false), attempt('case-1', true)];
    expect(computeStablePassRate(attempts)).toBe(0);
  });

  it('不足 3 次的 Case 不参与统计', () => {
    const attempts = [attempt('case-1', true), attempt('case-1', true)];
    expect(computeStablePassRate(attempts)).toBe(0);
  });

  it('空列表返回 0', () => {
    expect(computeStablePassRate([])).toBe(0);
    expect(STABLE_PASS_REPEATS).toBe(3);
  });
});
