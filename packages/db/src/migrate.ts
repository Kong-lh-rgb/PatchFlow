import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/** migrations 目录：packages/db/drizzle（本文件位于 src/，经 tsx 直接运行）。 */
export function migrationsFolder(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
}

/** 对给定连接串执行全部未应用的 migration，完成后关闭连接池。 */
export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDb({ connectionString });
  try {
    await migrate(handle.db, { migrationsFolder: migrationsFolder() });
  } finally {
    await handle.close();
  }
}

function loadEnvFiles(): void {
  for (const file of ['../../.env', '.env']) {
    try {
      process.loadEnvFile(file);
    } catch {
      // 文件不存在时忽略
    }
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  loadEnvFiles();
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('缺少 DATABASE_URL 环境变量，无法执行 migration。');
    process.exit(1);
  }
  runMigrations(connectionString)
    .then(() => {
      console.log('Migration 完成。');
    })
    .catch((error: unknown) => {
      console.error('Migration 失败：', error);
      process.exit(1);
    });
}
