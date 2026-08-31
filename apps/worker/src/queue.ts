import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { RUN_EXECUTE_JOB_NAME, RUN_QUEUE_NAME, type RunExecuteJob } from './job.js';

/**
 * 创建 run 队列封装。
 * 只负责投递：PostgreSQL 才是 Run 真实状态的唯一事实来源，
 * 队列消息丢失时系统应能从 runs 表重新入队。
 */
export interface RunQueue {
  /** 投递一个 run.execute 任务，返回 BullMQ Job。 */
  enqueueRunExecute(job: RunExecuteJob): Promise<{ id: string | undefined }>;
  close(): Promise<void>;
}

export function createRunQueue(connection: Redis): RunQueue {
  const queue = new Queue(RUN_QUEUE_NAME, { connection });
  return {
    async enqueueRunExecute(job) {
      const bullmqJob = await queue.add(RUN_EXECUTE_JOB_NAME, job, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      return { id: bullmqJob.id };
    },
    async close() {
      await queue.close();
    },
  };
}
