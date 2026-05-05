import { Effect } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas";
import {
  ClaudeModelOptions,
  CodexModelOptions,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
} from "./model";
import { ModelSelection } from "./orchestration";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const LightThemePreset = Schema.Literals([
  "solarized-light",
  "one-light",
  "catppuccin-latte",
  "rose-pine-dawn",
]);
export type LightThemePreset = typeof LightThemePreset.Type;
export const DEFAULT_LIGHT_THEME_PRESET: LightThemePreset = "solarized-light";

export const DarkThemePreset = Schema.Literals([
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "solarized-dark",
  "dracula",
  "monokai",
  "nord",
]);
export type DarkThemePreset = typeof DarkThemePreset.Type;
export const DEFAULT_DARK_THEME_PRESET: DarkThemePreset = "catppuccin-mocha";

export const DEFAULT_CODE_FONT_SIZE = 13;

export const ClientSettingsSchema = Schema.Struct({
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  diffWordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  lightThemePreset: LightThemePreset.pipe(
    Schema.withDecodingDefault(() => DEFAULT_LIGHT_THEME_PRESET),
  ),
  darkThemePreset: DarkThemePreset.pipe(
    Schema.withDecodingDefault(() => DEFAULT_DARK_THEME_PRESET),
  ),
  codeFontSize: Schema.Number.pipe(Schema.withDecodingDefault(() => DEFAULT_CODE_FONT_SIZE)),
  timestampFormat: TimestampFormat.pipe(Schema.withDecodingDefault(() => DEFAULT_TIMESTAMP_FORMAT)),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree", "ssh"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

export const RemoteEnvironmentAuthMode = Schema.Literals(["agent", "keyFile"]);
export type RemoteEnvironmentAuthMode = typeof RemoteEnvironmentAuthMode.Type;

export const RemoteEnvironmentInstallMode = Schema.Literals(["standalone", "docker"]);
export type RemoteEnvironmentInstallMode = typeof RemoteEnvironmentInstallMode.Type;

export const RemoteEnvironmentHealthStatus = Schema.Literals([
  "unknown",
  "checking",
  "ready",
  "warning",
  "error",
]);
export type RemoteEnvironmentHealthStatus = typeof RemoteEnvironmentHealthStatus.Type;

export const RemoteEnvironmentInstallStatus = Schema.Literals([
  "unknown",
  "not-installed",
  "installing",
  "ready",
  "repair-required",
  "version-mismatch",
  "error",
]);
export type RemoteEnvironmentInstallStatus = typeof RemoteEnvironmentInstallStatus.Type;

export const RemoteEnvironmentHealth = Schema.Struct({
  status: RemoteEnvironmentHealthStatus.pipe(Schema.withDecodingDefault(() => "unknown")),
  installStatus: RemoteEnvironmentInstallStatus.pipe(Schema.withDecodingDefault(() => "unknown")),
  checkedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  runtimeVersion: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  message: Schema.optional(TrimmedNonEmptyString),
});
export type RemoteEnvironmentHealth = typeof RemoteEnvironmentHealth.Type;

export const RemoteEnvironment = Schema.Struct({
  id: TrimmedNonEmptyString,
  nickname: TrimmedString,
  host: TrimmedString,
  port: PositiveInt.check(Schema.isLessThanOrEqualTo(65535)).pipe(
    Schema.withDecodingDefault(() => 22),
  ),
  username: TrimmedString,
  authMode: RemoteEnvironmentAuthMode,
  keyFilePath: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  preferredInstallMode: RemoteEnvironmentInstallMode.pipe(
    Schema.withDecodingDefault(() => "standalone"),
  ),
  defaultBaseDir: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  health: RemoteEnvironmentHealth.pipe(Schema.withDecodingDefault(() => ({}))),
});
export type RemoteEnvironment = typeof RemoteEnvironment.Type;

export const RemoteProjectBinding = Schema.Struct({
  projectId: ProjectId,
  serverId: TrimmedNonEmptyString,
  remoteRepoPath: TrimmedString,
  cloneUrl: TrimmedString,
  defaultBranch: TrimmedString,
  lastVerifiedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  expectedOriginUrl: TrimmedString,
  installModeOverride: Schema.optional(RemoteEnvironmentInstallMode),
});
export type RemoteProjectBinding = typeof RemoteProjectBinding.Type;

const makeBinaryPathSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || fallback),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => fallback),
  );

export const CodexSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("codex"),
  homePath: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type CodexSettings = typeof CodexSettings.Type;

export const ClaudeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("claude"),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type ClaudeSettings = typeof ClaudeSettings.Type;

export const ObservabilitySettings = Schema.Struct({
  otlpTracesUrl: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  otlpMetricsUrl: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
});
export type ObservabilitySettings = typeof ObservabilitySettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(() => "local" as const satisfies ThreadEnvMode),
  ),
  remoteEnvironments: Schema.Array(RemoteEnvironment).pipe(Schema.withDecodingDefault(() => [])),
  remoteProjectBindings: Schema.Array(RemoteProjectBinding).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "codex" as const,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
    })),
  ),

  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
  observability: ObservabilitySettings.pipe(Schema.withDecodingDefault(() => ({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const CodexModelOptionsPatch = Schema.Struct({
  reasoningEffort: Schema.optionalKey(CodexModelOptions.fields.reasoningEffort),
  fastMode: Schema.optionalKey(CodexModelOptions.fields.fastMode),
});

const ClaudeModelOptionsPatch = Schema.Struct({
  thinking: Schema.optionalKey(ClaudeModelOptions.fields.thinking),
  effort: Schema.optionalKey(ClaudeModelOptions.fields.effort),
  fastMode: Schema.optionalKey(ClaudeModelOptions.fields.fastMode),
  contextWindow: Schema.optionalKey(ClaudeModelOptions.fields.contextWindow),
});

const ModelSelectionPatch = Schema.Union([
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("codex")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(CodexModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("claudeAgent")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(ClaudeModelOptionsPatch),
  }),
]);

const CodexSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  homePath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ClaudeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  remoteEnvironments: Schema.optionalKey(Schema.Array(RemoteEnvironment)),
  remoteProjectBindings: Schema.optionalKey(Schema.Array(RemoteProjectBinding)),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(Schema.String),
      otlpMetricsUrl: Schema.optionalKey(Schema.String),
    }),
  ),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(CodexSettingsPatch),
      claudeAgent: Schema.optionalKey(ClaudeSettingsPatch),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;
