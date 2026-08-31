/**
 * @patchflow/db
 *
 * PatchFlow 持久化层：Drizzle Schema 与 PostgreSQL 客户端工厂。
 * PostgreSQL 是业务状态的唯一事实来源；BullMQ/Redis 只负责任务投递。
 * 禁止在模块导入时建立数据库连接——统一通过 createDb() 显式创建。
 */
export { createDb } from './client.js';
export type { CreateDbOptions, Db, DbHandle } from './client.js';
export {
  runEvents,
  runs,
  runEventsRelations,
  runsRelations,
  runEventTypeEnum,
  runPhaseEnum,
  runStatusEnum,
} from './schema.js';
export type { NewRunEventRow, NewRunRow, RunEventRow, RunRow } from './schema.js';
