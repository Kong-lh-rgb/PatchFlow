import { z } from 'zod';
import { BaseEnvSchema, parseEnv } from '@patchflow/contracts';

/** API 服务环境变量：共享基础变量 + API 专属变量。 */
export const ApiEnvSchema = BaseEnvSchema.extend({
  /** Fastify 监听端口，环境变量为字符串，这里做数值转换。 */
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
});
export type ApiEnv = z.output<typeof ApiEnvSchema>;

export function parseApiEnv(source: Record<string, string | undefined>): ApiEnv {
  return parseEnv(ApiEnvSchema, source);
}

/** 尝试加载仓库根目录与当前目录的 .env（存在才加载）。 */
export function loadEnvFiles(): void {
  for (const file of ['../../.env', '.env']) {
    try {
      process.loadEnvFile(file);
    } catch {
      // 文件不存在时忽略
    }
  }
}
