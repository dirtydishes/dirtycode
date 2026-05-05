import path from "node:path";

import {
  type ProjectId,
  type RemoteEnvironment,
  type RemoteProjectBinding,
  type ServerBootstrapSshExecutionTarget,
  ServerBootstrapSshRepoBindingError,
  type ServerBootstrapSshRepoBindingErrorCode,
  type ServerBootstrapSshRepoBindingInput,
  type ServerBootstrapSshRepoBindingResult,
  type ServerSettings,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runProcess } from "../../processRunner";
import { ServerSettingsService } from "../../serverSettings";
import { classifySshHost } from "../hostClassification";
import { type SshRepoBootstrapShape, SshRepoBootstrap } from "../Services/SshRepoBootstrap.ts";

const DEFAULT_REMOTE_BASE_DIR = "/srv";
const SSH_CONNECT_TIMEOUT_SECONDS = 8;
const SSH_SCRIPT_TIMEOUT_MS = 12_000;
const SSH_MAX_OUTPUT_BYTES = 512 * 1024;

const PRE_FLIGHT_SCRIPT = `
set -eu
if ! command -v git >/dev/null 2>&1; then
  echo "__T3_MISSING_GIT__" >&2
  exit 42
fi
printf "__T3_PRECHECK_OK__\\n"
`;

export interface SshScriptExecutionResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface SshRepoBootstrapCoreDeps {
  readonly getSnapshot: () => Promise<{
    readonly projects: ReadonlyArray<{
      readonly id: ProjectId;
      readonly title: string;
      readonly workspaceRoot: string;
      readonly deletedAt: string | null;
    }>;
  }>;
  readonly getSettings: () => Promise<ServerSettings>;
  readonly updateSettings: (patch: {
    remoteProjectBindings: RemoteProjectBinding[];
  }) => Promise<void>;
  readonly isInsideWorkTree: (cwd: string) => Promise<boolean>;
  readonly readConfigValue: (cwd: string, key: string) => Promise<string | null>;
  readonly readLocalDefaultBranch: (cwd: string) => Promise<string>;
  readonly runSshScript: (
    environment: RemoteEnvironment,
    script: string,
    timeoutMs?: number,
  ) => Promise<SshScriptExecutionResult>;
  readonly now: () => string;
}

function ensureDetail(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "SSH bootstrap failed.";
}

function bootstrapError(
  code: ServerBootstrapSshRepoBindingErrorCode,
  detail: string,
  cause?: unknown,
): ServerBootstrapSshRepoBindingError {
  return new ServerBootstrapSshRepoBindingError({
    code,
    detail: ensureDetail(detail),
    ...(cause !== undefined ? { cause } : {}),
  });
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeProjectSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : "project";
}

function buildDerivedRepoPath(environment: RemoteEnvironment, projectTitle: string): string {
  const baseDir = environment.defaultBaseDir?.trim() || DEFAULT_REMOTE_BASE_DIR;
  const normalizedBaseDir = baseDir.startsWith("/") ? baseDir : `/${baseDir}`;
  return path.posix.join(normalizedBaseDir, normalizeProjectSlug(projectTitle));
}

function parseLineValue(output: string, key: string): string | null {
  const pattern = new RegExp(`^${key}=([^\\n]*)$`, "m");
  const match = pattern.exec(output);
  if (!match) {
    return null;
  }
  return match[1] ?? "";
}

function normalizeSshFailureOutput(result: SshScriptExecutionResult): string {
  const combined = `${result.stderr}\n${result.stdout}`.trim();
  return combined.length > 0
    ? combined
    : result.timedOut
      ? "SSH command timed out."
      : "SSH command failed.";
}

function isDnsResolutionFailure(detail: string): boolean {
  return /(could not resolve hostname|name or service not known|nodename nor servname provided)/i.test(
    detail,
  );
}

function isUnreachableFailure(detail: string): boolean {
  return /(connection timed out|operation timed out|no route to host|connection refused|network is unreachable)/i.test(
    detail,
  );
}

function isAclOrPermissionFailure(detail: string): boolean {
  return /(permission denied|access denied|tailnet policy|not allowed|authentication failed)/i.test(
    detail,
  );
}

