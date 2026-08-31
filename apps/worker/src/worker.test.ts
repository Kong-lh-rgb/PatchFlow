import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RunExecuteJobSchema } from './job.js';
import { InvalidJobDataError, parseRunExecuteJob, processRunExecuteJob } from './worker.js';
import { createLogger } from '@patchflow/observability';

const validRunId = '0192ab3c-def1-7000-8000-0000000000ff';

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim().length > 0) lines.push(line);
      }
      callback();
    },
  });
  const logger = createLogger({ level: 'info', pretty: false, destination });
  return {
    logger,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('RunExecuteJobSchema', () => {
  it('接受最小合法任务', () => {
    expect(RunExecuteJobSchema.parse({ runId: validRunId })).toEqual({ runId: validRunId });
  });

  it('接受带 enqueuedAt 的任务', () => {
    const parsed = RunExecuteJobSchema.parse({
      runId: validRunId,
      enqueuedAt: '2026-08-31T12:00:00.000Z',
    });
    expect(parsed.enqueuedAt).toBe('2026-08-31T12:00:00.000Z');
  });

  it.each([
    ['缺少 runId', {}],
    ['runId 不是 UUID', { runId: 'run-1' }],
    ['runId 为空字符串', { runId: '' }],
    ['runId 为数字', { runId: 42 }],
    ['enqueuedAt 非法时间', { runId: validRunId, enqueuedAt: 'yesterday' }],
  ])('拒绝非法任务数据（%s）', (_label, value) => {
    expect(RunExecuteJobSchema.safeParse(value).success).toBe(false);
  });
});

describe('parseRunExecuteJob', () => {
  it('非法数据抛 InvalidJobDataError 且信息包含字段名', () => {
    try {
      parseRunExecuteJob({ runId: 'not-uuid' });
      expect.unreachable('应当抛出 InvalidJobDataError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidJobDataError);
      expect((error as InvalidJobDataError).issues).toContain('runId');
    }
  });

  it('合法数据返回解析结果', () => {
    expect(parseRunExecuteJob({ runId: validRunId }).runId).toBe(validRunId);
  });
});

describe('processRunExecuteJob', () => {
  it('合法任务返回 acknowledged 并输出结构化日志', async () => {
    const { logger, entries } = captureLogger();
    const result = await processRunExecuteJob({ runId: validRunId }, logger);
    expect(result).toEqual({ runId: validRunId, status: 'acknowledged' });

    const entry = entries()[0];
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry['runId']).toBe(validRunId);
      expect(entry['jobName']).toBe('run.execute');
      expect(entry['msg']).toContain('run.execute');
    }
  });

  it('非法任务数据抛 InvalidJobDataError（BullMQ 将其标记为 failed）', async () => {
    const { logger } = captureLogger();
    await expect(processRunExecuteJob({ runId: 123 }, logger)).rejects.toBeInstanceOf(
      InvalidJobDataError,
    );
    await expect(processRunExecuteJob(null, logger)).rejects.toThrow(/任务数据非法/);
    // undefined 输入在根级报错（不是对象），同样拒绝而不是静默通过。
    await expect(processRunExecuteJob(undefined, logger)).rejects.toThrow(/任务数据非法.*\(root\)/);
  });

  it('日志不包含入队载荷之外的敏感字段', async () => {
    const { logger, entries } = captureLogger();
    await processRunExecuteJob({ runId: validRunId }, logger);
    const entry = entries()[0];
    expect(entry).toBeDefined();
    if (entry) {
      expect(Object.keys(entry)).not.toContain('password');
      expect(Object.keys(entry)).not.toContain('apiKey');
    }
  });
});
