import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** 默认 Worktree 根目录。Run 只能在该目录的直接子目录中创建工作区。 */
export const DEFAULT_WORKTREE_BASE_DIR = path.join(os.tmpdir(), 'patchflow', 'runs');

export type WorktreeErrorCode =
  | 'INVALID_REPOSITORY'
  | 'INVALID_RUN_ID'
  | 'INVALID_BASE_REF'
  | 'INVALID_WORKTREE_ROOT'
  | 'WORKTREE_EXISTS'
  | 'WORKTREE_NOT_FOUND'
  | 'WORKTREE_MISMATCH'
  | 'WORKTREE_DIRTY'
  | 'GIT_COMMAND_FAILED';

export class WorktreeError extends Error {
  constructor(
    readonly code: WorktreeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorktreeError';
  }
}

export interface WorktreeManagerOptions {
  /** 系统管理的 Worktree 父目录；不能位于目标仓库内部。 */
  readonly baseDir?: string;
  /** 测试或自定义安装场景可覆盖 Git 可执行文件。 */
  readonly gitBinary?: string;
  readonly commandTimeoutMs?: number;
}

export interface WorktreeIdentity {
  readonly repositoryPath: string;
  readonly runId: string;
}

export interface CreateWorktreeInput extends WorktreeIdentity {
  readonly baseRef: string;
}

export interface RemoveWorktreeInput extends WorktreeIdentity {
  /** 默认 false：存在未提交修改时拒绝删除。 */
  readonly force?: boolean;
}

export interface WorktreeInspection {
  readonly runId: string;
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly headCommit: string;
  readonly dirty: boolean;
}

export interface CreatedWorktree extends WorktreeInspection {
  readonly baseCommit: string;
}

export interface RemovedWorktree {
  readonly runId: string;
  readonly worktreePath: string;
  readonly removed: true;
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

function formatGitFailure(args: readonly string[], stderr: string, detail?: string): string {
  const command = ['git', ...args].join(' ');
  const reason = stderr.trim() || detail || '未知 Git 错误';
  return `${command} 执行失败：${reason.slice(0, 2_000)}`;
}

/** 使用参数数组执行 Git，不启用 Shell，并限制时间与输出大小。 */
function runGit(args: readonly string[], options: WorktreeManagerOptions): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.gitBinary ?? 'git', [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let forcedFailure: string | undefined;

    const timeoutMs = options.commandTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      forcedFailure = `超过 ${timeoutMs}ms 超时`;
      child.kill('SIGTERM');
    }, timeoutMs);

    const collect = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        forcedFailure = `输出超过 ${MAX_GIT_OUTPUT_BYTES} 字节上限`;
        child.kill('SIGTERM');
        return;
      }
      target.push(chunk);
    };

    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new WorktreeError(
          'GIT_COMMAND_FAILED',
          formatGitFailure(args, Buffer.concat(stderr).toString('utf8'), error.message),
        ),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0 || forcedFailure !== undefined) {
        reject(
          new WorktreeError(
            'GIT_COMMAND_FAILED',
            formatGitFailure(args, stderrText, forcedFailure ?? `退出码 ${String(code)}`),
          ),
        );
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
  });
}

function validateRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new WorktreeError(
      'INVALID_RUN_ID',
      'runId 只能包含字母、数字、下划线和连字符，长度为 1～128，且必须以字母或数字开头',
    );
  }
}

function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(prefix);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * 解析尚未创建路径的预期真实位置。
 * 对最深已存在祖先执行 realpath，再拼回未存在尾段，可处理 macOS /var → /private/var。
 */
async function prospectiveRealPath(target: string): Promise<string> {
  const remainder: string[] = [];
  let current = target;
  for (let depth = 0; depth < 128; depth += 1) {
    try {
      const realAncestor = await fs.realpath(current);
      return remainder.length === 0 ? realAncestor : path.join(realAncestor, ...remainder);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) break;
      remainder.unshift(path.basename(current));
      current = parent;
    }
  }
  throw new WorktreeError('INVALID_WORKTREE_ROOT', `无法解析 Worktree 根目录：${target}`);
}