export function mapTailnetPreflightFailure(result: SshScriptExecutionResult): {
  readonly code:
    | "ssh_tailnet_dns_unresolved"
    | "ssh_tailnet_unreachable"
    | "ssh_tailnet_acl_denied";
  readonly detail: string;
} {
  const failure = normalizeSshFailureOutput(result);
  const remediation =
    "Check that local Tailscale is connected, the target host is on the same tailnet, and tailnet ACLs allow SSH from this device/user.";

  if (isDnsResolutionFailure(failure)) {
    return {
      code: "ssh_tailnet_dns_unresolved",
      detail: `Tailnet DNS lookup failed. ${remediation} Raw error: ${failure}`,
    };
  }

  if (isAclOrPermissionFailure(failure)) {
    return {
      code: "ssh_tailnet_acl_denied",
      detail: `Tailnet SSH access was denied. ${remediation} Raw error: ${failure}`,
    };
  }

  return {
    code: "ssh_tailnet_unreachable",
    detail: isUnreachableFailure(failure)
      ? `Tailnet host is unreachable. ${remediation} Raw error: ${failure}`
      : `Could not reach the tailnet host. ${remediation} Raw error: ${failure}`,
  };
}

function buildSshArgs(environment: RemoteEnvironment): string[] {
  const args = [
    "-p",
    String(environment.port),
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];

  if (environment.authMode === "keyFile" && environment.keyFilePath) {
    args.push("-i", environment.keyFilePath);
  }

  args.push(`${environment.username}@${environment.host}`, "sh", "-s", "--");
  return args;
}

async function verifyRemoteRepo(
  deps: SshRepoBootstrapCoreDeps,
  environment: RemoteEnvironment,
  remoteRepoPath: string,
): Promise<{ originUrl: string; defaultBranch: string }> {
  const verifyScript = `
set -eu
repo_path=${quoteShell(remoteRepoPath)}
if ! git -C "$repo_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "__T3_NOT_REPO__" >&2
  exit 41
fi
origin_url=$(git -C "$repo_path" config --get remote.origin.url || true)
default_ref=$(git -C "$repo_path" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
default_branch=${"${default_ref#refs/remotes/origin/}"}
if [ -z "$default_branch" ]; then
  default_branch=$(git -C "$repo_path" branch --show-current 2>/dev/null || true)
fi
printf '__T3_ORIGIN__=%s\\n' "$origin_url"
printf '__T3_DEFAULT_BRANCH__=%s\\n' "$default_branch"
`;

  const verifyResult = await deps.runSshScript(environment, verifyScript);
  if ((verifyResult.code ?? 1) !== 0) {
    if (verifyResult.code === 41 || /__T3_NOT_REPO__/.test(verifyResult.stderr)) {
      throw bootstrapError(
        "remote_path_not_repo",
        "Remote path exists but is not a git repository.",
      );
    }
    throw bootstrapError("ssh_connect_failed", normalizeSshFailureOutput(verifyResult));
  }

  const originUrl = parseLineValue(verifyResult.stdout, "__T3_ORIGIN__")?.trim() ?? "";
  const defaultBranch = parseLineValue(verifyResult.stdout, "__T3_DEFAULT_BRANCH__")?.trim() ?? "";

  return { originUrl, defaultBranch };
}

