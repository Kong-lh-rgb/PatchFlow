import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createLogger } from '@patchflow/observability';
import { formatZodError } from '@patchflow/contracts';
import {
  RunExecuteJobSchema,
  RUN_EXECUTE_JOB_NAME,
  RUN_QUEUE_NAME,
  type RunExecuteJob,
} from './job.js';

/** 任务数据不满足 Schema 时抛出；BullMQ 会把该任务标记为 failed。 */
export class InvalidJobDataError extends Error {
  constructor(readonly issues: string) {
    super(`任务数据非法：${issues}`);
    this.name = 'InvalidJobDataError';
  }
}

export function parseRunExecuteJob(data: unknown): RunExecuteJob {
  const result = RunExecuteJobSchema.safeParse(data);
  if (!result.success) {
    throw new InvalidJobDataError(formatZodError(result.error));
  }
  return result.data;
}

export interface ProcessRunExecuteResult {
  runId: string;
  status: 'acknowledged';
}

/**
 * 处理 run.execute 任务。
 *
 * Foundation 阶段：只校验消息并输出结构化日志，不执行任何 Agent 逻辑。
 * 后续阶段在此接入 agent-core 状态机（读取 runs 表 → 驱动阶段 → 写事件）。
 */
// eslint-disable-next-line @typescript-eslint/require-await -- 保持 async：后续阶段将在函数体内 await 状态机与数据库调用
export async function processRunExecuteJob(
  data: unknown,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<ProcessRunExecuteResult> {
  const job = parseRunExecuteJob(data);
  logger.info(
    { runId: job.runId, jobName: RUN_EXECUTE_JOB_NAME },
    '收到 run.execute 任务（当前为 Foundation 阶段：仅校验与日志）',
  );
  return { runId: job.runId, status: 'acknowledged' };
}

export interface CreateRunWorkerOptions {
  connection: Redis;
  logger?: Logger;
  concurrency?: number;
}

/**
 * 创建 BullMQ Worker。
 * 消费循环由 BullMQ 在内部启动；本函数应在入口显式调用，不在模块导入期执行。
 */
export function createRunWorker(options: CreateRunWorkerOptions): Worker {
  const logger =
    options.logger ??
    createLogger({
      name: 'patchflow-worker',
      ...(process.env['LOG_LEVEL'] !== undefined ? { level: process.env['LOG_LEVEL'] } : {}),
      pretty: process.env['NODE_ENV'] !== 'production',
    });

  const worker = new Worker<RunExecuteJob, ProcessRunExecuteResult>(
    RUN_QUEUE_NAME,
    async (job: Job<RunExecuteJob>) => {
      if (job.name !== RUN_EXECUTE_JOB_NAME) {
        logger.warn({ jobId: job.id, jobName: job.name }, '收到未知任务名，拒绝处理');
        throw new InvalidJobDataError(`未知任务名 ${job.name}`);
      }
      return processRunExecuteJob(job.data, logger);
    },
    { connection: options.connection, concurrency: options.concurrency ?? 5 },
  );

  worker.on('failed', (job: Job<RunExecuteJob> | undefined, error: Error) => {
    logger.error({ jobId: job?.id, runId: job?.data?.runId, err: error.message }, '任务处理失败');
  });

  return worker;
}

/** 优雅关闭：先停消费，再关队列连接由调用方负责。 */
export async function shutdownRunWorker(worker: Worker): Promise<void> {
  await worker.close();
}
