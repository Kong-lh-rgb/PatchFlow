import fs from 'node:fs/promises';
import { z } from 'zod';
import { createPathGuard, pathGuardFailure } from './path-guard.js';
import { TOOL_OUTPUT_LIMITS } from './types.js';
import type { ControlledTool, ToolExecutionContext, ToolResult } from './types.js';

/** 单次读取的文件大小上限；超过则要求模型缩小行范围或走 Artifact。 */
const MAX_READ_BYTES = 2 * 1024 * 1024;
/** 二进制探测读取的字节数（与 git 的启发式一致：含 NUL 即视为二进制）。 */
const BINARY_SNIFF_BYTES = 8_192;

/** 模型输入必须是严格形状：未知键直接拒绝。 */
export const ReadFileInputSchema = z
  .strictObject({
    path: z.string().min(1),
    /** 起始行，从 1 开始。 */
    startLine: z.number().int().positive().default(1),
    /** 结束行（含）；缺省时读取 maxLines 行。 */
    endLine: z.number().int().positive().optional(),
    /** 单次读取行数上限。 */
    maxLines: z
      .number()
      .int()
      .positive()
      .max(TOOL_OUTPUT_LIMITS.maxReadLines)
      .default(TOOL_OUTPUT_LIMITS.maxReadLines),
  })
  .refine((data) => data.endLine === undefined || data.endLine >= data.startLine, {
    message: 'endLine 必须大于等于 startLine',
  });
/** 调用方提供的输入形状（带默认值的字段可省略）。 */
export type ReadFileInput = z.input<typeof ReadFileInputSchema>;

async function isBinaryFile(realPath: string): Promise<boolean> {
  const handle = await fs.open(realPath, 'r');
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, BINARY_SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

/** 按起止行读取文本文件，拒绝二进制文件并限制最大行数。 */
export async function readFile(
  rawInput: unknown,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const parsed = ReadFileInputSchema.safeParse(rawInput);
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
  let realPath: string;
  try {
    realPath = await guard.resolveReal(input.path);
  } catch (error) {
    return pathGuardFailure(error);
  }

  const stat = await fs.stat(realPath).catch(() => null);
  if (stat === null) {
    return { ok: false, summary: `文件不存在：${input.path}` };
  }
  if (!stat.isFile()) {
    return { ok: false, summary: `不是文件：${input.path}` };
  }
  if (stat.size > MAX_READ_BYTES) {
    return {
      ok: false,
      summary: `文件过大（${stat.size} 字节，上限 ${MAX_READ_BYTES}），请用 startLine/endLine 分段读取`,
    };
  }
  if (await isBinaryFile(realPath)) {
    return { ok: false, summary: `拒绝读取二进制文件：${input.path}` };
  }

  const content = await fs.readFile(realPath, 'utf8');
  const allLines = content.split(/\r?\n/);
  // 结尾换行会产生一个空行，展示总数时去掉。
  const totalLines =
    allLines.length > 0 && allLines[allLines.length - 1] === ''
      ? allLines.length - 1
      : allLines.length;

  if (input.startLine > totalLines) {
    return {
      ok: false,
      summary: `起始行 ${input.startLine} 超出文件总行数 ${totalLines}：${input.path}`,
    };
  }

  const requestedEnd = input.endLine ?? input.startLine + input.maxLines - 1;
  const effectiveEnd = Math.min(requestedEnd, input.startLine + input.maxLines - 1, totalLines);

  const numbered = allLines
    .slice(input.startLine - 1, effectiveEnd)
    .map((line, index) => `${input.startLine + index}| ${line}`);

  const parts = [
    `${input.path}:${input.startLine}-${effectiveEnd}（共 ${totalLines} 行）`,
    ...numbered,
  ];
  // 只有确实还有未读内容时才提示继续读取方式（请求超出 EOF 不算）。
  if (effectiveEnd < totalLines) {
    parts.push(
      `（后面还有 ${totalLines - effectiveEnd} 行未显示，可用 startLine=${effectiveEnd + 1} 继续读取）`,
    );
  }
  return { ok: true, summary: parts.join('\n') };
}

export function createReadFileTool(): ControlledTool<ReadFileInput> {
  return {
    name: 'read_file',
    description: '按起止行读取文本文件；拒绝二进制文件，单次最多 500 行',
    async execute(input, context: ToolExecutionContext) {
      return readFile(input, context);
    },
  };
}
