import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import type { DbHandle } from '@patchflow/db';
import { createLogger } from '@patchflow/observability';
import { buildApp, CURRENT_STAGE, type RedisLikeClient } from './app.js';
import type { ApiEnv } from './env.js';
import type { ReadinessReport } from './readiness.js';

const testEnv: ApiEnv = {
  NODE_ENV: 'test',
  // 契约层不含 pino 的 'silent'；createLogger 单独传 level: 'silent' 抑制输出。
  LOG_LEVEL: 'error',
  DATABASE_URL: 'postgresql://stub:stub@localhost:5432/stub',
  REDIS_URL: 'redis://localhost:6379',
  API_PORT: 3_001,
};

const silentLogger = createLogger({
  name: 'patchflow-api-test',
  level: 'silent',
  pretty: false,
  destination: new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  }),
});

const apps: FastifyInstance[] = [];
afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

function fakeDb(query: (sql: string) => Promise<unknown> = () => Promise.resolve({ rows: [] })) {
  return {
    db: {} as DbHandle['db'],
    pool: { query } as unknown as DbHandle['pool'],
    close: () => Promise.resolve(),
  } satisfies DbHandle;
}

function fakeRedis(ping: () => Promise<string> = () => Promise.resolve('PONG')): RedisLikeClient {
  return { ping, quit: () => Promise.resolve(), disconnect: () => {} };
}

interface ReadyErrorBody {
  error: {
    code: string;
    message: string;
    checks: { name: string; status: string; error?: string }[];
  };
}

function makeApp(overrides: { db?: DbHandle; redis?: RedisLikeClient; timeoutMs?: number } = {}) {
  const app = buildApp({
    env: testEnv,
    logger: silentLogger,
    db: overrides.db ?? fakeDb(),
    redis: overrides.redis ?? fakeRedis(),
    readinessTimeoutMs: overrides.timeoutMs,
  });
  apps.push(app);
  return app;
}

describe('GET /health', () => {
  it('进程存活返回 200 与 ok', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>()).toMatchObject({ status: 'ok' });
  });

  it('不注入数据库也返回 200（客户端惰性创建，不产生真实连接）', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('GET /api/version', () => {
  it('返回名称、版本与 Foundation 阶段', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/version' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ name: string; version: string; stage: string; node: string }>();
    expect(body.name).toBe('patchflow-api');
    expect(body.version).toBe('0.1.0');
    expect(body.stage).toBe(CURRENT_STAGE);
    expect(body.stage).toBe('Foundation');
  });
});

describe('GET /ready', () => {
  it('依赖全部可用时返回 200 与逐项检查结果', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    const body = response.json<ReadinessReport>();
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual([
      expect.objectContaining({ name: 'postgres', status: 'up' }),
      expect.objectContaining({ name: 'redis', status: 'up' }),
    ]);
  });

  it('Redis 不可用时返回 503 与结构化错误', async () => {
    const app = makeApp({
      redis: fakeRedis(() => Promise.reject(new Error('ECONNREFUSED'))),
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json<ReadyErrorBody>();
    expect(body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(body.error.message).toContain('未就绪');
    const redisCheck = body.error.checks.find((check) => check.name === 'redis');
    expect(redisCheck?.status).toBe('down');
    expect(redisCheck?.error).toContain('ECONNREFUSED');
    expect(body.error.checks.find((check) => check.name === 'postgres')?.status).toBe('up');
  });

  it('PostgreSQL 不可用时返回 503 与结构化错误', async () => {
    const app = makeApp({
      db: fakeDb(() => Promise.reject(new Error('connection terminated'))),
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json<ReadyErrorBody>();
    expect(body.error.checks.find((check) => check.name === 'postgres')?.status).toBe('down');
  });

  it('依赖超时（一直不响应）时返回 503 而不是挂起', async () => {
    const app = makeApp({
      redis: fakeRedis(() => new Promise<string>(() => {})),
      timeoutMs: 50,
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json<ReadyErrorBody>();
    const redisCheck = body.error.checks.find((check) => check.name === 'redis');
    expect(redisCheck?.status).toBe('down');
    expect(redisCheck?.error).toContain('未响应');
  }, 5_000);
});
