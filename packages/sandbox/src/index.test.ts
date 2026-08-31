import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMAND_POLICY, DEFAULT_SANDBOX_LIMITS, checkCommandPolicy } from './index.js';

describe('DEFAULT_SANDBOX_LIMITS', () => {
  it('默认断网、非 root、只读根文件系统', () => {
    expect(DEFAULT_SANDBOX_LIMITS.networkMode).toBe('none');
    expect(DEFAULT_SANDBOX_LIMITS.nonRoot).toBe(true);
    expect(DEFAULT_SANDBOX_LIMITS.readOnlyRootFs).toBe(true);
  });

  it('禁止挂载 Docker Socket 与宿主凭据目录', () => {
    expect(DEFAULT_SANDBOX_LIMITS.forbiddenMounts).toContain('/var/run/docker.sock');
    expect(DEFAULT_SANDBOX_LIMITS.forbiddenMounts.length).toBeGreaterThanOrEqual(3);
  });

  it('资源限制均为正数', () => {
    expect(DEFAULT_SANDBOX_LIMITS.maxCpus).toBeGreaterThan(0);
    expect(DEFAULT_SANDBOX_LIMITS.memoryMb).toBeGreaterThan(0);
    expect(DEFAULT_SANDBOX_LIMITS.maxPids).toBeGreaterThan(0);
    expect(DEFAULT_SANDBOX_LIMITS.commandTimeoutSeconds).toBeGreaterThan(0);
  });
});

describe('checkCommandPolicy', () => {
  it('允许 Allowlist 内的程序', () => {
    expect(checkCommandPolicy('node')).toBe(true);
    expect(checkCommandPolicy('git')).toBe(true);
    expect(checkCommandPolicy('pytest')).toBe(true);
  });

  it('拒绝 Allowlist 外的程序', () => {
    expect(checkCommandPolicy('curl')).toBe(false);
    expect(checkCommandPolicy('sh')).toBe(false);
    expect(checkCommandPolicy('rm')).toBe(false);
  });

  it('默认策略不允许网络', () => {
    expect(DEFAULT_COMMAND_POLICY.allowNetwork).toBe(false);
  });
});
