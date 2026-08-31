import type { z } from 'zod';
import { BaseEnvSchema, parseEnv } from '@patchflow/contracts';

/** Worker 环境变量：Foundation 阶段只需要 Redis，暂不要求数据库。 */
export const WorkerEnvSchema = BaseEnvSchema.omit({ DATABASE_URL: true });
export type WorkerEnv = z.output<typeof WorkerEnvSchema>;

export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  return parseEnv(WorkerEnvSchema, source);
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
