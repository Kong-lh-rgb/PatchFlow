import { describe, expect, it } from 'vitest';
import { RUN_PHASES, RUN_STATUSES } from '@patchflow/contracts';
import { PHASE_TOOL_POLICIES, RUN_STATUS_TRANSITIONS, canTransition } from './index.js';

describe('PHASE_TOOL_POLICIES', () => {
  it('覆盖全部执行阶段', () => {
    expect(Object.keys(PHASE_TOOL_POLICIES).sort()).toEqual([...RUN_PHASES].sort());
  });

  it('analyzing 阶段只允许读取类工具', () => {
    expect(PHASE_TOOL_POLICIES.analyzing.allowedTools).toEqual([
      'list_files',
      'search_code',
      'read_file',
    ]);
  });

  it('planning 与 awaiting_approval 阶段不允许执行工具', () => {
    expect(PHASE_TOOL_POLICIES.planning.canUseTools).toBe(false);
    expect(PHASE_TOOL_POLICIES.awaiting_approval.canUseTools).toBe(false);
  });

  it('任何阶段都不暴露任意 Shell 执行工具', () => {
    for (const policy of Object.values(PHASE_TOOL_POLICIES)) {
      expect(policy.allowedTools).not.toContain('exec');
      expect(policy.allowedTools).not.toContain('shell');
    }
  });
});

describe('RUN_STATUS_TRANSITIONS', () => {
  it('覆盖全部状态', () => {
    expect(Object.keys(RUN_STATUS_TRANSITIONS).sort()).toEqual([...RUN_STATUSES].sort());
  });

  it('终态不再发生转换', () => {
    expect(RUN_STATUS_TRANSITIONS['completed']).toEqual([]);
    expect(RUN_STATUS_TRANSITIONS['failed']).toEqual([]);
    expect(RUN_STATUS_TRANSITIONS['cancelled']).toEqual([]);
  });

  it('verifying 可回到 editing（修复循环）或进入审批', () => {
    expect(canTransition('verifying', 'editing')).toBe(true);
    expect(canTransition('verifying', 'awaiting_approval')).toBe(true);
    expect(canTransition('verifying', 'completed')).toBe(true);
  });

  it('禁止跳过阶段（queued 不能直接 editing）', () => {
    expect(canTransition('queued', 'editing')).toBe(false);
    expect(canTransition('analyzing', 'completed')).toBe(false);
    expect(canTransition('completed', 'queued')).toBe(false);
  });
});
