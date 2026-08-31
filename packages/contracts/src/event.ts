import { z } from 'zod';

/**
 * Run 事件类型全集（见项目说明 11 SSE 事件草案）。
 * `run_events` 表按 (runId, sequence) 唯一递增存储，供 SSE 断线续传与审计。
 */
export const RUN_EVENT_TYPES = [
  'run.status_changed',
  'step.started',
  'step.completed',
  'tool.started',
  'tool.completed',
  'verification.completed',
  'approval.requested',
  'artifact.created',
  'run.completed',
  'run.failed',
] as const;

export const RunEventTypeSchema = z.enum(RUN_EVENT_TYPES);
export type RunEventType = z.output<typeof RunEventTypeSchema>;

/** 单条 Run 事件的线上契约。createdAt 为 ISO 8601 字符串（UTC）。 */
export const RunEventSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  sequence: z.number().int().positive(),
  type: RunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.iso.datetime(),
});
export type RunEvent = z.output<typeof RunEventSchema>;
