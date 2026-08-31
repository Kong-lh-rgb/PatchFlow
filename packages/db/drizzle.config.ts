import { defineConfig } from 'drizzle-kit';

// 尝试加载仓库根目录与当前目录的 .env（存在才加载）。
for (const file of ['../../.env', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // 文件不存在时忽略
  }
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  // 仅 db:push / introspect 使用；generate 不需要连接数据库。
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://patchflow:patchflow@localhost:5432/patchflow',
  },
});
