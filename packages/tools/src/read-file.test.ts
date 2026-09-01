import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReadFileTool, readFile } from './read-file.js';
import type { ToolExecutionContext } from './types.js';

const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'patchflow-read-file-'));
const root = path.join(tmpBase, 'repo');
const context: ToolExecutionContext = {
  runId: 'run-test',
  worktreePath: root,
  allowedWritePrefixes: [],
};

const lines = Array.from({ length: 30 }, (_, index) => `line-${index + 1}`);

beforeAll(async () => {
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'main.ts'), `${lines.join('\n')}\n`);
  await fs.writeFile(path.join(root, 'empty.txt'), '');
  await fs.writeFile(path.join(root, 'crlf.txt'), 'a\r\nb\r\nc\r\n');
  // 含 NUL 字节的二进制文件。
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  await fs.writeFile(path.join(root, 'image.png'), binary);
  // 二进制扩展名但纯文本内容：不应被扩展名误导，内容无 NUL 即可读。
  await fs.writeFile(path.join(root, 'looks-binary.bin'), 'plain text content\n');
});

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true });
});

describe('readFile', () => {
  it('默认从第 1 行读取到 maxLines 上限', async () => {
    const result = await readFile({ path: 'src/main.ts', startLine: 1, maxLines: 5 }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('src/main.ts:1-5（共 30 行）');
    expect(result.summary).toContain('1| line-1');
    expect(result.summary).toContain('5| line-5');
    expect(result.summary).not.toContain('6| line-6');
    expect(result.summary).toContain('后面还有 25 行未显示');
  });

  it('按 startLine/endLine 读取区间', async () => {
    const result = await readFile(
      { path: 'src/main.ts', startLine: 10, endLine: 12, maxLines: 500 },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('10| line-10');
    expect(result.summary).toContain('12| line-12');
    expect(result.summary).not.toContain('13| line-13');
  });

  it('endLine 超出文件末尾时截断到实际行数', async () => {
    const result = await readFile(
      { path: 'src/main.ts', startLine: 28, endLine: 999, maxLines: 500 },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('src/main.ts:28-30（共 30 行）');
    expect(result.summary).not.toContain('后面还有');
  });

  it('读取整个文件时无剩余提示', async () => {
    const result = await readFile({ path: 'crlf.txt', startLine: 1, maxLines: 10 }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('crlf.txt:1-3（共 3 行）');
    expect(result.summary).toContain('1| a');
    expect(result.summary).toContain('3| c');
  });

  it('maxLines 上限约束 endLine 请求', async () => {
    const result = await readFile(
      { path: 'src/main.ts', startLine: 1, endLine: 500, maxLines: 3 },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('src/main.ts:1-3（共 30 行）');
  });

  it('startLine 超过总行数返回失败', async () => {
    const result = await readFile({ path: 'src/main.ts', startLine: 31 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('超出文件总行数');
  });

  it('空文件返回 0 行', async () => {
    const result = await readFile({ path: 'empty.txt', startLine: 1 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('超出文件总行数 0');
  });

  it('拒绝二进制文件（内容含 NUL 字节）', async () => {
    const result = await readFile({ path: 'image.png', startLine: 1 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('二进制');
  });

  it('内容无 NUL 时即使扩展名像二进制也可读取', async () => {
    const result = await readFile({ path: 'looks-binary.bin', startLine: 1 }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('plain text content');
  });

  it('文件不存在返回失败', async () => {
    const result = await readFile({ path: 'nope.ts', startLine: 1 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('文件不存在');
  });

  it('目标是目录返回失败', async () => {
    const result = await readFile({ path: 'src', startLine: 1 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('不是文件');
  });

  it('越界路径被拒绝', async () => {
    const result = await readFile({ path: '../../etc/passwd', startLine: 1 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('PATH_ESCAPE');
  });
});

describe('createReadFileTool', () => {
  const tool = createReadFileTool();

  it('名称符合受控工具定义', () => {
    expect(tool.name).toBe('read_file');
  });

  it.each([
    ['endLine 小于 startLine', { path: 'a.ts', startLine: 10, endLine: 5 }],
    ['startLine 为 0', { path: 'a.ts', startLine: 0 }],
    ['maxLines 超过 500 上限', { path: 'a.ts', startLine: 1, maxLines: 501 }],
    ['未知键', { path: 'a.ts', startLine: 1, evil: true }],
    ['缺少 path', { startLine: 1 }],
  ])('非法输入返回失败而不是抛错（%s）', async (_label, input) => {
    const result = await tool.execute(
      input as unknown as { path: string; startLine: number },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('输入不合法');
  });
});
