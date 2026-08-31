/**
 * @patchflow/tools
 *
 * 暴露给模型的受控工具集。职责：定义统一的工具接口、输入 Schema 与
 * 输出上限（条数、字符数、行数）；实现将在后续阶段接入 ripgrep、
 * 文件系统与沙箱执行。
 *
 * 安全原则：模型永远拿不到 exec(command: string)；
 * 命令一律以 { program, args[] } 形式交给 spawn 且命中 Allowlist。
 */

/** MVP 暴露给模型的全部工具名（见项目说明 8.2）。 */
export const CONTROLLED_TOOL_NAMES = [
  'list_files',
  'search_code',
  'read_file',
  'apply_patch',
  'run_tests',
  'run_typecheck',
  'git_diff',
] as const;
export type ControlledToolName = (typeof CONTROLLED_TOOL_NAMES)[number];

/** 工具输出的统一上限，超出部分外置为 Artifact，只返回摘要。 */
export const TOOL_OUTPUT_LIMITS = {
  maxSearchResults: 50,
  maxResultChars: 20_000,
  maxReadLines: 500,
} as const;

export interface ToolExecutionContext {
  readonly runId: string;
  /** 当前 Run 的 Git Worktree 根目录，工具不得越界访问。 */
  readonly worktreePath: string;
  /** 允许修改的相对路径前缀。 */
  readonly allowedWritePrefixes: readonly string[];
}

export interface ToolResult {
  readonly ok: boolean;
  /** 返回给模型的有界摘要。 */
  readonly summary: string;
  /** 超长内容外置 Artifact 后的引用。 */
  readonly artifactRef?: string;
}

/** 所有受控工具的统一接口；实现方负责路径规范化与越界检查。 */
export interface ControlledTool<TInput = Record<string, unknown>> {
  readonly name: ControlledToolName;
  readonly description: string;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult>;
}

/** 判断工具名是否在受控集合内。 */
export function isControlledToolName(name: string): name is ControlledToolName {
  return (CONTROLLED_TOOL_NAMES as readonly string[]).includes(name);
}
