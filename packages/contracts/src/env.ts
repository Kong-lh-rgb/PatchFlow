import { z } from 'zod';

export const NodeEnvSchema = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.output<typeof NodeEnvSchema>;

export const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevel = z.output<typeof LogLevelSchema>;

/**
 * 所有服务共享的基础环境变量契约。
 * 各应用在其上叠加自己的变量（如 API_PORT、NEXT_PUBLIC_API_BASE_URL），
 * 在进程入口处调用 parse 并立即失败，避免带错误配置进入运行态。
 */
export const BaseEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema.default('development'),
  LOG_LEVEL: LogLevelSchema.default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
});
export type BaseEnv = z.output<typeof BaseEnvSchema>;

/** 将 Zod 校验失败转换为人类可读的单行错误信息。 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}

/** 解析并校验环境变量，失败时抛出带明确提示的 Error。 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.output<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`环境变量校验失败：${formatZodError(result.error)}`);
  }
  return result.data;
}