export async function bootstrapSshRepoBindingWithDeps(
  input: ServerBootstrapSshRepoBindingInput,
  deps: SshRepoBootstrapCoreDeps,
): Promise<ServerBootstrapSshRepoBindingResult> {
  const snapshot = await deps.getSnapshot();
  const project = snapshot.projects.find(
    (entry) => entry.id === input.projectId && entry.deletedAt === null,
  );
  if (!project) {
    throw bootstrapError("project_not_found", `Project '${input.projectId}' was not found.`);
  }

  const settings = await deps.getSettings();
  const environment = settings.remoteEnvironments.find((entry) => entry.id === input.serverId);
  if (!environment) {
    throw bootstrapError("ssh_server_not_found", `SSH server '${input.serverId}' was not found.`);
  }

  const localRepo = await deps.isInsideWorkTree(project.workspaceRoot);
  if (!localRepo) {
    throw bootstrapError(
      "local_repo_not_git",
      `Project workspace '${project.workspaceRoot}' is not a git repository.`,
    );
  }

  const localOriginUrl =
    (await deps.readConfigValue(project.workspaceRoot, "remote.origin.url"))?.trim() ?? "";
  if (localOriginUrl.length === 0) {
    throw bootstrapError(
      "local_origin_missing",
      "Local repository has no 'origin' remote. Add one before using SSH mode.",
    );
  }

  const localDefaultBranch = await deps.readLocalDefaultBranch(project.workspaceRoot);

  const existingBinding =
    settings.remoteProjectBindings.find(
      (binding) => binding.projectId === input.projectId && binding.serverId === input.serverId,
    ) ?? null;

  const remoteRepoPath =
    existingBinding?.remoteRepoPath.trim() || buildDerivedRepoPath(environment, project.title);
  const cloneUrl = existingBinding?.cloneUrl.trim() || localOriginUrl;
  const expectedOriginUrl = existingBinding?.expectedOriginUrl.trim() || localOriginUrl;
  const expectedDefaultBranch =
    existingBinding?.defaultBranch.trim() || localDefaultBranch || "main";

  const hostClassification = classifySshHost(environment.host);

  const preflightResult = await deps.runSshScript(
    environment,
    PRE_FLIGHT_SCRIPT,
    SSH_SCRIPT_TIMEOUT_MS,
  );
  if (preflightResult.code === 42 || /__T3_MISSING_GIT__/.test(preflightResult.stderr)) {
    throw bootstrapError(
      "remote_git_missing",
      "Remote host is reachable, but git is not installed.",
    );
  }
  if ((preflightResult.code ?? 1) !== 0) {
    if (hostClassification === "tailnet") {
      const tailnetFailure = mapTailnetPreflightFailure(preflightResult);
      throw bootstrapError(tailnetFailure.code, tailnetFailure.detail);
    }
    throw bootstrapError("ssh_connect_failed", normalizeSshFailureOutput(preflightResult));
  }

  const checkRepoStateScript = `
set -eu
repo_path=${quoteShell(remoteRepoPath)}
if [ -d "$repo_path/.git" ] || git -C "$repo_path" rev-parse --git-dir >/dev/null 2>&1; then
  echo '__T3_REPO_STATE__=repo'
elif [ -e "$repo_path" ]; then
  echo '__T3_REPO_STATE__=path_exists_non_repo'
else
  echo '__T3_REPO_STATE__=missing'
fi
`;

  const repoStateResult = await deps.runSshScript(environment, checkRepoStateScript);
  if ((repoStateResult.code ?? 1) !== 0) {
    throw bootstrapError("ssh_connect_failed", normalizeSshFailureOutput(repoStateResult));
  }

  const repoState = parseLineValue(repoStateResult.stdout, "__T3_REPO_STATE__")?.trim();
  if (repoState === "path_exists_non_repo") {
    throw bootstrapError(
      "remote_path_not_repo",
      `Remote path '${remoteRepoPath}' exists but is not a git repository.`,
    );
  }

  let cloned = false;
  if (repoState === "missing") {
    const cloneScript = `
set -eu
repo_path=${quoteShell(remoteRepoPath)}
clone_url=${quoteShell(cloneUrl)}
parent_dir=$(dirname "$repo_path")
mkdir -p "$parent_dir"
git clone "$clone_url" "$repo_path"
`;

    const cloneResult = await deps.runSshScript(environment, cloneScript, 30_000);
    if ((cloneResult.code ?? 1) !== 0) {
      throw bootstrapError(
        "remote_clone_failed",
        `Failed to clone '${cloneUrl}' to '${remoteRepoPath}'. ${normalizeSshFailureOutput(cloneResult)}`,
      );
    }

    cloned = true;
  }

  const remoteRepo = await verifyRemoteRepo(deps, environment, remoteRepoPath);

  if (remoteRepo.originUrl.length === 0 || remoteRepo.originUrl !== expectedOriginUrl) {
    throw bootstrapError(
      "remote_repo_drift",
      `Remote origin mismatch at '${remoteRepoPath}'. Expected '${expectedOriginUrl}', got '${remoteRepo.originUrl || "(empty)"}'.`,
    );
  }

  if (remoteRepo.defaultBranch.length > 0 && remoteRepo.defaultBranch !== expectedDefaultBranch) {
    throw bootstrapError(
      "remote_repo_drift",
      `Remote default branch mismatch at '${remoteRepoPath}'. Expected '${expectedDefaultBranch}', got '${remoteRepo.defaultBranch}'.`,
    );
  }

  const now = deps.now();
  const nextBinding: RemoteProjectBinding = {
    projectId: input.projectId,
    serverId: input.serverId,
    remoteRepoPath,
    cloneUrl,
    defaultBranch: expectedDefaultBranch,
    lastVerifiedAt: now,
    expectedOriginUrl,
    ...(existingBinding?.installModeOverride
      ? { installModeOverride: existingBinding.installModeOverride }
      : {}),
  };

  const nextBindings = [
    ...settings.remoteProjectBindings.filter(
      (binding) => !(binding.projectId === input.projectId && binding.serverId === input.serverId),
    ),
    nextBinding,
  ];

  try {
    await deps.updateSettings({ remoteProjectBindings: nextBindings });
  } catch (error) {
    throw bootstrapError(
      "settings_update_failed",
      "Failed to persist SSH repo binding settings.",
      error,
    );
  }

  const executionTarget: ServerBootstrapSshExecutionTarget = {
    kind: "ssh",
    serverId: input.serverId,
    remoteRepoPath,
    remoteWorkspacePath: null,
  };

  return {
    binding: nextBinding,
    executionTarget,
    createdBinding: existingBinding === null,
    cloned,
    hostClassification,
  };
}

