import { describe, expect, it } from 'vitest';
import { RUN_EVENT_TYPES, RunEventSchema } from './event.js';

const validEvent = {
  id: '0192ab3c-def1-7000-8000-000000000001',
  runId: '0192ab3c-def1-7000-8000-000000000002',
  sequence: 1,
  type: 'run.status_changed',
  payload: { from: 'queued', to: 'preparing' },
  createdAt: '2026-08-31T12:00:00.000Z',
};

describe('RunEventSchema', () => {
  it('接受合法事件', () => {
    expect(RunEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it('payload 缺省时填充空对象', () => {
    const { payload: _payload, ...withoutPayload } = validEvent;
    const parsed = RunEventSchema.parse(withoutPayload);
    expect(parsed.payload).toEqual({});
  });

  it.each([
    ['未知事件类型', { type: 'run.exploded' }],
    ['sequence 为 0', { sequence: 0 }],
    ['sequence 非整数', { sequence: 1.5 }],
    ['id 不是 UUID', { id: 'not-a-uuid' }],
    ['runId 不是 UUID', { runId: 'run-1' }],
    ['createdAt 不是 ISO 时间', { createdAt: 'yesterday' }],
    ['payload 不是对象', { payload: 'nope' }],
  ])('拒绝非法事件（%s）', (_label, override) => {
    expect(RunEventSchema.safeParse({ ...validEvent, ...override }).success).toBe(false);
  });

  it('事件类型覆盖 SSE 草案要求的全部类型', () => {
    expect(RUN_EVENT_TYPES).toHaveLength(10);
    expect(RUN_EVENT_TYPES).toContain('run.status_changed');
    expect(RUN_EVENT_TYPES).toContain('approval.requested');
    expect(RUN_EVENT_TYPES).toContain('run.failed');
  });
});
