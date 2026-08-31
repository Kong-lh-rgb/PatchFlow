import { describe, expect, it } from 'vitest';
import { BaseEnvSchema, formatZodError, parseEnv } from './env.js';

const validEnv = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://patchflow:patchflow@localhost:5432/patchflow',
  REDIS_URL: 'redis://localhost:6379',
};

describe('BaseEnvSchema', () => {
  it('接受完整环境变量', () => {
    expect(BaseEnvSchema.parse(validEnv)).toEqual(validEnv);
  });

  it('NODE_ENV 与 LOG_LEVEL 缺省时有默认值', () => {
    const parsed = BaseEnvSchema.parse({
      DATABASE_URL: validEnv.DATABASE_URL,
      REDIS_URL: validEnv.REDIS_URL,
    });
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it.each([
    ['缺少 DATABASE_URL', { DATABASE_URL: undefined }],
    ['缺少 REDIS_URL', { REDIS_URL: undefined }],
    ['非法 NODE_ENV', { NODE_ENV: 'staging' }],
    ['非法 LOG_LEVEL', { LOG_LEVEL: 'verbose' }],
    ['DATABASE_URL 为空字符串', { DATABASE_URL: '' }],
  ])('拒绝非法环境变量（%s）', (_label, override) => {
    expect(BaseEnvSchema.safeParse({ ...validEnv, ...override }).success).toBe(false);
  });
});

describe('parseEnv', () => {
  it('返回解析后的环境对象', () => {
    expect(parseEnv(BaseEnvSchema, validEnv)).toEqual(validEnv);
  });

  it('校验失败时抛出包含变量名的可读错误', () => {
    expect(() =>
      parseEnv(BaseEnvSchema, { NODE_ENV: 'staging', DATABASE_URL: '', REDIS_URL: '' }),
    ).toThrowError(/NODE_ENV.*staging|DATABASE_URL|REDIS_URL/);
  });

  it('formatZodError 输出 path 与 message', () => {
    const result = BaseEnvSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('DATABASE_URL');
      expect(formatted).toContain('REDIS_URL');
    }
  });
});
