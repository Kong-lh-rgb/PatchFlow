/**
 * 就绪检查：验证 PostgreSQL 与 Redis 是否可用。
 *
 * /health 只表示进程存活；/ready 才检查依赖，失败时返回 503 与结构化错误，
 * 供编排系统（Docker/K8s）决定是否分发流量。
 */

export interface PostgresLike {
  query(sql: string): Promise<unknown>;
}

export interface RedisLike {
  ping(): Promise<string>;
}

export interface ReadinessDependencies {
  postgres: PostgresLike;
  redis: RedisLike;
}

export interface ReadinessCheckResult {
  name: 'postgres' | 'redis';
  status: 'up' | 'down';
  latencyMs: number;
  /** down 时的错误说明，不含连接串等敏感信息。 */
  error?: string;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checkedAt: string;
  checks: ReadinessCheckResult[];
}

export const DEFAULT_READINESS_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 在 ${timeoutMs}ms 内未响应`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function runCheck(
  name: 'postgres' | 'redis',
  probe: () => Promise<unknown>,
  timeoutMs: number,
): Promise<ReadinessCheckResult> {
  const startedAt = Date.now();
  try {
    await withTimeout(probe(), timeoutMs, name);
    return { name, status: 'up', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      name,
      status: 'down',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 逐项探测依赖并汇总为 ReadinessReport；任何一项 down 即 not_ready。 */
export async function checkReadiness(
  dependencies: ReadinessDependencies,
  timeoutMs: number = DEFAULT_READINESS_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const checks = await Promise.all([
    runCheck('postgres', () => dependencies.postgres.query('SELECT 1'), timeoutMs),
    runCheck('redis', () => dependencies.redis.ping(), timeoutMs),
  ]);

  return {
    status: checks.every((check) => check.status === 'up') ? 'ready' : 'not_ready',
    checkedAt: new Date().toISOString(),
    checks,
  };
}
