import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolResult } from './types.js';

/** 路径防护错误码。 */
export type PathGuardErrorCode =
  /** 空路径、包含 NUL、绝对路径等非法输入 */
  | 'INVALID_PATH'
  /** 词法层面越界（../ 或等价形式） */
  | 'PATH_ESCAPE'
  /** 符号链接解析后指向仓库根之外 */
  | 'SYMLINK_ESCAPE';

export class PathGuardError extends Error {
  constructor(
    readonly code: PathGuardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PathGuardError';
  }
}

export interface PathGuard {
  /** 仓库根目录（规范化的绝对路径）。 */
  readonly root: string;
  /** 仓库根的真实路径（已解析符号链接）。 */
  readonly realRoot: string;
  /** 词法解析相对路径为仓库内绝对路径；非法或越界时抛 PathGuardError。 */
  resolve(relativePath: string): string;
  /** 在 resolve 基础上校验已存在路径段的符号链接不越界，返回真实路径。 */
  resolveReal(relativePath: string): Promise<string>;
  /** 把仓库内的真实路径转回相对显示路径。 */
  toRelative(realPath: string): string;
}

function isWithin(child: string, parent: string): boolean {
  if (child === parent) {
    return true;
  }
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(withSep);
}

/**
 * 找到目标路径最深的“已存在”祖先，返回其真实路径与剩余的未存在段。
 * 未存在的部分不可能是符号链接，因此只需校验已存在部分的 realpath。
 */
async function realpathOfNearestExisting(
  targetPath: string,
): Promise<{ realPath: string; remainder: string[] }> {
  const remainder: string[] = [];
  let current = targetPath;
  // 上限防止异常循环（根目录的 dirname 是自身）。
  for (let depth = 0; depth < 128; depth += 1) {
    try {
      const realPath = await fs.realpath(current);
      return { realPath, remainder };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new PathGuardError('SYMLINK_ESCAPE', `无法解析路径 ${targetPath} 的已存在祖先`);
      }
      remainder.unshift(path.basename(current));
      current = parent;
    }
  }
  throw new PathGuardError('SYMLINK_ESCAPE', `路径层级过深：${targetPath}`);
}

/**
 * 创建路径防护器：所有工具的文件访问都必须先经过它，
 * 保证模型提供的相对路径无法越过 Worktree 根目录。
 */
export async function createPathGuard(root: string): Promise<PathGuard> {
  const normalizedRoot = path.resolve(root);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(normalizedRoot);
  } catch {
    throw new PathGuardError('INVALID_PATH', `仓库根目录不存在：${normalizedRoot}`);
  }

  const guard: PathGuard = {
    root: normalizedRoot,
    realRoot,
    resolve(relativePath: string): string {
      if (relativePath.includes('\0')) {
        throw new PathGuardError('INVALID_PATH', '路径包含非法字符 NUL');
      }
      if (relativePath.trim().length === 0) {
        throw new PathGuardError('INVALID_PATH', '路径不能为空');
      }
      if (path.isAbsolute(relativePath)) {
        throw new PathGuardError('INVALID_PATH', `不允许绝对路径：${relativePath}`);
      }
      const resolved = path.resolve(normalizedRoot, relativePath);
      if (!isWithin(resolved, normalizedRoot)) {
        throw new PathGuardError('PATH_ESCAPE', `路径越界，禁止访问仓库外：${relativePath}`);
      }
      return resolved;
    },
    async resolveReal(relativePath: string): Promise<string> {
      const lexical = guard.resolve(relativePath);
      if (lexical === normalizedRoot) {
        return realRoot;
      }
      const { realPath, remainder } = await realpathOfNearestExisting(lexical);
      const realTarget = remainder.length > 0 ? path.join(realPath, ...remainder) : realPath;
      if (!isWithin(realTarget, realRoot)) {
        throw new PathGuardError('SYMLINK_ESCAPE', `符号链接指向仓库外，禁止访问：${relativePath}`);
      }
      return realTarget;
    },
    toRelative(realPath: string): string {
      const relative = path.relative(realRoot, realPath);
      return relative.length === 0 ? '.' : relative;
    },
  };

  return guard;
}

/** 把路径防护错误折叠为工具失败结果（各工具共用）。 */
export function pathGuardFailure(error: unknown): ToolResult {
  if (error instanceof PathGuardError) {
    return {
      ok: false,
      summary: `路径被拒绝（${error.code}）：${error.message}`,
    };
  }
  return {
    ok: false,
    summary: `路径解析失败：${error instanceof Error ? error.message : String(error)}`,
  };
}
