/**
 * Worker 冒烟脚本：验证"连接队列 → 投递合法任务 → Worker 消费 → 优雅退出"。
 *
 * 用法（需要 Redis 已启动，默认读取 REDIS_URL 或 redis://localhost:6379）：
 *   cd apps/worker && pnpm smoke
 *   REDIS_URL=redis://localhost:6380 pnpm smoke   # 自定义地址
 */
import { createLogger } from '@patchflow/observability';
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { createQueueConnection } from '../src/connection.js';
import type { RunExecuteJob } from '../src/job.js';
import { createRunQueue } from '../src/queue.js';
import { createRunWorker, shutdownRunWorker } from '../src/worker.js';

async function main(): Promise<void> {
  const logger = createLogger({ name: 'patchflow-worker-smoke', level: 'info' });
  const connection = createQueueConnection(process.env['REDIS_URL']);
  await connection.connect();

  const runId = randomUUID();
  const queue = createRunQueue(connection);
  const worker = createRunWorker({ connection, logger, concurrency: 1 });

  const completed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待任务完成超时')), 15_000);
    worker.on('completed', (job: Job<RunExecuteJob>) => {
      if (job.data?.runId === runId) {
        clearTimeout(timer);
        resolve();
      }
    });
    worker.on('failed', (_job, error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  const { id } = await queue.enqueueRunExecute({
    runId,
    enqueuedAt: new Date().toISOString(),
  });
  logger.info({ jobId: id, runId }, '已投递冒烟任务');

  await completed;
  logger.info({ runId }, '冒烟任务已被消费，开始优雅关闭');

  await shutdownRunWorker(worker);
  await queue.close();
  connection.disconnect();
  logger.info('冒烟验证通过');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('冒烟验证失败：', error);
  process.exit(1);
});
