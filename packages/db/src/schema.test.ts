import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { RUN_EVENT_TYPES, RUN_PHASES, RUN_STATUSES } from '@patchflow/contracts';
import { runEvents, runs, runEventTypeEnum, runPhaseEnum, runStatusEnum } from './schema.js';

/**
 * 结构测试：不连接数据库，验证 Schema 定义与契约一致。
 * 真实迁移与查询行为由后续阶段的 Testcontainers 集成测试覆盖。
 */
describe('runs 表结构', () => {
  it('表名与必需列齐全', () => {
    expect(getTableName(runs)).toBe('runs');
    const columns = getTableColumns(runs);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(['id', 'status', 'phase', 'version', 'createdAt', 'updatedAt']),
    );
  });

  it('status 默认 queued 且不允许为空', () => {
    const status = getTableColumns(runs)['status'];
    expect(status).toBeDefined();
    if (status) {
      expect(status.hasDefault).toBe(true);
      expect(status.notNull).toBe(true);
    }
  });

  it('phase 允许为空（queued 阶段无执行阶段）', () => {
    const phase = getTableColumns(runs)['phase'];
    if (phase) {
      expect(phase.notNull).toBe(false);
    }
  });

  it('version 有默认值且不允许为空', () => {
    const version = getTableColumns(runs)['version'];
    if (version) {
      expect(version.hasDefault).toBe(true);
      expect(version.notNull).toBe(true);
    }
  });
});

describe('run_events 表结构', () => {
  it('表名与必需列齐全', () => {
    expect(getTableName(runEvents)).toBe('run_events');
    const columns = getTableColumns(runEvents);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(['id', 'runId', 'sequence', 'type', 'payload', 'createdAt']),
    );
  });

  it('runId 外键指向 runs 表且不允许为空', () => {
    const config = getTableConfig(runEvents);
    expect(config.foreignKeys).toHaveLength(1);
    const foreignKey = config.foreignKeys[0];
    expect(foreignKey).toBeDefined();
    if (foreignKey) {
      expect(getTableName(foreignKey.reference().foreignTable)).toBe('runs');
    }
    expect(getTableColumns(runEvents)['runId']?.notNull).toBe(true);
  });

  it('sequence 不允许为空', () => {
    expect(getTableColumns(runEvents)['sequence']?.notNull).toBe(true);
  });

  it('payload 为 jsonb、非空且有默认值', () => {
    const payload = getTableColumns(runEvents)['payload'];
    if (payload) {
      expect(payload.notNull).toBe(true);
      expect(payload.hasDefault).toBe(true);
    }
  });

  it('存在 (runId, sequence) 唯一约束', () => {
    const config = getTableConfig(runEvents);
    const unique = config.uniqueConstraints.find(
      (constraint) => constraint.name === 'run_events_run_id_sequence_key',
    );
    expect(unique).toBeDefined();
    expect(unique?.columns.map((column) => column.name)).toEqual(['run_id', 'sequence']);
  });

  it('runId 上存在索引以加速按 Run 查询事件', () => {
    const config = getTableConfig(runEvents);
    expect(config.indexes.some((index) => index.config.name === 'run_events_run_id_idx')).toBe(
      true,
    );
  });
});

describe('枚举与契约一致', () => {
  it('run_status 枚举覆盖全部状态', () => {
    expect(runStatusEnum.enumValues).toEqual(RUN_STATUSES);
  });

  it('run_phase 枚举覆盖全部执行阶段', () => {
    expect(runPhaseEnum.enumValues).toEqual(RUN_PHASES);
  });

  it('run_event_type 枚举覆盖全部事件类型', () => {
    expect(runEventTypeEnum.enumValues).toEqual(RUN_EVENT_TYPES);
  });
});