function buildSshRepoBootstrap(input: {
  readonly snapshotQuery: ProjectionSnapshotQuery["Service"];
  readonly serverSettings: ServerSettingsService["Service"];
  readonly git: GitCore["Service"];
}): SshRepoBootstrapShape {
  const { snapshotQuery, serverSettings, git } = input;
  type GitCommandResult = {
    readonly code: number | null;
    readonly stdout: string;
  };
  const runSshScript: SshRepoBootstrapCoreDeps["runSshScript"] = async (
    environment,
    script,
    timeoutMs = SSH_SCRIPT_TIMEOUT_MS,
  ) => {
    const args = buildSshArgs(environment);
    const result = await runProcess("ssh", args, {
      stdin: script,
      timeoutMs,
      allowNonZeroExit: true,
      maxBufferBytes: SSH_MAX_OUTPUT_BYTES,
      outputMode: "truncate",
    });

    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  };

  const readLocalDefaultBranch: SshRepoBootstrapCoreDeps["readLocalDefaultBranch"] = async (
    cwd,
  ) => {
    const defaultRef = (await Effect.runPromise(
      git.execute({
        operation: "SshRepoBootstrap.readLocalDefaultBranch",
        cwd,
        args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
        allowNonZeroExit: true,
      }),
    )) as GitCommandResult;

    if (defaultRef.code === 0) {
      const branch = defaultRef.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
      if (branch.length > 0) {
        return branch;
      }
    }

    const currentBranch = (await Effect.runPromise(
      git.execute({
        operation: "SshRepoBootstrap.readLocalDefaultBranchFallback",
        cwd,
        args: ["branch", "--show-current"],
        allowNonZeroExit: true,
      }),
    )) as GitCommandResult;
    const fallbackBranch = currentBranch.stdout.trim();
    if (fallbackBranch.length > 0) {
      return fallbackBranch;
    }

    return "main";
  };

  const bootstrapRepoBinding: SshRepoBootstrapShape["bootstrapRepoBinding"] = (input) =>
    Effect.tryPromise({
      try: () =>
        bootstrapSshRepoBindingWithDeps(input, {
          getSnapshot: () => Effect.runPromise(snapshotQuery.getSnapshot()),
          getSettings: () => Effect.runPromise(serverSettings.getSettings),
          updateSettings: (patch) =>
            Effect.runPromise(
              serverSettings.updateSettings({ remoteProjectBindings: patch.remoteProjectBindings }),
            ).then(() => undefined),
          isInsideWorkTree: (cwd) => Effect.runPromise(git.isInsideWorkTree(cwd)),
          readConfigValue: (cwd, key) => Effect.runPromise(git.readConfigValue(cwd, key)),
          readLocalDefaultBranch,
          runSshScript,
          now: () => new Date().toISOString(),
        }),
      catch: (error) =>
        Schema.is(ServerBootstrapSshRepoBindingError)(error)
          ? error
          : bootstrapError(
              "ssh_connect_failed",
              error instanceof Error ? error.message : "SSH bootstrap failed.",
              error,
            ),
    });

  return {
    bootstrapRepoBinding,
  } satisfies SshRepoBootstrapShape;
}

const makeSshRepoBootstrap = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const git = yield* GitCore;

  return buildSshRepoBootstrap({
    snapshotQuery,
    serverSettings,
    git,
  });
});

export const SshRepoBootstrapLive = Layer.effect(SshRepoBootstrap, makeSshRepoBootstrap);
