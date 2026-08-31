/**
 * 服务端请求 API 的统一封装。
 *
 * 所有失败路径都返回结构化的 ApiHealthResult 而不是抛出异常，
 * 保证页面在 API 不可用时仍能渲染出明确的错误状态（不白屏）。
 */

export const DEFAULT_API_BASE_URL = 'http://localhost:3001';
const HEALTH_TIMEOUT_MS = 3_000;

export interface ApiHealthResult {
  /** up：API 存活；down：无法获得有效响应。 */
  status: 'up' | 'down';
  /** 请求地址，便于在错误信息中展示。 */
  baseUrl: string;
  message: string;
  httpStatus?: number;
}

/** 解析 API 基础地址：优先 NEXT_PUBLIC_API_BASE_URL，其次默认本机地址。 */
export function resolveApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env['NEXT_PUBLIC_API_BASE_URL']?.trim() || DEFAULT_API_BASE_URL;
}

/** 请求 GET /health 并把所有异常折叠为 down 状态。 */
export async function fetchApiHealth(
  baseUrl: string = resolveApiBaseUrl(),
  timeoutMs: number = HEALTH_TIMEOUT_MS,
): Promise<ApiHealthResult> {
  try {
    const response = await fetch(new URL('/health', baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        status: 'down',
        baseUrl,
        message: `API 健康检查返回 ${response.status}`,
        httpStatus: response.status,
      };
    }
    const body = (await response.json()) as { status?: string };
    if (body['status'] !== 'ok') {
      return {
        status: 'down',
        baseUrl,
        message: 'API 响应格式异常（缺少 status=ok）',
        httpStatus: response.status,
      };
    }
    return { status: 'up', baseUrl, message: 'API 存活', httpStatus: response.status };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? `请求超时（${timeoutMs}ms）`
          : error.message
        : String(error);
    return { status: 'down', baseUrl, message: `无法连接 API：${reason}` };
  }
}
