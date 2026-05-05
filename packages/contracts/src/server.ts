import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import { ProviderKind } from "./orchestration";
import { RemoteEnvironmentHealth, RemoteProjectBinding, ServerSettings } from "./settings";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isCustom: Schema.Boolean,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProvider = Schema.Struct({
  provider: ProviderKind,
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
});
export type ServerProvider = typeof ServerProvider.Type;

export const ServerProviders = Schema.Array(ServerProvider);
export type ServerProviders = typeof ServerProviders.Type;

export const ServerObservability = Schema.Struct({
  logsDirectoryPath: TrimmedNonEmptyString,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsEnabled: Schema.Boolean,
});
export type ServerObservability = typeof ServerObservability.Type;

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  observability: ServerObservability,
  settings: ServerSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviders,
  settings: Schema.optional(ServerSettings),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerConfigKeybindingsUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
});
export type ServerConfigKeybindingsUpdatedPayload =
  typeof ServerConfigKeybindingsUpdatedPayload.Type;

export const ServerConfigProviderStatusesPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerConfigProviderStatusesPayload = typeof ServerConfigProviderStatusesPayload.Type;

export const ServerConfigSettingsUpdatedPayload = Schema.Struct({
  settings: ServerSettings,
});
export type ServerConfigSettingsUpdatedPayload = typeof ServerConfigSettingsUpdatedPayload.Type;

export const ServerConfigStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  config: ServerConfig,
});
export type ServerConfigStreamSnapshotEvent = typeof ServerConfigStreamSnapshotEvent.Type;

export const ServerConfigStreamKeybindingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("keybindingsUpdated"),
  payload: ServerConfigKeybindingsUpdatedPayload,
});
export type ServerConfigStreamKeybindingsUpdatedEvent =
  typeof ServerConfigStreamKeybindingsUpdatedEvent.Type;

export const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("providerStatuses"),
  payload: ServerConfigProviderStatusesPayload,
});
export type ServerConfigStreamProviderStatusesEvent =
  typeof ServerConfigStreamProviderStatusesEvent.Type;

export const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("settingsUpdated"),
  payload: ServerConfigSettingsUpdatedPayload,
});
export type ServerConfigStreamSettingsUpdatedEvent =
  typeof ServerConfigStreamSettingsUpdatedEvent.Type;

export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamKeybindingsUpdatedEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

export const ServerLifecycleReadyPayload = Schema.Struct({
  at: IsoDateTime,
});
export type ServerLifecycleReadyPayload = typeof ServerLifecycleReadyPayload.Type;

export const ServerLifecycleWelcomePayload = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

export const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("welcome"),
  payload: ServerLifecycleWelcomePayload,
});
export type ServerLifecycleStreamWelcomeEvent = typeof ServerLifecycleStreamWelcomeEvent.Type;

export const ServerLifecycleStreamReadyEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("ready"),
  payload: ServerLifecycleReadyPayload,
});
export type ServerLifecycleStreamReadyEvent = typeof ServerLifecycleStreamReadyEvent.Type;

