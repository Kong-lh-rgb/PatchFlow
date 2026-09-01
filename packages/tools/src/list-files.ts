import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createPathGuard, pathGuardFailure } from './path-guard.js';
import type { ControlledTool, ToolExecutionContext, ToolResult } from './types.js';

/** 递归遍历时跳过的目录名。 */
export const LIST_FILES_IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist']);

/** 模型输入必须是严格形状：未知键直接拒绝，防止模型幻觉字段。 */
export const ListFilesInputSchema = z.strictObject({
  /** 相对仓库根的起始目录。 */
  path: z.string().min(1).default('.'),
  /** 返回条数上限，防止超大仓库撑爆上下文。 */
  maxResults: z.number().int().positive().max(1_000).default(100),
});
/** 调用方提供的输入形状（带默认值的字段可省略）。 */
export type ListFilesInput = z.input<typeof ListFilesInputSchema>;

async function collectFiles(currentDir: string, budget: number, files: string[]): Promise<void> {
  if (budget <= 0 || files.length >= budget) {
    return;
  }
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  // 排序保证输出确定（便于测试断言与结果缓存）。
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (files.length >= budget) {
      return;
    }
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (LIST_FILES_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await collectFiles(entryPath, budget, files);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
}

/** 列出目录下的文件（递归），忽略 .git/node_modules/dist，限制返回数量。 */
export async function listFiles(
  rawInput: unknown,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const parsed = ListFilesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      summary: `输入不合法：${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    };
  }
  const input = parsed.data;
  const guard = await createPathGuard(context.worktreePath);
  let target: string;
  try {
    target = await guard.resolveReal(input.path);
  } catch (error) {
    return pathGuardFailure(error);
  }

  const stat = await fs.stat(target).catch(() => null);
  if (stat === null) {
    return { ok: false, summary: `路径不存在：${input.path}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, summary: `不是目录：${input.path}` };
  }

  const files: string[] = [];
  try {
    await collectFiles(target, input.maxResults, files);
  } catch (error) {
    return {
      ok: false,
      summary: `遍历目录失败：${input.path}（${error instanceof Error ? error.message : String(error)}）`,
    };
  }

  if (files.length === 0) {
    return { ok: true, summary: `${input.path} 下没有文件` };
  }

  const relativeFiles = files.map((file) => guard.toRelative(file));
  const reachedLimit = files.length >= input.maxResults;
  const header = reachedLimit
    ? `${input.path}（${relativeFiles.length} 个文件，达到 maxResults=${input.maxResults} 上限，可能已截断）`
    : `${input.path}（${relativeFiles.length} 个文件）`;
  return { ok: true, summary: [header, ...relativeFiles].join('\n') };
}

export function createListFilesTool(): ControlledTool<ListFilesInput> {
  // ControlledTool 的入参类型是 z.input：默认值由 Schema 在执行时补齐。
  return {
    name: 'list_files',
    description: '递归列出目录下的文件（忽略 .git/node_modules/dist），限制返回数量',
    async execute(input, context: ToolExecutionContext) {
      return listFiles(input, context);
    },
  };
}
