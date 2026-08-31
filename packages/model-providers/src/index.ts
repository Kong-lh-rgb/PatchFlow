/**
 * @patchflow/model-providers
 *
 * 模型接入层。职责：把 Anthropic/OpenAI 官方 SDK 适配为统一的
 * ModelProvider 接口，供 agent-core 调用；记录 Token 用量供预算控制。
 * Foundation 阶段只定义契约，不引入任何 SDK，也不发起真实调用。
 *
 * 设计原则：不使用 LangChain/LangGraph，Tool Calling 循环由项目自己掌控。
 */

/** 支持的 Provider 名（provider/model 格式的前半部分）。 */
export const SUPPORTED_PROVIDER_NAMES = ['anthropic', 'openai'] as const;
export type SupportedProviderName = (typeof SUPPORTED_PROVIDER_NAMES)[number];

export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool_result';
  readonly content: string;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  /** Zod Schema（JSON Schema 形状），由 tools 包统一维护。 */
  readonly inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelCallRequest {
  /** 完整模型标识，例如 "anthropic/claude-opus-5"。 */
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly maxOutputTokens?: number;
}

export interface ModelCallResponse {
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  readonly usage: TokenUsage;
}

/** 所有 Provider 必须实现的统一接口；实现方负责超时与重试策略。 */
export interface ModelProvider {
  readonly name: SupportedProviderName;
  call(request: ModelCallRequest): Promise<ModelCallResponse>;
}

/** 解析 "provider/model" 标识；不合法时返回 null。 */
export function parseModelIdentifier(identifier: string): {
  provider: SupportedProviderName;
  model: string;
} | null {
  const separator = identifier.indexOf('/');
  if (separator <= 0 || separator === identifier.length - 1) {
    return null;
  }
  const provider = identifier.slice(0, separator);
  if (!(SUPPORTED_PROVIDER_NAMES as readonly string[]).includes(provider)) {
    return null;
  }
  return { provider: provider as SupportedProviderName, model: identifier.slice(separator + 1) };
}
