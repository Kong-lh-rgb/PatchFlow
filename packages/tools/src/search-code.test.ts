import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSearchCodeTool, searchCode } from './search-code.js';
import type { ToolExecutionContext } from './types.js';

const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'patchflow-search-code-'));
const root = path.join(tmpBase, 'repo');
const context: ToolExecutionContext = {
  runId: 'run-test',
  worktreePath: root,
  allowedWritePrefixes: [],
};

beforeAll(async () => {
  await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'alpha.ts'),
    'export const hello = 1;\nconst HELLO_AGAIN = 2;\nconst unrelated = 3;\n',
  );
  await fs.writeFile(path.join(root, 'src', 'nested', 'beta.ts'), 'function helloNested() {}\n');
  await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'hello in deps\n');
  await fs.writeFile(path.join(root, 'dist', 'bundle.js'), 'hello in dist\n');
  await fs.writeFile(path.join(root, 'src', 'dots.ts'), 'axb\nfoo a.b bar\n');
});

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true });
});

describe('searchCode', () => {
  it('默认大小写不敏感地递归搜索', async () => {
    const result = await searchCode({ pattern: 'hello' }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain(path.join('src', 'alpha.ts:1'));
    expect(result.summary).toContain(path.join('src', 'alpha.ts:2'));
    expect(result.summary).toContain(path.join('src', 'nested', 'beta.ts:1'));
  });

  it('caseSensitive 时只匹配精确大小写', async () => {
    const result = await searchCode({ pattern: 'HELLO', caseSensitive: true }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('HELLO_AGAIN');
    expect(result.summary).not.toContain(path.join('src', 'nested', 'beta.ts'));
  });

  it('默认按正则搜索（. 匹配任意字符）', async () => {
    const result = await searchCode({ pattern: 'a.b', path: 'src/dots.ts' }, context);
    expect(result.ok).toBe(true);
    // 正则模式下 . 匹配任意字符：axb 与字面量 a.b 都命中。
    expect(result.summary).toContain('axb');
    expect(result.summary).toContain('a.b bar');
    expect(result.summary).toContain('2 个匹配');
  });

  it('isRegex=false 时按字面量搜索（. 不匹配任意字符）', async () => {
    const result = await searchCode(
      { pattern: 'a.b', path: 'src/dots.ts', isRegex: false },
      context,
    );
    expect(result.ok).toBe(true);
    // 字面量模式下 axb 不再命中，只有字面量 a.b 命中。
    expect(result.summary).not.toContain('axb');
    expect(result.summary).toContain('a.b bar');
    expect(result.summary).toContain('1 个匹配');
  });

  it('限定 path 只搜索该目录', async () => {
    const result = await searchCode({ pattern: 'hello', path: 'src/nested' }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('beta.ts:1');
    expect(result.summary).not.toContain('alpha.ts');
  });

  it('忽略 node_modules 与 dist', async () => {
    const result = await searchCode({ pattern: 'hello' }, context);
    expect(result.summary).not.toContain('node_modules');
    expect(result.summary).not.toContain('dist');
    expect(result.summary).not.toContain('bundle.js');
  });

  it('无匹配时返回成功与明确说明', async () => {
    const result = await searchCode({ pattern: 'zzzz-not-exists' }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('未找到匹配');
  });

  it('maxResults 触发截断说明', async () => {
    const result = await searchCode({ pattern: 'hello', maxResults: 1 }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('1 个匹配，结果超出上限已截断');
    expect(result.summary).toContain('maxResults=1');
  });

  it('超长结果触发字符上限截断', async () => {
    const longLine = 'x'.repeat(30_000) + 'NEEDLE';
    await fs.writeFile(path.join(root, 'src', 'huge.ts'), `${longLine}\n`);
    const result = await searchCode({ pattern: 'NEEDLE' }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('截断');
    // 截断后总长度必须有界（远小于原始行长度）。
    expect(result.summary.length).toBeLessThan(25_000);
  });

  it('以 - 开头的 pattern 被当作字面量而不是选项', async () => {
    await fs.writeFile(path.join(root, 'src', 'dash.ts'), 'contains --verbose flag\n');
    const result = await searchCode({ pattern: '--verbose', isRegex: false }, context);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('dash.ts:1');
  });

  it('路径不存在返回失败', async () => {
    const result = await searchCode({ pattern: 'x', path: 'nope' }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('路径不存在');
  });

  it('越界路径被拒绝', async () => {
    const result = await searchCode({ pattern: 'x', path: '../outside' }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('PATH_ESCAPE');
  });
});

describe('createSearchCodeTool', () => {
  const tool = createSearchCodeTool();

  it('名称符合受控工具定义', () => {
    expect(tool.name).toBe('search_code');
  });

  it.each([
    ['空 pattern', { pattern: '' }],
    ['未知键', { pattern: 'x', evil: 1 }],
    ['maxResults 超上限', { pattern: 'x', maxResults: 100 }],
    ['缺少 pattern', {}],
  ])('非法输入返回失败而不是抛错（%s）', async (_label, input) => {
    const result = await tool.execute(input as unknown as { pattern: string }, context);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('输入不合法');
  });
});
