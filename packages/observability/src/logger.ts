import pino, { type DestinationStream, type Level, type Logger } from 'pino';

export const DEFAULT_REDACT_PATHS = [
  // 通用凭据字段（支持嵌套一层通配）
  'password',
  '*.password',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'secret',
  '*.secret',
  // 常见携带凭据的位置
  'req.headers.authorization',
  'headers.authorization',
  'databaseUrl',
  '*.databaseUrl',
  'connectionString',
  '*.connectionString',
] as const;

export const REDACT_CENSOR = '[redacted]';

const VALID_LEVELS: readonly string[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  // pino 特殊级别：完全静默，测试中抑制日志输出时使用。
  'silent',
];

export interface CreateLoggerOptions {
  /** 服务名，写入每条日志的 service 字段。 */
  name?: string;
  /** 日志级别；缺省读取 LOG_LEVEL 环境变量，仍未设置则为 info。 */
  level?: string;
  /**
   * 是否输出人类可读格式（pino-pretty）。
   * 缺省规则：production 输出 JSON，其余环境输出可读日志。
   */
  pretty?: boolean;
  /** 自定义输出目标（测试注入用）。传入时 pretty 自动关闭。 */
  destination?: DestinationStream;
  /** 额外的固定上下文字段。 */
  base?: Record<string, unknown>;
}

function resolveLevel(level: string | undefined): Level {
  const value = level ?? process.env['LOG_LEVEL'] ?? 'info';
  if (!VALID_LEVELS.includes(value)) {
    throw new Error(
      `非法日志级别 "${value}"，合法值：${VALID_LEVELS.join(', ')}（通过 LOG_LEVEL 或 level 选项配置）`,
    );
  }
  return value as Level;
}

/**
 * 统一 Logger 工厂。
 *
 * - 开发环境默认输出可读日志（pino-pretty），生产环境输出 JSON。
 * - 级别通过 LOG_LEVEL 环境变量或 level 选项配置，非法值直接抛错。
 * - 内置脱敏规则：API Key、密码、Token、连接串等字段输出为 [redacted]。
 *   注意：脱敏按字段名匹配，调用方仍应避免把完整模型输入放进日志。
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = resolveLevel(options.level);
  // 注入自定义输出目标时强制 JSON 输出（transport 与 destination 不能同时使用）。
  const pretty =
    options.destination === undefined &&
    (options.pretty ?? process.env['NODE_ENV'] !== 'production');

  return pino(
    {
      level,
      base: { service: options.name ?? 'patchflow', ...(options.base ?? {}) },
      redact: { paths: [...DEFAULT_REDACT_PATHS], censor: REDACT_CENSOR },
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
    options.destination,
  );
}
