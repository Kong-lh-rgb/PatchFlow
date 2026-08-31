import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_LIMITS,
  CreateRunInputSchema,
  isTerminalRunStatus,
  RUN_PHASES,
  RUN_STATUSES,
  RunLimitsSchema,
  RunPhaseSchema,
  RunStatusSchema,
  TERMINAL_RUN_STATUSES,
} from './run.js';

describe('RunStatusSchema', () => {
  it('接受全部合法状态', () => {
    for (const status of RUN_STATUSES) {
      expect(RunStatusSchema.parse(status)).toBe(status);
    }
  });

  it('覆盖状态机要求的全部 11 个状态', () => {
    expect(RUN_STATUSES).toEqual([
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
    ]);
  });

  it.each([
    ['未知状态', 'done'],
    ['大小写敏感', 'Queued'],
    ['空字符串', ''],
    ['数字', 42],
  ])('拒绝非法状态（%s）', (_label, value) => {
    expect(RunStatusSchema.safeParse(value).success).toBe(false);
  });

  it('isTerminalRunStatus 只对终态返回 true', () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(isTerminalRunStatus(status)).toBe(true);
    }
    for (const status of RUN_STATUSES) {
      if (!(TERMINAL_RUN_STATUSES as readonly string[]).includes(status)) {
        expect(isTerminalRunStatus(status)).toBe(false);
      }
    }
  });
});

describe('RunPhaseSchema', () => {
  it('接受全部执行阶段', () => {
    for (const phase of RUN_PHASES) {
      expect(RunPhaseSchema.parse(phase)).toBe(phase);
    }
  });

  it('拒绝 queued 与终态（phase 只描述执行期）', () => {
    expect(RunPhaseSchema.safeParse('queued').success).toBe(false);
    expect(RunPhaseSchema.safeParse('completed').success).toBe(false);
    expect(RunPhaseSchema.safeParse('cancelled').success).toBe(false);
  });
});

describe('RunLimitsSchema', () => {
  it('空对象填充默认预算', () => {
    expect(RunLimitsSchema.parse({})).toEqual(DEFAULT_RUN_LIMITS);
  });

  it.each([
    ['maxIterations 为 0', { maxIterations: 0 }],
    ['maxToolCalls 为负数', { maxToolCalls: -1 }],
    ['timeoutSeconds 非整数', { timeoutSeconds: 1.5 }],
    ['maxIterations 超过上限', { maxIterations: 1000 }],
  ])('拒绝非法预算（%s）', (_label, value) => {
    expect(RunLimitsSchema.safeParse({ ...DEFAULT_RUN_LIMITS, ...value }).success).toBe(false);
  });
});

describe('CreateRunInputSchema', () => {
  it('最小输入解析并填充默认值', () => {
    const parsed = CreateRunInputSchema.parse({ taskId: 'task_123' });
    expect(parsed.taskId).toBe('task_123');
    expect(parsed.baseRef).toBe('main');
    expect(parsed.limits).toEqual(DEFAULT_RUN_LIMITS);
  });

  it('完整输入解析成功', () => {
    const parsed = CreateRunInputSchema.parse({
      taskId: 'task_123',
      baseRef: 'release/1.0',
      model: 'anthropic/claude-opus-5',
      limits: { maxIterations: 3, maxToolCalls: 20, timeoutSeconds: 600 },
    });
    expect(parsed.limits.maxIterations).toBe(3);
    expect(parsed.model).toBe('anthropic/claude-opus-5');
  });

  it.each([
    ['缺少 taskId', {}],
    ['taskId 为空字符串', { taskId: '' }],
    ['model 为空字符串', { taskId: 't', model: '' }],
    ['baseRef 为空字符串', { taskId: 't', baseRef: '' }],
  ])('拒绝非法输入（%s）', (_label, value) => {
    expect(CreateRunInputSchema.safeParse(value).success).toBe(false);
  });
});
