import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REDACT_PATHS, REDACT_CENSOR, createLogger } from './logger.js';

/** 收集 pino 输出的内存流，逐行解析为 JSON。 */
function memoryDestination() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim().length > 0) lines.push(line);
      }
      callback();
    },
  });
  return {
    destination,
    entries(): Record<string, unknown>[] {
      return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    },
  };
}

describe('createLogger', () => {
  it('输出带 service 字段的 JSON 日志', () => {
    const sink = memoryDestination();
    const logger = createLogger({ name: 'patchflow-api', destination: sink.destination });
    logger.info({ requestId: 'req-1' }, 'hello');
    const entry = sink.entries()[0];
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry['service']).toBe('patchflow-api');
      expect(entry['msg']).toBe('hello');
      expect(entry['level']).toBe(30);
      expect(entry['requestId']).toBe('req-1');
    }
  });

  it('级别低于配置时不输出', () => {
    const sink = memoryDestination();
    const logger = createLogger({ level: 'warn', destination: sink.destination });
    logger.info('should be dropped');
    logger.warn('should be kept');
    const entries = sink.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.['msg']).toBe('should be kept');
  });

  it('脱敏 password 与嵌套 apiKey 字段', () => {
    const sink = memoryDestination();
    const logger = createLogger({ destination: sink.destination });
    logger.info(
      { password: 'super-secret', model: { apiKey: 'sk-123', name: 'test' } },
      'credentials',
    );
    const entry = sink.entries()[0];
    expect(entry?.['password']).toBe(REDACT_CENSOR);
    const model = entry?.['model'] as Record<string, unknown> | undefined;
    expect(model?.['apiKey']).toBe(REDACT_CENSOR);
    expect(model?.['name']).toBe('test');
  });

  it('脱敏连接串字段', () => {
    const sink = memoryDestination();
    const logger = createLogger({ destination: sink.destination });
    logger.info({ db: { connectionString: 'postgresql://user:pw@host/db' } }, 'db');
    const entry = sink.entries()[0];
    const db = entry?.['db'] as Record<string, unknown> | undefined;
    expect(db?.['connectionString']).toBe(REDACT_CENSOR);
  });

  it('非法日志级别抛出可读错误', () => {
    expect(() => createLogger({ level: 'verbose' })).toThrowError(/LOG_LEVEL/);
  });

  it('LOG_LEVEL 环境变量生效', () => {
    process.env['LOG_LEVEL'] = 'error';
    try {
      const sink = memoryDestination();
      const logger = createLogger({ destination: sink.destination });
      logger.warn('dropped');
      logger.error('kept');
      const entries = sink.entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.['msg']).toBe('kept');
    } finally {
      delete process.env['LOG_LEVEL'];
    }
  });

  it('默认脱敏路径覆盖常见凭据字段', () => {
    expect(DEFAULT_REDACT_PATHS).toContain('password');
    expect(DEFAULT_REDACT_PATHS).toContain('*.apiKey');
    expect(DEFAULT_REDACT_PATHS).toContain('req.headers.authorization');
  });
});
