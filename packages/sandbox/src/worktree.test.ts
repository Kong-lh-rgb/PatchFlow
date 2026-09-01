import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorktree,
  inspectWorktree,
  removeWorktree,
  type WorktreeManagerOptions,
} from './worktree.js';

const execFileAsync = promisify(execFile);

let temporaryRoot: string;
let repositoryPath: string;
let worktreeBaseDir: string;
let baseCommit: string;
let options: WorktreeManagerOptions;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return result.stdout.trim();
}

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'patchflow-worktree-test-'));
  repositoryPath = path.join(temporaryRoot, 'repository');
  worktreeBaseDir = path.join(temporaryRoot, 'managed-runs');
  options = { baseDir: worktreeBaseDir };

  await fs.mkdir(repositoryPath, { recursive: true });
  await execFileAsync('git', ['init', '-b', 'main', repositoryPath]);
  await fs.writeFile(path.join(repositoryPath, 'README.md'), 'original\n');
  await git(repositoryPath, 'add', 'README.md');
  await execFileAsync('git', [
    '-C',
    repositoryPath,
    '-c',
    'user.name=PatchFlow Test',
    '-c',
    'user.email=patchflow@example.invalid',
    'commit',
    '-m',
    'initial',
  ]);
  baseCommit = await git(repositoryPath, 'rev-parse', 'HEAD');
});

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

