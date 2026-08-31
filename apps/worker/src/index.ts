import { createLogger } from '@patchflow/observability';
import { createQueueConnection } from './connection.js';
import { loadEnvFiles, parseWorkerEnv } from './env.js';
import { createRunQueue } from './queue.js';
import { createRunWorker, shutdownRunWorker } from './worker.js';

async function main(): Promise<void> {
  loadEnvFiles();

  let env;
  try {
    env = parseWorkerEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const logger = createLogger({
    name: 'patchflow-worker',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV !== 'production',
  });

  const connection = createQueueConnection(env.REDIS_URL);
  try {
    await connection.connect();
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      '无法连接 Redis，Worker 启动失败',
    );
    process.exit(1);
  }

  const queue = createRunQueue(connection);
  const worker = createRunWorker({ connection, logger });

  logger.info({ queue: 'runs', concurrency: 5 }, 'Worker 已启动并开始消费队列');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '收到信号，开始优雅关闭…');
    try {
      await shutdownRunWorker(worker);
      await queue.close();
      connection.disconnect();
      logger.info('Worker 已优雅退出');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, '优雅关闭失败');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
