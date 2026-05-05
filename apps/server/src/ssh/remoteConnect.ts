import {
  type RemoteEnvironment,
  type RemoteEnvironmentHealth,
  type ServerConnectRemoteEnvironmentErrorCode,
  ServerConnectRemoteEnvironmentError,
  type ServerConnectRemoteEnvironmentEvent,
  type ServerConnectRemoteEnvironmentInput,
  type ServerConnectRemoteEnvironmentPhase,
  type ServerConnectRemoteEnvironmentResult,
  type ServerSettings,
  type ServerSettingsError,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { Effect, Exit, Option } from "effect";

import { runProcess } from "../processRunner";
import { classifySshHost } from "./hostClassification";

const SSH_CONNECT_TIMEOUT_SECONDS = 8;
const SSH_SCRIPT_TIMEOUT_MS = 12_000;
const SSH_MAX_OUTPUT_BYTES = 512 * 1024;

export interface SshScriptExecutionResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface RemoteConnectProgressReporter {
  readonly publish: (event: ServerConnectRemoteEnvironmentEvent) => Effect.Effect<void, never>;
}

export interface RemoteConnectDeps {
  readonly getSettings: () => Effect.Effect<ServerSettings, ServerSettingsError>;
  readonly updateSettings: (
    patch: ServerSettingsPatch,
  ) => Effect.Effect<ServerSettings, ServerSettingsError>;
  readonly now: () => string;
}

function ensureDetail(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Remote SSH connect failed.";
}

function connectError(
  code: ServerConnectRemoteEnvironmentErrorCode,
  detail: string,
  cause?: unknown,
): ServerConnectRemoteEnvironmentError {
  return new ServerConnectRemoteEnvironmentError({
    code,
    detail: ensureDetail(detail),
    ...(cause !== undefined ? { cause } : {}),
  });
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
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

function mapTailnetFailure(result: SshScriptExecutionResult): ServerConnectRemoteEnvironmentError {
  const failure = normalizeSshFailureOutput(result);
  const remediation =
    "Check that local Tailscale is connected, the target host is on the same tailnet, and tailnet ACLs allow SSH from this device/user.";

  if (isDnsResolutionFailure(failure)) {
    return connectError(
      "ssh_tailnet_dns_unresolved",
      `Tailnet DNS lookup failed. ${remediation} Raw error: ${failure}`,
    );
  }

  if (isAclOrPermissionFailure(failure)) {
    return connectError(
      "ssh_tailnet_acl_denied",
      `Tailnet SSH access was denied. ${remediation} Raw error: ${failure}`,
    );
  }

  return connectError(
    "ssh_tailnet_unreachable",
    isUnreachableFailure(failure)
      ? `Tailnet host is unreachable. ${remediation} Raw error: ${failure}`
      : `Could not reach the tailnet host. ${remediation} Raw error: ${failure}`,
  );
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

function resolveConnectFailureForHost(
  host: string,
  result: SshScriptExecutionResult,
): ServerConnectRemoteEnvironmentError {
  return classifySshHost(host) === "tailnet"
    ? mapTailnetFailure(result)
    : connectError("ssh_connect_failed", normalizeSshFailureOutput(result));
}

function splitOutputLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runSshScript(
  environment: RemoteEnvironment,
  script: string,
  timeoutMs = SSH_SCRIPT_TIMEOUT_MS,
): Promise<SshScriptExecutionResult> {
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
}

export const connectRemoteEnvironment = (
  input: ServerConnectRemoteEnvironmentInput,
  deps: RemoteConnectDeps,
  reporter: RemoteConnectProgressReporter,
): Effect.Effect<ServerConnectRemoteEnvironmentResult, ServerConnectRemoteEnvironmentError> =>
  Effect.gen(function* () {
    const emit = (event: ServerConnectRemoteEnvironmentEvent) => reporter.publish(event);
    const now = () => deps.now();

    const readSettingsForConnection = () =>
      deps
        .getSettings()
        .pipe(
          Effect.mapError((cause) =>
            connectError("ssh_connect_failed", "Failed to load SSH server settings.", cause),
          ),
        );

    const readSettingsForUpdate = () =>
      deps
        .getSettings()
        .pipe(
          Effect.mapError((cause) =>
            connectError("settings_update_failed", "Failed to load SSH server settings.", cause),
          ),
        );

    const updateSettingsSafe = (patch: ServerSettingsPatch) =>
      deps
        .updateSettings(patch)
        .pipe(
          Effect.mapError((cause) =>
            connectError(
              "settings_update_failed",
              "Failed to persist remote environment health settings.",
              cause,
            ),
          ),
        );

    const getEnvironment = () =>
      Effect.gen(function* () {
        const settings = yield* readSettingsForConnection();
        const environment =
          settings.remoteEnvironments.find((entry) => entry.id === input.serverId) ?? null;
        if (!environment) {
          return yield* connectError(
            "ssh_server_not_found",
            `SSH server '${input.serverId}' was not found.`,
          );
        }
        return environment;
      });

    const updateHealth = (patch: Partial<RemoteEnvironmentHealth>) =>
      Effect.gen(function* () {
        const settings = yield* readSettingsForUpdate();
        const environment =
          settings.remoteEnvironments.find((entry) => entry.id === input.serverId) ?? null;
        if (!environment) {
          return yield* connectError(
            "ssh_server_not_found",
            `SSH server '${input.serverId}' was not found.`,
          );
        }
        const nextHealth: RemoteEnvironmentHealth = {
          ...environment.health,
          ...patch,
        };
        const nextRemoteEnvironments = settings.remoteEnvironments.map((entry) =>
          entry.id === input.serverId ? Object.assign({}, entry, { health: nextHealth }) : entry,
        );
        yield* updateSettingsSafe({ remoteEnvironments: nextRemoteEnvironments });
        return nextHealth;
      });

    const emitLogs = (
      phase: ServerConnectRemoteEnvironmentPhase,
      result: SshScriptExecutionResult,
    ) =>
      Effect.gen(function* () {
        for (const line of splitOutputLines(result.stdout)) {
          yield* emit({
            _tag: "phase_log",
            phase,
            level: "stdout",
            message: line,
            at: now(),
          });
        }
        for (const line of splitOutputLines(result.stderr)) {
          yield* emit({
            _tag: "phase_log",
            phase,
            level: "stderr",
            message: line,
            at: now(),
          });
        }
      });

    const runPhase = <A>(
      phase: ServerConnectRemoteEnvironmentPhase,
      label: string,
      operation: Effect.Effect<A, ServerConnectRemoteEnvironmentError>,
    ): Effect.Effect<A, ServerConnectRemoteEnvironmentError> =>
      Effect.gen(function* () {
        yield* emit({
          _tag: "phase_started",
          phase,
          label,
          startedAt: now(),
        });

        const exit = yield* Effect.exit(operation);
        if (Exit.isSuccess(exit)) {
          yield* emit({
            _tag: "phase_finished",
            phase,
            status: "ok",
            finishedAt: now(),
          });
          return exit.value;
        }

        const failureOption = Exit.findErrorOption(exit);
        const failure = Option.isSome(failureOption)
          ? failureOption.value
          : connectError("ssh_connect_failed", "Remote phase failed.");

        yield* emit({
          _tag: "phase_finished",
          phase,
          status: "error",
          detail: failure.detail,
          finishedAt: now(),
        });

        return yield* failure;
      });

    const startedAt = now();
    yield* emit({
      _tag: "connect_started",
      serverId: input.serverId,
      startedAt,
    });

    const finishFailure = (error: ServerConnectRemoteEnvironmentError) =>
      Effect.gen(function* () {
        const failedAt = now();

        yield* updateHealth({
          status: "error",
          installStatus:
            error.code === "remote_git_missing"
              ? "not-installed"
              : error.code === "remote_docker_missing"
                ? "repair-required"
                : "error",
          checkedAt: failedAt,
          message: error.detail,
        }).pipe(Effect.catch(() => Effect.void));

        yield* emit({
          _tag: "connect_failed",
          serverId: input.serverId,
          code: error.code,
          detail: error.detail,
          at: failedAt,
        });
      });

    const main = Effect.gen(function* () {
      yield* updateHealth({
        status: "checking",
        installStatus: "installing",
        checkedAt: startedAt,
        message: "Connecting to remote host...",
      });

      const environment = yield* getEnvironment();

      yield* runPhase(
        "connectivity",
        "Connecting to server",
        Effect.tryPromise({
          try: () => runSshScript(environment, "printf '__T3_CONNECT_OK__\\n'"),
          catch: (cause) =>
            connectError(
              "ssh_connect_failed",
              cause instanceof Error ? cause.message : "Failed to run SSH connectivity check.",
              cause,
            ),
        }).pipe(
          Effect.tap((result) => emitLogs("connectivity", result)),
          Effect.flatMap((result) =>
            (result.code ?? 1) === 0
              ? Effect.void
              : Effect.fail(resolveConnectFailureForHost(environment.host, result)),
          ),
        ),
      );

      const systemResult = yield* runPhase(
        "system",
        "Collecting remote system information",
        Effect.tryPromise({
          try: () =>
            runSshScript(
              environment,
              `
set -eu
uname_s=$(uname -s 2>/dev/null || echo unknown)
uname_m=$(uname -m 2>/dev/null || echo unknown)
git_version=$(git --version 2>/dev/null || true)
docker_version=$(docker --version 2>/dev/null || true)
printf '__T3_UNAME_S__=%s\\n' "$uname_s"
printf '__T3_UNAME_M__=%s\\n' "$uname_m"
printf '__T3_GIT_VERSION__=%s\\n' "$git_version"
printf '__T3_DOCKER_VERSION__=%s\\n' "$docker_version"
`,
            ),
          catch: (cause) =>
            connectError(
              "ssh_connect_failed",
              cause instanceof Error ? cause.message : "Failed to inspect remote system.",
              cause,
            ),
        }).pipe(
          Effect.tap((result) => emitLogs("system", result)),
          Effect.flatMap((result) =>
            (result.code ?? 1) === 0
              ? Effect.succeed(result)
              : Effect.fail(resolveConnectFailureForHost(environment.host, result)),
          ),
        ),
      );

      const remoteOs = parseLineValue(systemResult.stdout, "__T3_UNAME_S__") ?? "unknown";
      const remoteArch = parseLineValue(systemResult.stdout, "__T3_UNAME_M__") ?? "unknown";
      const gitVersion = (parseLineValue(systemResult.stdout, "__T3_GIT_VERSION__") ?? "").trim();
      const dockerVersion = (
        parseLineValue(systemResult.stdout, "__T3_DOCKER_VERSION__") ?? ""
      ).trim();

      yield* runPhase(
        "prerequisites",
        "Validating remote prerequisites",
        Effect.tryPromise({
          try: () =>
            runSshScript(
              environment,
              `
set -eu
preferred_install_mode=${quoteShell(environment.preferredInstallMode)}
if ! command -v git >/dev/null 2>&1; then
  echo "__T3_MISSING_GIT__" >&2
  exit 42
fi
if [ "$preferred_install_mode" = "docker" ] && ! command -v docker >/dev/null 2>&1; then
  echo "__T3_MISSING_DOCKER__" >&2
  exit 43
fi
printf '__T3_PREREQ_OK__\\n'
`,
            ),
          catch: (cause) =>
            connectError(
              "ssh_connect_failed",
              cause instanceof Error ? cause.message : "Failed to validate prerequisites.",
              cause,
            ),
        }).pipe(
          Effect.tap((result) => emitLogs("prerequisites", result)),
          Effect.flatMap((result) => {
            if ((result.code ?? 1) === 0) {
              return Effect.void;
            }
            if (result.code === 42 || /__T3_MISSING_GIT__/.test(result.stderr)) {
              return Effect.fail(
                connectError(
                  "remote_git_missing",
                  "Remote host is reachable, but git is not installed.",
                ),
              );
            }
            if (result.code === 43 || /__T3_MISSING_DOCKER__/.test(result.stderr)) {
              return Effect.fail(
                connectError(
                  "remote_docker_missing",
                  "Remote host is reachable, but Docker is not installed.",
                ),
              );
            }
            return Effect.fail(resolveConnectFailureForHost(environment.host, result));
          }),
        ),
      );

      yield* runPhase(
        "workspace",
        "Preparing remote workspace",
        Effect.tryPromise({
          try: () => {
            const baseDir = environment.defaultBaseDir?.trim() || "/srv";
            return runSshScript(
              environment,
              `
set -eu
base_dir=${quoteShell(baseDir)}
mkdir -p "$base_dir"
if [ ! -w "$base_dir" ]; then
  echo "__T3_BASEDIR_NOT_WRITABLE__" >&2
  exit 44
fi
printf '__T3_BASEDIR__=%s\\n' "$base_dir"
`,
            );
          },
          catch: (cause) =>
            connectError(
              "ssh_connect_failed",
              cause instanceof Error ? cause.message : "Failed to prepare remote workspace.",
              cause,
            ),
        }).pipe(
          Effect.tap((result) => emitLogs("workspace", result)),
          Effect.flatMap((result) => {
            if ((result.code ?? 1) === 0) {
              return Effect.void;
            }
            if (result.code === 44 || /__T3_BASEDIR_NOT_WRITABLE__/.test(result.stderr)) {
              return Effect.fail(
                connectError(
                  "remote_workspace_unwritable",
                  "Remote base directory is not writable by the configured SSH user.",
                ),
              );
            }
            return Effect.fail(resolveConnectFailureForHost(environment.host, result));
          }),
        ),
      );

      const completedAt = now();
      const runtimeVersion = `${remoteOs}/${remoteArch}`;
      const messageParts = [`Connected to ${environment.host}`, runtimeVersion];
      if (gitVersion) {
        messageParts.push(gitVersion);
      }
      if (dockerVersion) {
        messageParts.push(dockerVersion);
      }
      const message = messageParts.join(" · ");

      const finalHealth = yield* runPhase(
        "finalize",
        "Finalizing remote link",
        updateHealth({
          status: "ready",
          installStatus: "ready",
          checkedAt: completedAt,
          runtimeVersion,
          message,
        }),
      );

      const result: ServerConnectRemoteEnvironmentResult = {
        serverId: input.serverId,
        checkedAt: completedAt,
        health: finalHealth,
      };

      yield* emit({
        _tag: "connect_finished",
        result,
      });

      return result;
    });

    const exit = yield* Effect.exit(main);
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    const failureOption = Exit.findErrorOption(exit);
    const connectFailure = Option.isSome(failureOption)
      ? failureOption.value
      : connectError("ssh_connect_failed", "Remote SSH connect failed.");

    yield* finishFailure(connectFailure);
    return yield* connectFailure;
  });