describe('createWorktree', () => {
  it('从指定 baseRef 创建 detached Worktree', async () => {
    const created = await createWorktree(
      { repositoryPath, runId: 'run-a', baseRef: 'main' },
      options,
    );

    expect(created.baseCommit).toBe(baseCommit);
    expect(created.headCommit).toBe(baseCommit);
    expect(created.dirty).toBe(false);
    expect(created.worktreePath).toBe(path.join(await fs.realpath(worktreeBaseDir), 'run-a'));
    expect(await fs.readFile(path.join(created.worktreePath, 'README.md'), 'utf8')).toBe(
      'original\n',
    );
    await expect(git(created.worktreePath, 'symbolic-ref', '-q', 'HEAD')).rejects.toBeDefined();
  });

  it('修改 Worktree 不影响原始工作目录', async () => {
    const created = await createWorktree(
      { repositoryPath, runId: 'run-isolated', baseRef: 'main' },
      options,
    );
    await fs.writeFile(path.join(created.worktreePath, 'README.md'), 'changed in worktree\n');

    expect(await fs.readFile(path.join(repositoryPath, 'README.md'), 'utf8')).toBe('original\n');
    expect((await inspectWorktree({ repositoryPath, runId: 'run-isolated' }, options)).dirty).toBe(
      true,
    );
  });

  it('两个 Run 的 Worktree 相互独立', async () => {
    const first = await createWorktree(
      { repositoryPath, runId: 'run-first', baseRef: 'main' },
      options,
    );
    const second = await createWorktree(
      { repositoryPath, runId: 'run-second', baseRef: 'main' },
      options,
    );
    await fs.writeFile(path.join(first.worktreePath, 'only-first.txt'), 'first\n');

    await expect(fs.access(path.join(second.worktreePath, 'only-first.txt'))).rejects.toBeDefined();
    expect(first.worktreePath).not.toBe(second.worktreePath);
  });

  it('拒绝非 Git 仓库', async () => {
    const plainDirectory = path.join(temporaryRoot, 'plain');
    await fs.mkdir(plainDirectory);
    await expect(
      createWorktree(
        { repositoryPath: plainDirectory, runId: 'run-plain', baseRef: 'main' },
        options,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REPOSITORY' });
  });

  it('拒绝不存在的 baseRef', async () => {
    await expect(
      createWorktree({ repositoryPath, runId: 'run-bad-ref', baseRef: 'missing-branch' }, options),
    ).rejects.toMatchObject({ code: 'INVALID_BASE_REF' });
  });

  it.each(['../escape', 'with/slash', '.hidden', '', '-option'])(
    '拒绝可能改变受管目录的 runId：%j',
    async (runId) => {
      await expect(
        createWorktree({ repositoryPath, runId, baseRef: 'main' }, options),
      ).rejects.toMatchObject({ code: 'INVALID_RUN_ID' });
    },
  );

  it('重复 runId 不覆盖已有 Worktree', async () => {
    await createWorktree({ repositoryPath, runId: 'run-duplicate', baseRef: 'main' }, options);
    await expect(
      createWorktree({ repositoryPath, runId: 'run-duplicate', baseRef: 'main' }, options),
    ).rejects.toMatchObject({ code: 'WORKTREE_EXISTS' });
  });

  it('拒绝把受管 Worktree 根目录放进目标仓库', async () => {
    const invalidBaseDir = path.join(repositoryPath, '.patchflow-runs');
    await expect(
      createWorktree(
        { repositoryPath, runId: 'run-inside', baseRef: 'main' },
        { baseDir: invalidBaseDir },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_WORKTREE_ROOT' });
    await expect(fs.access(invalidBaseDir)).rejects.toBeDefined();
  });
});

describe('inspectWorktree', () => {
  it('返回 HEAD、仓库归属和脏状态', async () => {
    const created = await createWorktree(
      { repositoryPath, runId: 'run-inspect', baseRef: 'main' },
      options,
    );
    const clean = await inspectWorktree({ repositoryPath, runId: 'run-inspect' }, options);
    expect(clean.repositoryRoot).toBe(await fs.realpath(repositoryPath));
    expect(clean.headCommit).toBe(baseCommit);
    expect(clean.dirty).toBe(false);

    await fs.writeFile(path.join(created.worktreePath, 'new-file.txt'), 'untracked\n');
    const dirty = await inspectWorktree({ repositoryPath, runId: 'run-inspect' }, options);
    expect(dirty.dirty).toBe(true);
  });

  it('拒绝不存在的 Worktree', async () => {
    await fs.mkdir(worktreeBaseDir, { recursive: true });
    await expect(
      inspectWorktree({ repositoryPath, runId: 'run-missing' }, options),
    ).rejects.toMatchObject({ code: 'WORKTREE_NOT_FOUND' });
  });

  it('拒绝冒充受管 Worktree 的普通目录', async () => {
    await fs.mkdir(path.join(worktreeBaseDir, 'run-fake'), { recursive: true });
    await expect(
      inspectWorktree({ repositoryPath, runId: 'run-fake' }, options),
    ).rejects.toMatchObject({ code: 'WORKTREE_MISMATCH' });
  });
});

describe('removeWorktree', () => {
  it('删除干净的 Worktree', async () => {
    const created = await createWorktree(
      { repositoryPath, runId: 'run-clean', baseRef: 'main' },
      options,
    );
    const removed = await removeWorktree({ repositoryPath, runId: 'run-clean' }, options);

    expect(removed.removed).toBe(true);
    await expect(fs.access(created.worktreePath)).rejects.toBeDefined();
    expect(await git(repositoryPath, 'worktree', 'list', '--porcelain')).not.toContain(
      created.worktreePath,
    );
  });

  it('默认拒绝删除有修改的 Worktree', async () => {
    const created = await createWorktree(
      { repositoryPath, runId: 'run-dirty', baseRef: 'main' },
      options,
    );
    await fs.writeFile(path.join(created.worktreePath, 'README.md'), 'dirty\n');

    await expect(
      removeWorktree({ repositoryPath, runId: 'run-dirty' }, options),
    ).rejects.toMatchObject({ code: 'WORKTREE_DIRTY' });
    await expect(fs.access(created.worktreePath)).resolves.toBeUndefined();
  });

  it('force=true 可以删除有修改的临时 Worktree', async () => {
    const created = await createWorktree(
      { repositoryPath, runId: 'run-force', baseRef: 'main' },
      options,
    );
    await fs.writeFile(path.join(created.worktreePath, 'README.md'), 'dirty\n');

    await removeWorktree({ repositoryPath, runId: 'run-force', force: true }, options);
    await expect(fs.access(created.worktreePath)).rejects.toBeDefined();
  });
});
