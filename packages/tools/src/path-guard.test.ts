import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPathGuard, PathGuardError } from './path-guard.js';

const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'patchflow-path-guard-'));
const root = path.join(tmpBase, 'repo');
const outside = path.join(tmpBase, 'outside');

beforeAll(async () => {
  await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n');
  await fs.writeFile(path.join(root, 'src', 'nested', 'util.ts'), 'export {};\n');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret\n');
  // 指向仓库外的目录符号链接与文件符号链接。
  await fs.symlink(outside, path.join(root, 'escape-dir'));
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape-file.txt'));
  // 指向仓库内部的合法符号链接。
  await fs.symlink(path.join(root, 'src'), path.join(root, 'src-alias'));
});

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true });
});

describe('resolve（词法校验）', () => {
  it('普通相对路径解析到仓库内', async () => {
    const guard = await createPathGuard(root);
    expect(guard.resolve('src/index.ts')).toBe(path.join(guard.root, 'src', 'index.ts'));
  });

  it('带 ./ 前缀与重复分隔符也能正确规范化', async () => {
    const guard = await createPathGuard(root);
    expect(guard.resolve('./src//nested/util.ts')).toBe(
      path.join(guard.root, 'src', 'nested', 'util.ts'),
    );
  });

  it('根目录本身是合法目标', async () => {
    const guard = await createPathGuard(root);
    expect(guard.resolve('.')).toBe(guard.root);
  });

  it.each([
    ['直接上级', '../outside-file'],
    ['多级上级', 'src/../../outside-file'],
    ['上级后回正也不允许（越界判定基于最终位置）', 'src/../..'],
  ])('拒绝越界路径（%s）', async (_label, value) => {
    const guard = await createPathGuard(root);
    expect(() => guard.resolve(value)).toThrowError(PathGuardError);
    expect(() => guard.resolve(value)).toThrowError(/越界|PATH_ESCAPE|仓库外/);
  });

  it.each([
    ['绝对路径', '/etc/passwd'],
    ['空字符串', ''],
    ['空白字符串', '   '],
    ['NUL 字符', 'src/\0evil'],
  ])('拒绝非法路径（%s）', async (_label, value) => {
    const guard = await createPathGuard(root);
    expect(() => guard.resolve(value)).toThrowError(PathGuardError);
  });

  it('错误码区分 PATH_ESCAPE 与 INVALID_PATH', async () => {
    const guard = await createPathGuard(root);
    try {
      guard.resolve('../x');
      expect.unreachable('应当抛错');
    } catch (error) {
      expect((error as PathGuardError).code).toBe('PATH_ESCAPE');
    }
    try {
      guard.resolve('/etc');
      expect.unreachable('应当抛错');
    } catch (error) {
      expect((error as PathGuardError).code).toBe('INVALID_PATH');
    }
  });
});

describe('resolveReal（符号链接校验）', () => {
  it('真实路径在仓库内时通过', async () => {
    const guard = await createPathGuard(root);
    const real = await guard.resolveReal('src/index.ts');
    expect(real.startsWith(guard.realRoot)).toBe(true);
    expect(guard.toRelative(real)).toBe(path.join('src', 'index.ts'));
  });

  it('指向仓库内部的符号链接是合法的', async () => {
    const guard = await createPathGuard(root);
    const real = await guard.resolveReal('src-alias/nested/util.ts');
    expect(guard.toRelative(real)).toBe(path.join('src', 'nested', 'util.ts'));
  });

  it('拒绝指向仓库外的目录符号链接', async () => {
    const guard = await createPathGuard(root);
    await expect(guard.resolveReal('escape-dir/secret.txt')).rejects.toThrowError(
      /符号链接指向仓库外/,
    );
    await expect(guard.resolveReal('escape-dir/secret.txt')).rejects.toMatchObject({
      code: 'SYMLINK_ESCAPE',
    });
  });

  it('拒绝指向仓库外的文件符号链接', async () => {
    const guard = await createPathGuard(root);
    await expect(guard.resolveReal('escape-file.txt')).rejects.toMatchObject({
      code: 'SYMLINK_ESCAPE',
    });
  });

  it('词法越界的路径同样被拒绝', async () => {
    const guard = await createPathGuard(root);
    await expect(guard.resolveReal('../outside/secret.txt')).rejects.toMatchObject({
      code: 'PATH_ESCAPE',
    });
  });

  it('目标尚不存在时仍校验其已存在祖先的符号链接', async () => {
    const guard = await createPathGuard(root);
    // escape-dir 真实指向仓库外，其下的“未存在”子路径也必须被拒绝。
    await expect(guard.resolveReal('escape-dir/new-file.ts')).rejects.toMatchObject({
      code: 'SYMLINK_ESCAPE',
    });
    // 仓库内不存在的路径：祖先合法，返回保留剩余段的真实路径。
    const real = await guard.resolveReal('src/not-created-yet.ts');
    expect(guard.toRelative(real)).toBe(path.join('src', 'not-created-yet.ts'));
  });

  it('根目录本身返回真实根（macOS /tmp → /private/tmp）', async () => {
    const guard = await createPathGuard(root);
    expect(await guard.resolveReal('.')).toBe(guard.realRoot);
    expect(guard.realRoot.startsWith(os.tmpdir().replace('/tmp', '/private/tmp'))).toBe(
      guard.realRoot.includes('/private/tmp') || guard.realRoot.includes('/tmp'),
    );
  });
});
