import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export { schema };

export interface CreateDbOptions {
  /** PostgreSQL 连接串；不传时使用 process.env.DATABASE_URL。 */
  connectionString?: string;
  /** 允许注入已有 Pool（测试或复用连接时使用）。 */
  pool?: Pool;
  /** 连接池大小，默认 10。 */
  max?: number;
}

export interface DbHandle {
  db: Db;
  pool: Pool;
  /** 关闭底层连接池。 */
  close(): Promise<void>;
}

/**
 * 创建数据库客户端。
 *
 * 注意：pg.Pool 是惰性连接的，构造时不会真正建立数据库连接；
 * 真正的连接发生在第一条查询时，因此本函数可在模块顶层安全调用。
 */
export function createDb(options: CreateDbOptions = {}): DbHandle {
  const pool =
    options.pool ??
    new pg.Pool({
      connectionString: options.connectionString ?? process.env['DATABASE_URL'],
      max: options.max ?? 10,
    });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}
