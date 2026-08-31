import { Redis } from 'ioredis';

/**
 * 创建 BullMQ 专用 Redis 连接（惰性连接：仅在显式 connect() 后建立）。
 * BullMQ 要求 maxRetriesPerRequest 为 null，避免阻塞命令被重试上限截断。
 */
export function createQueueConnection(url?: string): Redis {
  return new Redis(url ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
}
