import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createListFilesTool, listFiles } from './list-files.js';
import type { ToolExecutionContext } from './types.js';

const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'patchflow-list-files-'));
const root = path.join(tmpBase, 'repo');
const context: ToolExecutionContext = {
  runId: 'run-test',
  worktreePath: root,
  allowedWritePrefixes: [],
};

beforeAll(async () => {
  // 结构：
  // repo/
  //   README.md
  //   src/a.ts, src/b.ts, src/nested/c.ts
  //   node_modules/pkg/index.js   （应被忽略）
  //   dist/out.js                 （应被忽略）
  //   .git/config                 （应被忽略）
  await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(path.join(root, 'README.md'), '# repo\n');
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(root, 'src', 'b.ts'), 'export const b = 2;\n');
  await fs.writeFile(path.join(root, 'src', 'nested', 'c.ts'), 'export const c = 3;\n');
  await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
  await fs.writeFile(path.join(root, 'dist', 'out.js'), 'built\n');
  await fs.writeFile(path.join(root, '.git', 'config'), '[core]\n');
});

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true });
});

describe('listFiles', () => {
  it('递归列出文件且输出有序', async () => {
    const result = await listFiles({ path: '.', maxResults: 100 }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('README.md');
    expect(result.summary).toContain(path.join('src', 'nested', 'c.ts'));
    const lines = result.summary.split('\n').slice(1);
    expect(lines).toEqual([...lines].sort((a, b) => a.localeCompare(b)));
  });

  it('忽略 .git、node_modules、dist', async () => {
    const result = await listFiles({ path: '.', maxResults: 100 }, context);
    expect(result.summary).not.toContain('node_modules');
    expect(result.summary).not.toContain('dist');
    expect(result.summary).not.toContain('.git');
    // 顶层 1 个文件 + src 下 3 个 = 4 个。
    expect(result.summary).toContain('4 个文件）');
  });

  it('限定起始目录', async () => {
    const result = await listFiles({ path: 'src/nested', maxResults: 100 }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('c.ts');
    expect(result.summary).not.toContain('a.ts');
  });

  it('maxResults 触发截断说明', async () => {
    const result = await listFiles({ path: '.', maxResults: 2 }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('2 个文件，达到 maxResults=2 上限');
  });

  it('路径不存在返回失败', async () => {
    const result = await listFiles({ path: 'nope', maxResults: 10 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('路径不存在');
  });

  it('目标是文件时返回失败', async () => {
    const result = await listFiles({ path: 'README.md', maxResults: 10 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('不是目录');
  });

  it('越界路径被路径防护拒绝', async () => {
    const result = await listFiles({ path: '..', maxResults: 10 }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('PATH_ESCAPE');
  });
});

describe('createListFilesTool', () => {
  const tool = createListFilesTool();

  it('名称与描述符合受控工具定义', () => {
    expect(tool.name).toBe('list_files');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('合法输入执行成功', async () => {
    const result = await tool.execute({ path: 'src' }, context);
    expect(result.ok).toBe(true);
  });

  it.each([
    ['maxResults 为 0', { maxResults: 0 }],
    ['maxResults 超上限', { maxResults: 2_000 }],
    ['maxResults 非整数', { maxResults: 1.5 }],
  ])('非法输入返回失败而不是抛错（%s）', async (_label, override) => {
    const result = await tool.execute({ path: '.', ...override }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('输入不合法');
  });

  it('完全无关的输入对象返回失败', async () => {
    const result = await tool.execute({ wrong: 'field' } as unknown as { path: string }, context);
    expect(result.ok).toBe(false);
  });
});
