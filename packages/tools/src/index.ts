/**
 * @patchflow/tools
 *
 * 暴露给模型的受控工具集。
 *
 * 安全原则：
 * - 模型永远拿不到 exec(command: string)；命令一律以受控参数数组交给 spawn。
 * - 所有文件访问必须经过 PathGuard（词法越界 + 符号链接越界双重校验）。
 * - 输入 Schema 使用 strictObject：未知键直接拒绝，防止模型幻觉字段。
 * - 输出有界：结果条数、总字符数、读取行数全部受限，超长返回截断说明。
 *
 * 已实现：list_files / read_file / search_code（只读三件套）。
 * 待实现：apply_patch / run_tests / run_typecheck / git_diff。
 */
export { CONTROLLED_TOOL_NAMES, TOOL_OUTPUT_LIMITS, isControlledToolName } from './types.js';
export type {
  ControlledTool,
  ControlledToolName,
  ToolExecutionContext,
  ToolResult,
} from './types.js';

export { createPathGuard, PathGuardError, pathGuardFailure } from './path-guard.js';
export type { PathGuard, PathGuardErrorCode } from './path-guard.js';

export {
  LIST_FILES_IGNORED_DIRS,
  ListFilesInputSchema,
  createListFilesTool,
  listFiles,
} from './list-files.js';
export type { ListFilesInput } from './list-files.js';

export { ReadFileInputSchema, createReadFileTool, readFile } from './read-file.js';
export type { ReadFileInput } from './read-file.js';

export { SearchCodeInputSchema, createSearchCodeTool, searchCode } from './search-code.js';
export type { SearchCodeInput } from './search-code.js';