export const ServerLifecycleStreamEvent = Schema.Union([
  ServerLifecycleStreamWelcomeEvent,
  ServerLifecycleStreamReadyEvent,
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;

export const ServerBootstrapSshRepoBindingInput = Schema.Struct({
  projectId: ProjectId,
  serverId: TrimmedNonEmptyString,
});
export type ServerBootstrapSshRepoBindingInput = typeof ServerBootstrapSshRepoBindingInput.Type;

export const SshHostClassification = Schema.Literals(["standard", "tailnet"]);
export type SshHostClassification = typeof SshHostClassification.Type;

export const ServerBootstrapSshExecutionTarget = Schema.Struct({
  kind: Schema.Literal("ssh"),
  serverId: TrimmedNonEmptyString,
  remoteRepoPath: TrimmedNonEmptyString,
  remoteWorkspacePath: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type ServerBootstrapSshExecutionTarget = typeof ServerBootstrapSshExecutionTarget.Type;

export const ServerBootstrapSshRepoBindingResult = Schema.Struct({
  binding: RemoteProjectBinding,
  executionTarget: ServerBootstrapSshExecutionTarget,
  createdBinding: Schema.Boolean,
  cloned: Schema.Boolean,
  hostClassification: SshHostClassification,
});
export type ServerBootstrapSshRepoBindingResult = typeof ServerBootstrapSshRepoBindingResult.Type;

export const ServerBootstrapSshRepoBindingErrorCode = Schema.Literals([
  "ssh_server_not_found",
  "project_not_found",
  "local_repo_not_git",
  "local_origin_missing",
  "ssh_connect_failed",
  "remote_git_missing",
  "remote_path_not_repo",
  "remote_repo_drift",
  "remote_clone_failed",
  "settings_update_failed",
  "ssh_tailnet_dns_unresolved",
  "ssh_tailnet_unreachable",
  "ssh_tailnet_acl_denied",
]);
export type ServerBootstrapSshRepoBindingErrorCode =
  typeof ServerBootstrapSshRepoBindingErrorCode.Type;

export class ServerBootstrapSshRepoBindingError extends Schema.TaggedErrorClass<ServerBootstrapSshRepoBindingError>()(
  "ServerBootstrapSshRepoBindingError",
  {
    code: ServerBootstrapSshRepoBindingErrorCode,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `SSH bootstrap failed (${this.code}): ${this.detail}`;
  }
}

export const ServerConnectRemoteEnvironmentInput = Schema.Struct({
  serverId: TrimmedNonEmptyString,
});
export type ServerConnectRemoteEnvironmentInput = typeof ServerConnectRemoteEnvironmentInput.Type;

export const ServerConnectRemoteEnvironmentPhase = Schema.Literals([
  "connectivity",
  "system",
  "prerequisites",
  "workspace",
  "finalize",
]);
export type ServerConnectRemoteEnvironmentPhase = typeof ServerConnectRemoteEnvironmentPhase.Type;

export const ServerConnectRemoteEnvironmentLogLevel = Schema.Literals([
  "system",
  "stdout",
  "stderr",
]);
export type ServerConnectRemoteEnvironmentLogLevel =
  typeof ServerConnectRemoteEnvironmentLogLevel.Type;

export const ServerConnectRemoteEnvironmentResult = Schema.Struct({
  serverId: TrimmedNonEmptyString,
  checkedAt: IsoDateTime,
  health: RemoteEnvironmentHealth,
});
export type ServerConnectRemoteEnvironmentResult = typeof ServerConnectRemoteEnvironmentResult.Type;

export const ServerConnectRemoteEnvironmentEvent = Schema.Union([
  Schema.TaggedStruct("connect_started", {
    serverId: TrimmedNonEmptyString,
    startedAt: IsoDateTime,
  }),
  Schema.TaggedStruct("phase_started", {
    phase: ServerConnectRemoteEnvironmentPhase,
    label: TrimmedNonEmptyString,
    startedAt: IsoDateTime,
  }),
  Schema.TaggedStruct("phase_log", {
    phase: ServerConnectRemoteEnvironmentPhase,
    level: ServerConnectRemoteEnvironmentLogLevel,
    message: TrimmedNonEmptyString,
    at: IsoDateTime,
  }),
  Schema.TaggedStruct("phase_finished", {
    phase: ServerConnectRemoteEnvironmentPhase,
    status: Schema.Literals(["ok", "error"]),
    detail: Schema.optional(TrimmedNonEmptyString),
    finishedAt: IsoDateTime,
  }),
  Schema.TaggedStruct("connect_finished", {
    result: ServerConnectRemoteEnvironmentResult,
  }),
  Schema.TaggedStruct("connect_failed", {
    serverId: TrimmedNonEmptyString,
    code: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    at: IsoDateTime,
  }),
]);
export type ServerConnectRemoteEnvironmentEvent = typeof ServerConnectRemoteEnvironmentEvent.Type;

export const ServerConnectRemoteEnvironmentErrorCode = Schema.Literals([
  "ssh_server_not_found",
  "ssh_connect_failed",
  "ssh_tailnet_dns_unresolved",
  "ssh_tailnet_unreachable",
  "ssh_tailnet_acl_denied",
  "remote_git_missing",
  "remote_workspace_unwritable",
  "remote_docker_missing",
  "settings_update_failed",
]);
export type ServerConnectRemoteEnvironmentErrorCode =
  typeof ServerConnectRemoteEnvironmentErrorCode.Type;

export class ServerConnectRemoteEnvironmentError extends Schema.TaggedErrorClass<ServerConnectRemoteEnvironmentError>()(
  "ServerConnectRemoteEnvironmentError",
  {
    code: ServerConnectRemoteEnvironmentErrorCode,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Remote SSH connect failed (${this.code}): ${this.detail}`;
  }
}