async function resolveRepositoryRoot(
  repositoryPath: string,
  options: WorktreeManagerOptions,
): Promise<string> {
  let realInput: string;
  try {
    realInput = await fs.realpath(path.resolve(repositoryPath));
    if (!(await fs.stat(realInput)).isDirectory()) {
      throw new Error('目标不是目录');
    }
  } catch (error) {
    throw new WorktreeError(
      'INVALID_REPOSITORY',
      `仓库目录不可用：${repositoryPath}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }

  try {
    const result = await runGit(['-C', realInput, 'rev-parse', '--show-toplevel'], options);
    return await fs.realpath(result.stdout.trim());
  } catch (error) {
    throw new WorktreeError(
      'INVALID_REPOSITORY',
      `不是有效的 Git 仓库：${repositoryPath}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}

async function resolveBaseDir(options: WorktreeManagerOptions, create: boolean): Promise<string> {
  const configured = path.resolve(options.baseDir ?? DEFAULT_WORKTREE_BASE_DIR);
  if (create) {
    await fs.mkdir(configured, { recursive: true, mode: 0o700 });
  }
  try {
    return await fs.realpath(configured);
  } catch (error) {
    throw new WorktreeError(
      'WORKTREE_NOT_FOUND',
      `Worktree 根目录不存在：${configured}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}

async function resolveBaseCommit(
  repositoryRoot: string,
  baseRef: string,
  options: WorktreeManagerOptions,
): Promise<string> {
  if (baseRef.trim().length === 0 || baseRef.includes('\0') || baseRef.startsWith('-')) {
    throw new WorktreeError('INVALID_BASE_REF', `非法 baseRef：${JSON.stringify(baseRef)}`);
  }
  try {
    const result = await runGit(
      ['-C', repositoryRoot, 'rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`],
      options,
    );
    return result.stdout.trim();
  } catch (error) {
    throw new WorktreeError(
      'INVALID_BASE_REF',
      `baseRef 无法解析为 Commit：${baseRef}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}

async function gitCommonDirectory(
  workingDirectory: string,
  options: WorktreeManagerOptions,
): Promise<string> {
  const result = await runGit(
    ['-C', workingDirectory, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    options,
  );
  return fs.realpath(result.stdout.trim());
}

async function managedWorktreePath(
  runId: string,
  options: WorktreeManagerOptions,
  createBase: boolean,
): Promise<{ baseDir: string; worktreePath: string }> {
  validateRunId(runId);
  const baseDir = await resolveBaseDir(options, createBase);
  return { baseDir, worktreePath: path.join(baseDir, runId) };
}

/** 创建 detached Worktree；不创建分支，也不修改用户原始工作目录。 */
export async function createWorktree(
  input: CreateWorktreeInput,
  options: WorktreeManagerOptions = {},
): Promise<CreatedWorktree> {
  validateRunId(input.runId);
  const repositoryRoot = await resolveRepositoryRoot(input.repositoryPath, options);
  const configuredBaseDir = path.resolve(options.baseDir ?? DEFAULT_WORKTREE_BASE_DIR);
  // 必须在 mkdir 之前解析现有祖先的 realpath，错误配置不能在用户仓库内留下空目录。
  const prospectiveBaseDir = await prospectiveRealPath(configuredBaseDir);
  if (isWithin(prospectiveBaseDir, repositoryRoot)) {
    throw new WorktreeError(
      'INVALID_WORKTREE_ROOT',
      `Worktree 根目录不能位于目标仓库内部：${prospectiveBaseDir}`,
    );
  }
  const { baseDir, worktreePath } = await managedWorktreePath(input.runId, options, true);

  // 再检查一次 realpath，防止受管根目录通过符号链接实际落入仓库内部。
  if (isWithin(baseDir, repositoryRoot)) {
    throw new WorktreeError(
      'INVALID_WORKTREE_ROOT',
      `Worktree 根目录不能位于目标仓库内部：${baseDir}`,
    );
  }
  if (await pathExists(worktreePath)) {
    throw new WorktreeError('WORKTREE_EXISTS', `Run ${input.runId} 的 Worktree 已存在`);
  }

  const baseCommit = await resolveBaseCommit(repositoryRoot, input.baseRef, options);
  try {
    await runGit(
      ['-C', repositoryRoot, 'worktree', 'add', '--detach', worktreePath, baseCommit],
      options,
    );
    const inspection = await inspectWorktree(input, options);
    return { ...inspection, baseCommit };
  } catch (error) {
    // 创建过程可能在 Git 注册后失败；尽力清理注册信息与系统管理目录。
    await runGit(
      ['-C', repositoryRoot, 'worktree', 'remove', '--force', worktreePath],
      options,
    ).catch(() => undefined);
    await fs.rm(worktreePath, { recursive: true, force: true });
    throw error;
  }
}

/** 检查 Worktree 的归属、HEAD 与脏状态。 */
export async function inspectWorktree(
  input: WorktreeIdentity,
  options: WorktreeManagerOptions = {},
): Promise<WorktreeInspection> {
  const repositoryRoot = await resolveRepositoryRoot(input.repositoryPath, options);
  const { worktreePath } = await managedWorktreePath(input.runId, options, false);

  let realWorktree: string;
  try {
    const stat = await fs.lstat(worktreePath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('目标不是普通目录');
    }
    realWorktree = await fs.realpath(worktreePath);
  } catch (error) {
    throw new WorktreeError(
      'WORKTREE_NOT_FOUND',
      `Run ${input.runId} 的 Worktree 不存在或不可用（${error instanceof Error ? error.message : String(error)}）`,
    );
  }

  if (realWorktree !== worktreePath) {
    throw new WorktreeError(
      'WORKTREE_MISMATCH',
      `Worktree 真实路径与管理路径不一致：${input.runId}`,
    );
  }

  try {
    const [worktreeRootResult, repositoryCommonDir, worktreeCommonDir, head, status] =
      await Promise.all([
        runGit(['-C', realWorktree, 'rev-parse', '--show-toplevel'], options),
        gitCommonDirectory(repositoryRoot, options),
        gitCommonDirectory(realWorktree, options),
        runGit(['-C', realWorktree, 'rev-parse', 'HEAD'], options),
        runGit(['-C', realWorktree, 'status', '--porcelain', '--untracked-files=all'], options),
      ]);

    const reportedRoot = await fs.realpath(worktreeRootResult.stdout.trim());
    if (reportedRoot !== realWorktree || repositoryCommonDir !== worktreeCommonDir) {
      throw new WorktreeError(
        'WORKTREE_MISMATCH',
        `目录不属于指定仓库的受管 Worktree：${input.runId}`,
      );
    }

    return {
      runId: input.runId,
      repositoryRoot,
      worktreePath: realWorktree,
      headCommit: head.stdout.trim(),
      dirty: status.stdout.trim().length > 0,
    };
  } catch (error) {
    if (error instanceof WorktreeError && error.code === 'WORKTREE_MISMATCH') throw error;
    throw new WorktreeError(
      'WORKTREE_MISMATCH',
      `无法确认 Worktree 归属：${input.runId}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}

/** 删除 Worktree。默认拒绝删除带有未提交修改的工作区。 */
export async function removeWorktree(
  input: RemoveWorktreeInput,
  options: WorktreeManagerOptions = {},
): Promise<RemovedWorktree> {
  const inspection = await inspectWorktree(input, options);
  if (inspection.dirty && input.force !== true) {
    throw new WorktreeError(
      'WORKTREE_DIRTY',
      `Worktree ${input.runId} 存在未提交修改；请先保存 Patch，或显式 force 删除`,
    );
  }

  const args = ['-C', inspection.repositoryRoot, 'worktree', 'remove'];
  if (input.force === true) args.push('--force');
  args.push(inspection.worktreePath);
  await runGit(args, options);
  await runGit(['-C', inspection.repositoryRoot, 'worktree', 'prune'], options);

  return { runId: input.runId, worktreePath: inspection.worktreePath, removed: true };
}
