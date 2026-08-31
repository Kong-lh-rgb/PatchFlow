import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { RUN_EVENT_TYPES, RUN_PHASES, RUN_STATUSES } from '@patchflow/contracts';

/** Run 生命周期状态（唯一权威状态），取值来自 @patchflow/contracts。 */
export const runStatusEnum = pgEnum('run_status', RUN_STATUSES);

/** Run 执行阶段（仅执行期有值）。 */
export const runPhaseEnum = pgEnum('run_phase', RUN_PHASES);

/** Run 事件类型，用于 SSE 与审计事件流。 */
export const runEventTypeEnum = pgEnum('run_event_type', RUN_EVENT_TYPES);

/**
 * runs：一次 Agent 执行的持久化状态。
 * Foundation 阶段只保留最小列；version 用于后续乐观并发控制。
 */
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: runStatusEnum('status').notNull().default('queued'),
  phase: runPhaseEnum('phase'),
  /** 乐观并发控制版本号，每次状态转换递增。 */
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * run_events：单个 Run 内单调递增的事件流。
 * (runId, sequence) 唯一，支撑 SSE 断线续传（Last-Event-ID）。
 */
export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** Run 内单调递增，从 1 开始。 */
    sequence: integer('sequence')
      .notNull()
      .default(sql`1`),
    type: runEventTypeEnum('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('run_events_run_id_sequence_key').on(table.runId, table.sequence),
    index('run_events_run_id_idx').on(table.runId),
  ],
);

export const runsRelations = relations(runs, ({ many }) => ({
  events: many(runEvents),
}));

export const runEventsRelations = relations(runEvents, ({ one }) => ({
  run: one(runs, { fields: [runEvents.runId], references: [runs.id] }),
}));

export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;
export type RunEventRow = typeof runEvents.$inferSelect;
export type NewRunEventRow = typeof runEvents.$inferInsert;
