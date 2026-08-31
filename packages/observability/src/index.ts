/**
 * @patchflow/observability
 *
 * PatchFlow 统一日志与观测入口。
 * 所有服务通过 createLogger 创建 Logger，保证级别由 LOG_LEVEL 统一控制、
 * 开发环境可读输出、生产环境 JSON 输出，并对凭据字段统一脱敏。
 * OpenTelemetry trace/metrics 在后续阶段按需接入，不提前引入。
 */
export { createLogger, DEFAULT_REDACT_PATHS, REDACT_CENSOR } from './logger.js';
export type { CreateLoggerOptions } from './logger.js';
