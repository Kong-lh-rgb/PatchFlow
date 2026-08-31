import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchApiHealth, resolveApiBaseUrl } from './api.js';

describe('resolveApiBaseUrl', () => {
  it('未配置时使用默认本机地址', () => {
    expect(resolveApiBaseUrl({})).toBe('http://localhost:3001');
    expect(resolveApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: '  ' })).toBe('http://localhost:3001');
  });

  it('配置后优先使用环境变量', () => {
    expect(resolveApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: 'http://api.example.com' })).toBe(
      'http://api.example.com',
    );
  });
});

describe('fetchApiHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status=ok 返回 up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
    );
    const result = await fetchApiHealth('http://api.test');
    expect(result.status).toBe('up');
    expect(result.httpStatus).toBe(200);
  });

  it('非 2xx 返回 down 并带状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 503 })),
    );
    const result = await fetchApiHealth('http://api.test');
    expect(result.status).toBe('down');
    expect(result.httpStatus).toBe(503);
    expect(result.message).toContain('503');
  });

  it('响应体缺少 status=ok 时视为 down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200 })),
    );
    const result = await fetchApiHealth('http://api.test');
    expect(result.status).toBe('down');
    expect(result.message).toContain('格式异常');
  });

  it('fetch 抛错（连接拒绝）返回 down 而不是抛出异常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );
    const result = await fetchApiHealth('http://api.test');
    expect(result.status).toBe('down');
    expect(result.message).toContain('无法连接 API');
    expect(result.baseUrl).toBe('http://api.test');
  });
});
