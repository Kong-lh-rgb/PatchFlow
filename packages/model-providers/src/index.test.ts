import { describe, expect, it } from 'vitest';
import { SUPPORTED_PROVIDER_NAMES, parseModelIdentifier } from './index.js';

describe('SUPPORTED_PROVIDER_NAMES', () => {
  it('只包含官方 SDK 支持的 Provider', () => {
    expect(SUPPORTED_PROVIDER_NAMES).toEqual(['anthropic', 'openai']);
  });
});

describe('parseModelIdentifier', () => {
  it('解析合法标识', () => {
    expect(parseModelIdentifier('anthropic/claude-opus-5')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5',
    });
    expect(parseModelIdentifier('openai/gpt-6')).toEqual({ provider: 'openai', model: 'gpt-6' });
  });

  it.each([
    ['缺少 provider', 'claude-opus-5'],
    ['未知 provider', 'azure/gpt-6'],
    ['缺少 model', 'anthropic/'],
    ['空字符串', ''],
    ['多余斜杠开头', '/model'],
  ])('拒绝非法标识（%s）', (_label, value) => {
    expect(parseModelIdentifier(value)).toBeNull();
  });
});
