import { describe, expect, it } from 'vitest';
import {
  CONTROLLED_TOOL_NAMES,
  createListFilesTool,
  createReadFileTool,
  createSearchCodeTool,
  isControlledToolName,
  TOOL_OUTPUT_LIMITS,
} from './index.js';

describe('CONTROLLED_TOOL_NAMES', () => {
  it('恰好包含 7 个受控工具', () => {
    expect(CONTROLLED_TOOL_NAMES).toHaveLength(7);
  });

  it('不包含任意 Shell 执行类工具', () => {
    expect(CONTROLLED_TOOL_NAMES).not.toContain('exec');
    expect(CONTROLLED_TOOL_NAMES).not.toContain('run_command');
    expect(CONTROLLED_TOOL_NAMES).not.toContain('shell');
  });
});

describe('isControlledToolName', () => {
  it('受控工具返回 true', () => {
    expect(isControlledToolName('read_file')).toBe(true);
    expect(isControlledToolName('git_diff')).toBe(true);
  });

  it('未登记工具返回 false', () => {
    expect(isControlledToolName('curl')).toBe(false);
    expect(isControlledToolName('rm')).toBe(false);
  });
});

describe('TOOL_OUTPUT_LIMITS', () => {
  it('配置了有界输出上限', () => {
    expect(TOOL_OUTPUT_LIMITS.maxSearchResults).toBeGreaterThan(0);
    expect(TOOL_OUTPUT_LIMITS.maxResultChars).toBeGreaterThan(0);
    expect(TOOL_OUTPUT_LIMITS.maxReadLines).toBeGreaterThan(0);
  });
});

describe('已实现的工具工厂', () => {
  it('三个只读工具都是受控工具', () => {
    for (const tool of [createListFilesTool(), createReadFileTool(), createSearchCodeTool()]) {
      expect(isControlledToolName(tool.name)).toBe(true);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.execute).toBe('function');
    }
  });
});
