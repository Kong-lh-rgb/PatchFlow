import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createPathGuard, pathGuardFailure } from './path-guard.js';
import { TOOL_OUTPUT_LIMITS } from './types.js';
import type { ControlledTool, ToolExecutionContext, ToolResult } from './types.js';

/** 模型输入必须是严格形状：未知键直接拒绝。 */
export const SearchCodeInputSchema = z.strictObject({
  pattern: z.string().min(1),
  /** 相对仓库根的搜索目录。 */
  path: z.string().min(1).default('.'),
  /** false 时按字面量搜索（-F），适合查找含正则元字符的字符串。 */
  isRegex: z.boolean().default(true),
  caseSensitive: z.boolean().default(false),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(TOOL_OUTPUT_LIMITS.maxSearchResults)
    .default(TOOL_OUTPUT_LIMITS.maxSearchResults),
});
/** 调用方提供的输入形状（带默认值的字段可省略）。 */
export type SearchCodeInput = z.input<typeof SearchCodeInputSchema>;

/** rg 单次执行的最长等待时间，超时后终止并按截断处理。 */
const RG_TIMEOUT_MS = 10_000;

interface RgMatch {
  file: string;
  line: number;
  content: string;
}

interface RgRunResult {
  matches: RgMatch[];
  truncated: boolean;
  /** null 表示进程被我们终止（超时/达到上限）。 */
  exitCode: number | null;
  stderr: string;
  /** spawn 失败（例如未安装 rg）。 */
  spawnFailed: boolean;
  spawnErrorMessage?: string;
}

/**
 * 解析 rg 的 `file:line:content` 输出行。
 * 注意：文件名本身含冒号时无法区分，属于可接受的已知限制。
 */
function parseRgLine(line: string): RgMatch | null {
  const firstColon = line.indexOf(':');
  const secondColon = line.indexOf(':', firstColon + 1);
  if (firstColon === -1 || secondColon === -1) {
    return null;
  }
  const lineNumber = Number.parseInt(line.slice(firstColon + 1, secondColon), 10);
  if (!Number.isFinite(lineNumber)) {
    return null;
  }
  return {
    file: line.slice(0, firstColon),
    line: lineNumber,
    content: line.slice(secondColon + 1),
  };
}

/** 运行 ripgrep 并在达到结果/字符上限时提前终止，保证输出有界。 */
function runRg(
  args: string[],
  cwd: string,
  maxResults: number,
  maxChars: number,
): Promise<RgRunResult> {
  return new Promise((resolve) => {
    const child = spawn('rg', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const matches: RgMatch[] = [];
    const stderrChunks: Buffer[] = [];
    let buffer = '';
    let charCount = 0;
    let truncated = false;
    let settled = false;

    const timer = setTimeout(() => {
      truncated = true;
      child.kill('SIGTERM');
    }, RG_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (truncated) {
        return;
      }
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);
        const match = line.length > 0 ? parseRgLine(line) : null;
        if (match) {
          // 先判断再计入：确保输出总长度严格不超过字符上限。
          if (charCount + line.length > maxChars) {
            truncated = true;
            child.kill('SIGTERM');
            return;
          }
          matches.push(match);
          charCount += line.length;
        }
        if (matches.length >= maxResults) {
          truncated = true;
          child.kill('SIGTERM');
          return;
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (error: Error) => {
      clearTimeout(timer);
      settled = true;
      resolve({
        matches,
        truncated,
        exitCode: null,
        stderr: stderrChunks.join(''),
        spawnFailed: true,
        spawnErrorMessage: error.message,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      resolve({
        matches,
        truncated,
        exitCode: code,
        stderr: stderrChunks.join(''),
        spawnFailed: false,
      });
    });
  });
}

/** 使用 ripgrep 搜索代码：限制结果数量与总字符数，超长返回截断说明。 */
export async function searchCode(
  rawInput: unknown,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const parsed = SearchCodeInputSchema.safeParse(rawInput);
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
  let searchDir: string;
  try {
    searchDir = await guard.resolveReal(input.path);
  } catch (error) {
    return pathGuardFailure(error);
  }
  const stat = await fs.stat(searchDir).catch(() => null);
  if (stat === null) {
    return { ok: false, summary: `路径不存在：${input.path}` };
  }
  // 目录：以该目录为 cwd 递归搜索；文件：只搜索该文件。
  const rgCwd = stat.isDirectory() ? searchDir : path.dirname(searchDir);
  const rgPathArg = stat.isDirectory() ? [] : [path.basename(searchDir)];

  const args: string[] = ['-n', '--no-heading', '--no-messages', '--color', 'never'];
  if (!input.caseSensitive) {
    args.push('-i');
  }
  if (!input.isRegex) {
    args.push('-F');
  }
  // 即使目标仓库没有 .gitignore 也保证跳过依赖与构建产物。
  args.push('--glob', '!node_modules/**', '--glob', '!dist/**', '--glob', '!.git/**');
  // 搜索单个文件时 rg 会省略文件名前缀，强制带上有助于稳定解析。
  if (!stat.isDirectory()) {
    args.push('--with-filename');
  }
  // '--' 之后是字面量 pattern 与路径，防止以 '-' 开头被当作选项。
  args.push('--', input.pattern, ...rgPathArg);

  const run = await runRg(args, rgCwd, input.maxResults, TOOL_OUTPUT_LIMITS.maxResultChars);

  if (run.spawnFailed) {
    return {
      ok: false,
      summary: `无法运行 ripgrep（rg）：${run.spawnErrorMessage ?? '未知错误'}。请确认已安装 ripgrep`,
    };
  }
  // rg 退出码：0=有匹配，1=无匹配，2=发生错误。
  if (run.exitCode === 2) {
    return {
      ok: false,
      summary: `搜索失败：${run.stderr.trim().slice(0, 500) || 'rg 返回错误'}`,
    };
  }

  if (run.matches.length === 0) {
    if (run.truncated) {
      // 首条匹配就超过字符上限：仍属“有匹配但无法有界展示”。
      return {
        ok: true,
        summary: `匹配结果单行超过字符上限 ${TOOL_OUTPUT_LIMITS.maxResultChars}，已全部截断（请用更精确的 pattern 或限定 path）`,
      };
    }
    return {
      ok: true,
      summary: `在 ${input.path} 下未找到匹配：${JSON.stringify(input.pattern)}`,
    };
  }

  const formatted = run.matches.map((match) => `${match.file}:${match.line}: ${match.content}`);
  const parts = [
    `${input.path}（${run.matches.length} 个匹配${run.truncated ? '，结果超出上限已截断' : ''}）`,
    ...formatted,
  ];
  if (run.truncated) {
    parts.push(
      `（达到 maxResults=${input.maxResults} 或总字符上限 ${TOOL_OUTPUT_LIMITS.maxResultChars}，如需更多结果请缩小 path 范围或使用更精确的 pattern）`,
    );
  }
  return { ok: true, summary: parts.join('\n') };
}

export function createSearchCodeTool(): ControlledTool<SearchCodeInput> {
  return {
    name: 'search_code',
    description: '使用 ripgrep 搜索代码（限制结果数量与总字符数，超长截断）',
    async execute(input, context: ToolExecutionContext) {
      return searchCode(input, context);
    },
  };
}
