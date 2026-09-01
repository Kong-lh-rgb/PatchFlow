/**
 * @patchflow/sandbox
 *
 * 隔离执行层。职责：为每个 Run 创建独立 Git Worktree、在受限 Docker
 * 容器中执行命令、实施资源与命令 Allowlist 策略。
 * 已实现受管 Git Worktree 生命周期；Docker 容器执行后续阶段实现。
 */

/** 沙箱默认限制（见项目说明 9；默认拒绝网络与非 root）。 */
export interface SandboxLimits {
  /** 容器内用户必须非 root。 */
  readonly nonRoot: boolean;
  /** 默认 'none'；开启网络必须经过审批。 */
  readonly networkMode: 'none' | 'restricted';
  /** 根文件系统只读，仅 Worktree 与 /tmp 可写。 */
  readonly readOnlyRootFs: boolean;
  /** /tmp 使用限额 tmpfs（MB）。 */
  readonly tmpfsSizeMb: number;
  readonly maxCpus: number;
  readonly memoryMb: number;
  readonly maxPids: number;
  /** 单条命令最长执行时间（秒）。 */
  readonly commandTimeoutSeconds: number;
  /** 禁止挂载的宿主机路径。 */
  readonly forbiddenMounts: readonly string[];
}

const homeDir = process.env['HOME'] ?? '/home';

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  nonRoot: true,
  networkMode: 'none',
  readOnlyRootFs: true,
  tmpfsSizeMb: 256,
  maxCpus: 2,
  memoryMb: 2048,
  maxPids: 256,
  commandTimeoutSeconds: 300,
  forbiddenMounts: [
    '/var/run/docker.sock',
    homeDir,
    `${homeDir}/.ssh`,
    `${homeDir}/.aws`,
    `${homeDir}/.config/gcloud`,
  ],
};

/** 命令策略：只允许命中 Allowlist 的 program，不允许任意 Shell 字符串。 */
export interface CommandPolicy {
  readonly allowedPrograms: readonly string[];
  readonly allowNetwork: boolean;
}

export const DEFAULT_COMMAND_POLICY: CommandPolicy = {
  allowedPrograms: ['node', 'npm', 'pnpm', 'git', 'rg', 'python3', 'pytest', 'tsc'],
  allowNetwork: false,
};

/** 校验待执行命令是否符合策略；返回 null 表示拒绝。 */
export function checkCommandPolicy(
  program: string,
  policy: CommandPolicy = DEFAULT_COMMAND_POLICY,
): boolean {
  return policy.allowedPrograms.includes(program);
}

export {
  createWorktree,
  inspectWorktree,
  removeWorktree,
  DEFAULT_WORKTREE_BASE_DIR,
  WorktreeError,
} from './worktree.js';
export type {
  CreatedWorktree,
  CreateWorktreeInput,
  RemovedWorktree,
  RemoveWorktreeInput,
  WorktreeErrorCode,
  WorktreeIdentity,
  WorktreeInspection,
  WorktreeManagerOptions,
} from './worktree.js';
