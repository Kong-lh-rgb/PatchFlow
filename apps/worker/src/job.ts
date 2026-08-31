import { z } from 'zod';

/** Run 任务队列名。 */
export const RUN_QUEUE_NAME = 'runs';

/** 队列中的任务名：Foundation 阶段只有一种任务。 */
export const RUN_EXECUTE_JOB_NAME = 'run.execute';

/**
 * `run.execute` 任务的消息契约。
 * runId 指向 PostgreSQL runs 表的唯一键；Worker 必须以 Run 状态为准确认是否重复执行。
 */
export const RunExecuteJobSchema = z.object({
  runId: z.uuid(),
  /** 入队时间（ISO 8601），便于排查延迟投递。 */
  enqueuedAt: z.iso.datetime().optional(),
});
export type RunExecuteJob = z.output<typeof RunExecuteJobSchema>;
