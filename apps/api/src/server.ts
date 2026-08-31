import { buildApp } from './app.js';
import { loadEnvFiles, parseApiEnv } from './env.js';

async function main(): Promise<void> {
  loadEnvFiles();

  let env;
  try {
    env = parseApiEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const app = buildApp({ env });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`收到 ${signal}，开始优雅关闭…`);
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      console.error('优雅关闭失败：', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error, 'API 启动失败');
    process.exit(1);
  }
}

void main();
