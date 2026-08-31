import { Redis } from 'ioredis';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { createLogger } from '@patchflow/observability';
import { createDb, type DbHandle } from '@patchflow/db';
import { checkReadiness, type ReadinessDependencies } from './readiness.js';
import { parseApiEnv, type ApiEnv } from './env.js';

/** 与 package.json 的 version 保持同步（避免 NodeNext 下的 JSON import 断言）。 */
export const API_VERSION = '0.1.0';
export const CURRENT_STAGE = 'Foundation' as const;

export interface BuildAppOptions {
  env?: ApiEnv;
  /** 使用 Fastify 的基础 Logger 接口，兼容 pino Logger 与测试替身。 */
  logger?: FastifyBaseLogger;
  /** 注入测试替身；不注入时按 env 创建真实客户端（均为惰性连接）。 */
  db?: DbHandle;
  redis?: RedisLikeClient;
  /** 就绪检查单项超时（毫秒）；undefined 时使用默认值。 */
  readinessTimeoutMs?: number | undefined;
}

/** ioredis 客户端的最小接口，测试可替换。 */
export interface RedisLikeClient {
  ping(): Promise<string>;
  quit(): Promise<void>;
  disconnect(): void;
}

/**
 * 构建 Fastify 应用（不监听端口，测试用 app.inject() 直接调用）。
 *
 * 依赖客户端在此时创建但都不建立连接：
 * - pg.Pool 在第一条查询前不连接；
 * - ioredis 以 lazyConnect 创建，仅在 /ready 探测时连接。
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const env = options.env ?? parseApiEnv(process.env);
  const logger =
    options.logger ??
    createLogger({
      name: 'patchflow-api',
      level: env.LOG_LEVEL,
      pretty: env.NODE_ENV !== 'production',
    });

  const ownsDependencies = options.db === undefined && options.redis === undefined;
  const db = options.db ?? createDb({ connectionString: env.DATABASE_URL });
  const redis =
    options.redis ??
    new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });

  const app = Fastify({ loggerInstance: logger });

  app.get('/health', () => {
    // 只表示进程存活，不检查任何外部依赖。
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  });

  app.get('/ready', async (_request, reply) => {
    // 真实 ioredis 客户端是 lazyConnect 的：探测前若尚未连接，先建立连接。
    // 注入的测试替身只有 ping()，直接透传。
    const readinessRedis = {
      ping: async (): Promise<string> => {
        const client = redis as Redis;
        if (
          typeof client.connect === 'function' &&
          ['wait', 'end', 'close'].includes(client.status)
        ) {
          // 已在连接中会抛错，忽略后继续 ping。
          await client.connect().catch(() => undefined);
        }
        return redis.ping();
      },
    };
    const dependencies: ReadinessDependencies = { postgres: db.pool, redis: readinessRedis };
    const report = await checkReadiness(dependencies, options.readinessTimeoutMs);
    if (report.status !== 'ready') {
      logger.warn({ checks: report.checks }, '就绪检查失败');
      return await reply.status(503).send({
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message: '部分依赖不可用，服务未就绪',
          checks: report.checks,
        },
      });
    }
    return reply.send(report);
  });

  app.get('/api/version', () => {
    return {
      name: 'patchflow-api',
      version: API_VERSION,
      stage: CURRENT_STAGE,
      node: process.version,
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    logger.error({ err: error }, '请求处理失败');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  });

  app.addHook('onClose', async () => {
    if (ownsDependencies) {
      await db.close();
      redis.disconnect();
    }
  });

  return app;
}
