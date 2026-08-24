import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ProviderFailure,
  ProgramAttemptId,
  ProgramAttemptCancelInput as ProgramAttemptCancelInputSchema,
  type ProgramAttemptCancelInput,
  ProgramAttemptEffectInput as ProgramAttemptEffectInputSchema,
  type ProgramAttemptEffectInput,
  ProgramAttemptLaunchInput as ProgramAttemptLaunchInputSchema,
  type ProgramAttemptLaunchInput,
  type ProgramAttemptSnapshot,
  type ProgramAttemptRuntimeUsage,
  type ProgramTeamPolicy,
  ProgramAttemptTerminalResult as ProgramAttemptTerminalResultSchema,
  type ProgramAttemptTerminalResult,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  type ProgramAttemptError,
  ProgramAttemptInvalidRecordError,
  ProgramAttemptNotFoundError,
  ProgramAttemptOperationError,
  ProgramAttemptPersistenceError,
  ProgramAttemptRequestConflictError,
  ProgramAttemptStateError,
} from "./ProgramAttemptErrors.ts";
import * as ThreadLaunchService from "./ThreadLaunchService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";
import * as UsageService from "../usage/UsageService.ts";

interface ProgramAttemptRow {
  readonly attempt_id: string;
  readonly launch_request_id: string;
  readonly launch_input_json: string;
  readonly project_id: string;
  readonly thread_id: string | null;
  readonly run_id: string | null;
  readonly cancel_input_json: string | null;
  readonly acknowledge_input_json: string | null;
  readonly terminal_result_json: string | null;
  readonly terminal_acknowledged_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export {
  type ProgramAttemptError,
  ProgramAttemptInvalidRecordError,
  ProgramAttemptNotFoundError,
  ProgramAttemptOperationError,
  ProgramAttemptPersistenceError,
  ProgramAttemptRequestConflictError,
  ProgramAttemptStateError,
} from "./ProgramAttemptErrors.ts";

type TerminalRunEvent = Extract<OrchestrationV2DomainEvent, { readonly type: "run.updated" }>;
type SubagentRunEvent = Extract<
  OrchestrationV2DomainEvent,
  { readonly type: "subagent.updated" }
> & { readonly payload: OrchestrationV2Subagent & { readonly runId: RunId } };
type AttemptObservationEvent = TerminalRunEvent | SubagentRunEvent;

const isAttemptObservationEvent = (
  event: OrchestrationV2DomainEvent,
): event is AttemptObservationEvent =>
  (event.type === "subagent.updated" && event.payload.runId !== null) ||
  (event.type === "run.updated" &&
    ThreadManagementService.isTerminalRunStatus(event.payload.status));

const observationRunId = (event: AttemptObservationEvent): RunId =>
  event.type === "run.updated" ? event.payload.id : event.payload.runId;

function measureRuntimeUsage(
  projection: OrchestrationV2ThreadProjection,
  runId: RunId,
): ProgramAttemptRuntimeUsage {
  const run = projection.runs.find((candidate) => candidate.id === runId);
  const helpers = projection.subagents.filter((helper) => helper.runId === runId);
  const durableThreads = new Set([
    projection.thread.id,
    ...helpers.flatMap((helper) => (helper.childThreadId === null ? [] : [helper.childThreadId])),
  ]);
  const runAttemptIds = new Set(
    projection.attempts.filter((attempt) => attempt.runId === runId).map((attempt) => attempt.id),
  );
  const startedAt = run?.startedAt ?? run?.requestedAt ?? null;
  const completedAt = run?.completedAt ?? projection.updatedAt;
  const elapsedMillis =
    startedAt === null
      ? 0
      : Math.max(0, DateTime.toEpochMillis(completedAt) - DateTime.toEpochMillis(startedAt));
  return {
    activeThreads: durableThreads.size,
    nativeHelpers: helpers.filter((helper) => helper.origin === "provider_native").length,
    helperDepth: maximumHelperDepth(helpers),
    providerTurns: projection.providerTurns.filter(
      (turn) => turn.runAttemptId !== null && runAttemptIds.has(turn.runAttemptId),
    ).length,
    wallClockMinutes: Math.ceil(elapsedMillis / 60_000),
    tokens: null,
    costMilliUsd: null,
  };
}

export class ProgramAttemptService extends Context.Service<
  ProgramAttemptService,
  {
    readonly launch: (
      input: ProgramAttemptLaunchInput,
    ) => Effect.Effect<ProgramAttemptSnapshot, ProgramAttemptError>;
    readonly observe: (
      attemptId: ProgramAttemptId,
    ) => Effect.Effect<ProgramAttemptSnapshot, ProgramAttemptError>;
    readonly observeThread: (
      threadId: ThreadId,
    ) => Effect.Effect<ProgramAttemptSnapshot | null, ProgramAttemptError>;
    readonly cancel: (
      input: ProgramAttemptCancelInput,
    ) => Effect.Effect<ProgramAttemptSnapshot, ProgramAttemptError>;
    readonly acknowledge: (
      input: ProgramAttemptEffectInput,
    ) => Effect.Effect<ProgramAttemptSnapshot, ProgramAttemptError>;
    readonly terminalAttempts: Stream.Stream<ProgramAttemptSnapshot, ProgramAttemptError>;
    readonly retainProcessInterruptions: Effect.Effect<number, ProgramAttemptError>;
  }
>()("t3/orchestration-v2/ProgramAttemptService") {}

const decodeTerminalResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ProgramAttemptTerminalResultSchema),
);
const encodeTerminalResult = Schema.encodeEffect(
  Schema.fromJsonString(ProgramAttemptTerminalResultSchema),
);
const encodeLaunchInput = Schema.encodeEffect(
  Schema.fromJsonString(ProgramAttemptLaunchInputSchema),
);
const decodeLaunchInput = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ProgramAttemptLaunchInputSchema),
);
const encodeCancelInput = Schema.encodeEffect(
  Schema.fromJsonString(ProgramAttemptCancelInputSchema),
);
const encodeAcknowledgeInput = Schema.encodeEffect(
  Schema.fromJsonString(ProgramAttemptEffectInputSchema),
);

export const terminalResult = Effect.fn("ProgramAttemptService.terminalResult")(function* (
  attemptId: ProgramAttemptId,
  projection: OrchestrationV2ThreadProjection,
  runId: RunId,
) {
  const run = projection.runs.find((candidate) => candidate.id === runId);
  if (run === undefined) {
    return yield* new ProgramAttemptStateError({ attemptId, state: "run_missing", runId });
  }
  if (!ThreadManagementService.isTerminalRunStatus(run.status)) {
    return yield* new ProgramAttemptStateError({ attemptId, state: "run_not_terminal", runId });
  }
  const items = projection.turnItems.filter((item) => item.runId === runId);
  const output = items
    .filter((item) => item.type === "assistant_message" && item.status === "completed")
    .toSorted((left, right) => right.ordinal - left.ordinal)[0];
  const failure = items
    .filter((item) => item.type === "error")
    .toSorted((left, right) => right.ordinal - left.ordinal)[0];
  return {
    status: run.status,
    output: output?.type === "assistant_message" ? output.text : null,
    failure:
      failure?.type === "error" ? (failure.failure satisfies OrchestrationV2ProviderFailure) : null,
    completedAt: run.completedAt === null ? null : DateTime.formatIso(run.completedAt),
  } satisfies ProgramAttemptTerminalResult;
});

function peakHelperConcurrency(helpers: OrchestrationV2ThreadProjection["subagents"]): number {
  const events = helpers.flatMap((helper) => {
    if (helper.startedAt === null) return [];
    const startedAt = DateTime.toEpochMillis(helper.startedAt);
    return helper.completedAt === null
      ? [{ at: startedAt, delta: 1 }]
      : [
          { at: startedAt, delta: 1 },
          { at: DateTime.toEpochMillis(helper.completedAt), delta: -1 },
        ];
  });
  events.sort((left, right) => left.at - right.at || right.delta - left.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

function maximumHelperDepth(helpers: OrchestrationV2ThreadProjection["subagents"]): number {
  const byId = new Map<string, OrchestrationV2ThreadProjection["subagents"][number]>(
    helpers.map((helper) => [String(helper.id), helper]),
  );
  const retained = new Map<string, number>();
  const depth = (helperId: string, ancestors: ReadonlySet<string>): number => {
    const known = retained.get(helperId);
    if (known !== undefined) return known;
    if (ancestors.has(helperId)) return Number.MAX_SAFE_INTEGER;
    const helper = byId.get(helperId);
    if (helper === undefined) return 0;
    const parent = byId.get(String(helper.parentNodeId));
    const measured =
      parent === undefined ? 1 : 1 + depth(String(parent.id), new Set([...ancestors, helperId]));
    retained.set(helperId, measured);
    return measured;
  };
  return helpers.reduce(
    (maximum, helper) => Math.max(maximum, depth(String(helper.id), new Set())),
    0,
  );
}

function teamPolicyViolation(
  projection: OrchestrationV2ThreadProjection,
  runId: RunId,
  teamPolicy: ProgramTeamPolicy | undefined,
  requireCompleteTopology: boolean,
): string | null {
  const helpers = projection.subagents.filter((subagent) => subagent.runId === runId);
  const ownerRun = projection.runs.find((run) => run.id === runId);
  const providerInstances = new Set([
    ...(ownerRun === undefined ? [] : [ownerRun.providerInstanceId]),
    ...helpers.map((helper) => helper.providerInstanceId),
  ]);
  return teamPolicy?.mode === "solo" && helpers.length > 0
    ? "The solo Program Attempt used a helper."
    : teamPolicy !== undefined &&
        teamPolicy.mode !== "solo" &&
        helpers.length > teamPolicy.maxHelpers
      ? `The Program Attempt used ${helpers.length} helpers; its limit is ${teamPolicy.maxHelpers}.`
      : teamPolicy !== undefined &&
          teamPolicy.mode !== "solo" &&
          peakHelperConcurrency(helpers) > teamPolicy.maxConcurrent
        ? `The Program Attempt exceeded its concurrent helper limit of ${teamPolicy.maxConcurrent}.`
        : teamPolicy !== undefined &&
            teamPolicy.mode !== "solo" &&
            maximumHelperDepth(helpers) > teamPolicy.maxDepth
          ? `The Program Attempt exceeded its helper depth limit of ${teamPolicy.maxDepth}.`
          : teamPolicy?.mode === "native_collaborative" &&
              helpers.some((helper) => helper.origin !== "provider_native")
            ? "The native-collaborative Program Attempt used a non-native helper."
            : teamPolicy?.mode === "delegated" &&
                helpers.some((helper) => helper.origin !== "app_owned")
              ? "The delegated Program Attempt used a non-app-owned helper."
              : requireCompleteTopology &&
                  teamPolicy?.mode === "layered_hybrid" &&
                  (!helpers.some((helper) => helper.origin === "app_owned") ||
                    !helpers.some((helper) => helper.origin === "provider_native"))
                ? "The layered-hybrid Program Attempt did not retain both helper layers."
                : requireCompleteTopology &&
                    teamPolicy?.mode === "delegated" &&
                    !helpers.some((helper) => helper.origin === "app_owned")
                  ? "The delegated Program Attempt did not retain an app-owned helper."
                  : requireCompleteTopology &&
                      teamPolicy?.mode === "native_collaborative" &&
                      !helpers.some((helper) => helper.origin === "provider_native")
                    ? "The native-collaborative Program Attempt did not retain a native helper."
                    : requireCompleteTopology &&
                        teamPolicy?.mode === "cross_provider" &&
                        providerInstances.size < 2
                      ? "The cross-provider Program Attempt used fewer than two provider instances."
                      : null;
}

function teamPolicyFailure(
  result: ProgramAttemptTerminalResult,
  violation: string,
): ProgramAttemptTerminalResult {
  return {
    status: "failed",
    output: result.output,
    failure: {
      class: "validation_error",
      message: violation,
      code: "program_team_policy_violation",
      retryable: false,
    },
    completedAt: result.completedAt,
  };
}

function enforceTeamPolicy(
  result: ProgramAttemptTerminalResult,
  projection: OrchestrationV2ThreadProjection,
  runId: RunId,
  teamPolicy: ProgramTeamPolicy | undefined,
): ProgramAttemptTerminalResult {
  const violation = teamPolicyViolation(projection, runId, teamPolicy, true);
  if (violation !== null) {
    return teamPolicyFailure(result, violation);
  }
  return result;
}

function launchPrompt(input: ProgramAttemptLaunchInput): string {
  const needsNativeHelper =
    input.teamPolicy?.mode === "native_collaborative" ||
    input.teamPolicy?.mode === "layered_hybrid";
  return needsNativeHelper
    ? [
        "You must create at least one provider-native helper for this Program Attempt; do not finish until that helper has settled.",
        input.prompt,
      ].join("\n\n")
    : input.prompt;
}

export const layer = Layer.effect(
  ProgramAttemptService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const launches = yield* ThreadLaunchService.ThreadLaunchService;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const resourceTelemetry = yield* ResourceTelemetry.ResourceTelemetry;
    const usage = yield* UsageService.UsageService;

    const now = DateTime.now.pipe(Effect.map((value) => DateTime.formatIso(value)));

    const load = Effect.fn("ProgramAttemptService.load")(function* (attemptId: ProgramAttemptId) {
      const rows = yield* sql<ProgramAttemptRow>`
        SELECT * FROM program_attempts WHERE attempt_id = ${attemptId}
      `.pipe(
        Effect.mapError(
          (cause) => new ProgramAttemptPersistenceError({ attemptId, operation: "load", cause }),
        ),
      );
      const row = rows[0];
      if (row === undefined) {
        return yield* new ProgramAttemptNotFoundError({ attemptId });
      }
      return row;
    });

    const persistTerminal = Effect.fn("ProgramAttemptService.persistTerminal")(function* (
      row: ProgramAttemptRow,
      result: ProgramAttemptTerminalResult,
    ) {
      const updatedAt = yield* now;
      const encoded = yield* encodeTerminalResult(result).pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptInvalidRecordError({
              attemptId: ProgramAttemptId.make(row.attempt_id),
              operation: "encode_terminal",
              cause,
            }),
        ),
      );
      yield* sql`
        UPDATE program_attempts
        SET terminal_result_json = COALESCE(terminal_result_json, ${encoded}),
            updated_at = ${updatedAt}
        WHERE attempt_id = ${row.attempt_id}
      `.pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptPersistenceError({
              attemptId: ProgramAttemptId.make(row.attempt_id),
              operation: "persist_terminal",
              cause,
            }),
        ),
      );
      return yield* load(ProgramAttemptId.make(row.attempt_id));
    });

    const measureAttemptRuntimeUsage = Effect.fn("ProgramAttemptService.measureRuntimeUsage")(
      function* (projection: OrchestrationV2ThreadProjection, runId: RunId, worktreePath: string) {
        const measured = measureRuntimeUsage(projection, runId);
        const run = projection.runs.find((candidate) => candidate.id === runId);
        const providerThreadIds = new Set(
          [
            run?.providerThreadId ?? null,
            ...projection.attempts
              .filter((attempt) => attempt.runId === runId)
              .map((attempt) => attempt.providerThreadId),
            ...projection.subagents
              .filter((helper) => helper.runId === runId)
              .map((helper) => helper.providerThreadId),
          ].filter(
            (providerThreadId): providerThreadId is NonNullable<typeof providerThreadId> =>
              providerThreadId !== null,
          ),
        );
        const sessionIds = projection.providerThreads.flatMap((providerThread) =>
          providerThreadIds.has(providerThread.id) &&
          providerThread.nativeThreadRef?.nativeId !== null &&
          providerThread.nativeThreadRef?.nativeId !== undefined
            ? [providerThread.nativeThreadRef.nativeId]
            : [],
        );
        const startedAt = run?.startedAt ?? run?.requestedAt ?? null;
        const completedAt = run?.completedAt ?? projection.updatedAt;
        const providerUsage =
          startedAt === null
            ? null
            : yield* usage
                .readSessionUsage({
                  sessionIds,
                  sinceMs: DateTime.toEpochMillis(startedAt),
                  untilMs: DateTime.toEpochMillis(completedAt),
                })
                .pipe(Effect.catchCause(() => Effect.succeed(null)));
        const telemetry = yield* resourceTelemetry.latest.pipe(
          Effect.catchCause(() => Effect.succeed(null)),
        );
        const processes =
          telemetry === null || worktreePath.length === 0
            ? []
            : telemetry.processes.filter((process) => process.command.includes(worktreePath));
        const mebibyte = 1_048_576;
        return {
          ...measured,
          tokens: providerUsage?.tokens ?? null,
          costMilliUsd: providerUsage?.costMilliUsd ?? null,
          ...(processes.length === 0
            ? {}
            : {
                cpuMillis: processes.reduce((sum, process) => sum + process.cpuTimeMs, 0),
                memoryMiB: Math.ceil(
                  processes.reduce((sum, process) => sum + process.peakResidentBytes, 0) / mebibyte,
                ),
                diskMiB: Math.ceil(
                  processes.reduce(
                    (sum, process) => sum + process.ioReadBytes + process.ioWriteBytes,
                    0,
                  ) / mebibyte,
                ),
              }),
        } satisfies ProgramAttemptRuntimeUsage;
      },
    );

    const ensureAppOwnedTeamLayer = Effect.fn("ProgramAttemptService.ensureAppOwnedTeamLayer")(
      function* (
        attemptId: ProgramAttemptId,
        launchInput: ProgramAttemptLaunchInput,
        projection: OrchestrationV2ThreadProjection,
        runId: RunId,
      ) {
        const teamPolicy = launchInput.teamPolicy;
        if (
          teamPolicy === undefined ||
          !["delegated", "cross_provider", "layered_hybrid"].includes(teamPolicy.mode) ||
          projection.subagents.some(
            (helper) => helper.runId === runId && helper.origin === "app_owned",
          )
        ) {
          return;
        }
        const run = projection.runs.find((candidate) => candidate.id === runId);
        if (run?.rootNodeId === null || run?.rootNodeId === undefined) return;
        const modelSelection =
          teamPolicy.mode === "cross_provider"
            ? yield* providers.getProviders.pipe(
                Effect.flatMap((available) => {
                  const alternate = available
                    .filter(
                      (provider) =>
                        provider.instanceId !==
                          launchInput.providerPolicy.modelSelection.instanceId &&
                        provider.enabled &&
                        provider.installed &&
                        provider.status === "ready" &&
                        provider.auth.status === "authenticated" &&
                        provider.availability !== "unavailable" &&
                        provider.models.length > 0,
                    )
                    .toSorted((left, right) => left.instanceId.localeCompare(right.instanceId))[0];
                  const model =
                    alternate?.models.find((candidate) => candidate.isDefault === true) ??
                    alternate?.models[0];
                  return alternate === undefined || model === undefined
                    ? Effect.fail(
                        new ProgramAttemptOperationError({
                          attemptId,
                          operation: "launch",
                          cause: new Error(
                            "No different ready provider is available for the cross-provider Program Attempt.",
                          ),
                        }),
                      )
                    : Effect.succeed({ instanceId: alternate.instanceId, model: model.slug });
                }),
              )
            : launchInput.providerPolicy.modelSelection;
        yield* threads
          .dispatch({
            type: "delegated_task.request",
            commandId: CommandId.make(`program-attempt:${attemptId}:app-owned-helper`),
            parentThreadId: projection.thread.id,
            parentRunId: runId,
            parentNodeId: run.rootNodeId,
            task: [
              "Act as the required app-owned helper for this bounded Program Attempt.",
              "Return concrete findings and evidence to the accountable owner without widening scope.",
              launchInput.prompt,
            ].join("\n\n"),
            title: `${launchInput.title} helper`,
            modelSelection,
            runtimeMode: launchInput.providerPolicy.runtimeMode,
            interactionMode: launchInput.providerPolicy.interactionMode,
            completionWake: "always",
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProgramAttemptOperationError({ attemptId, operation: "launch", cause }),
            ),
          );
      },
    );

    const snapshot = Effect.fn("ProgramAttemptService.snapshot")(function* (
      initialRow: ProgramAttemptRow,
    ) {
      const attemptId = ProgramAttemptId.make(initialRow.attempt_id);
      const launchInput = yield* decodeLaunchInput(initialRow.launch_input_json).pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptInvalidRecordError({
              attemptId,
              operation: "decode_launch",
              cause,
            }),
        ),
      );
      if (initialRow.thread_id === null || initialRow.run_id === null) {
        return yield* new ProgramAttemptStateError({
          attemptId,
          state: "launch_receipt_missing",
        });
      }
      const threadId = ThreadId.make(initialRow.thread_id);
      const runId = RunId.make(initialRow.run_id);
      const projection = yield* threads
        .getThreadProjection(threadId)
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProgramAttemptOperationError({ attemptId, operation: "projection", cause }),
          ),
        );
      const run = projection.runs.find((candidate) => candidate.id === runId);
      if (run === undefined) {
        return yield* new ProgramAttemptStateError({ attemptId, state: "run_missing", runId });
      }
      let row = initialRow;
      if (
        !ThreadManagementService.isTerminalRunStatus(run.status) &&
        row.terminal_result_json === null
      ) {
        const violation = teamPolicyViolation(projection, runId, launchInput.teamPolicy, false);
        if (violation !== null) {
          yield* threads
            .interruptThread({
              projectId: ProjectId.make(row.project_id),
              commandId: CommandId.make(`program-attempt:${attemptId}:team-policy-stop`),
              threadId,
              runId,
              reason: violation,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ProgramAttemptOperationError({
                    attemptId,
                    operation: "cancel",
                    cause,
                  }),
              ),
            );
          yield* threads
            .waitForThread({
              projectId: ProjectId.make(row.project_id),
              threadId,
              runId,
              timeoutMs: 30_000,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ProgramAttemptOperationError({
                    attemptId,
                    operation: "cancel",
                    cause,
                  }),
              ),
            );
          const completedAt = yield* now;
          row = yield* persistTerminal(
            row,
            teamPolicyFailure(
              { status: "failed", output: null, failure: null, completedAt },
              violation,
            ),
          );
        }
      }
      if (row.terminal_result_json === null) {
        yield* ensureAppOwnedTeamLayer(attemptId, launchInput, projection, runId);
      }
      if (
        ThreadManagementService.isTerminalRunStatus(run.status) &&
        row.terminal_result_json === null
      ) {
        const result = yield* terminalResult(attemptId, projection, runId);
        row = yield* persistTerminal(
          row,
          enforceTeamPolicy(result, projection, runId, launchInput.teamPolicy),
        );
      }
      const retained =
        row.terminal_result_json === null
          ? null
          : yield* decodeTerminalResult(row.terminal_result_json).pipe(
              Effect.mapError(
                (cause) =>
                  new ProgramAttemptInvalidRecordError({
                    attemptId,
                    operation: "decode_terminal",
                    cause,
                  }),
              ),
            );
      return {
        attemptId,
        programId: launchInput.programId ?? null,
        taskId: launchInput.taskId ?? null,
        attemptKind: launchInput.attemptKind ?? null,
        candidateId: launchInput.candidateId ?? null,
        reviewId: launchInput.reviewId ?? null,
        reviewKind: launchInput.reviewKind ?? null,
        ...(launchInput.teamPolicy === undefined ? {} : { teamPolicy: launchInput.teamPolicy }),
        title: launchInput.title,
        checkout: launchInput.checkout,
        projectId: ProjectId.make(row.project_id),
        threadId,
        runId,
        state: retained !== null ? "terminal" : run.status === "preparing" ? "preparing" : "active",
        runStatus: run.status,
        terminalResult:
          row.terminal_acknowledged_at === null
            ? (retained as ProgramAttemptTerminalResult | null)
            : null,
        terminalAcknowledged: row.terminal_acknowledged_at !== null,
        runtimeUsage: yield* measureAttemptRuntimeUsage(
          projection,
          runId,
          launchInput.checkout.worktreePath,
        ),
      } satisfies ProgramAttemptSnapshot as ProgramAttemptSnapshot;
    });

    const observe: ProgramAttemptService["Service"]["observe"] = Effect.fn(
      "ProgramAttemptService.observe",
    )(function* (attemptId) {
      return yield* snapshot(yield* load(attemptId));
    });

    const observeThread: ProgramAttemptService["Service"]["observeThread"] = Effect.fn(
      "ProgramAttemptService.observeThread",
    )(function* (threadId) {
      const lookupId = ProgramAttemptId.make(`program-attempt:thread:${threadId}`);
      const visible = yield* threads
        .getThreadProjection(threadId)
        .pipe(Effect.exit, Effect.map(Exit.isSuccess));
      if (!visible) return null;
      return yield* retryProgramAttemptReceipt(() =>
        sql<ProgramAttemptRow>`
          SELECT * FROM program_attempts
          WHERE thread_id = ${threadId}
          ORDER BY created_at DESC
          LIMIT 1
        `.pipe(
          Effect.mapError(
            (cause) =>
              new ProgramAttemptPersistenceError({
                attemptId: lookupId,
                operation: "load_for_thread",
                cause,
              }),
          ),
          Effect.flatMap((rows) =>
            rows[0] === undefined ? Effect.succeed(null) : snapshot(rows[0]),
          ),
        ),
      );
    });

    const retainedTerminalSnapshot = Effect.fn("ProgramAttemptService.retainedTerminalSnapshot")(
      function* (row: ProgramAttemptRow) {
        const attemptId = ProgramAttemptId.make(row.attempt_id);
        if (
          row.thread_id === null ||
          row.run_id === null ||
          row.terminal_result_json === null ||
          row.terminal_acknowledged_at !== null
        ) {
          return null;
        }
        const launchInput = yield* decodeLaunchInput(row.launch_input_json).pipe(
          Effect.mapError(
            (cause) =>
              new ProgramAttemptInvalidRecordError({
                attemptId,
                operation: "decode_launch",
                cause,
              }),
          ),
        );
        const terminalResult = yield* decodeTerminalResult(row.terminal_result_json).pipe(
          Effect.mapError(
            (cause) =>
              new ProgramAttemptInvalidRecordError({
                attemptId,
                operation: "decode_terminal",
                cause,
              }),
          ),
        );
        return {
          attemptId,
          programId: launchInput.programId ?? null,
          taskId: launchInput.taskId ?? null,
          attemptKind: launchInput.attemptKind ?? null,
          candidateId: launchInput.candidateId ?? null,
          reviewId: launchInput.reviewId ?? null,
          reviewKind: launchInput.reviewKind ?? null,
          ...(launchInput.teamPolicy === undefined ? {} : { teamPolicy: launchInput.teamPolicy }),
          title: launchInput.title,
          checkout: launchInput.checkout,
          projectId: ProjectId.make(row.project_id),
          threadId: ThreadId.make(row.thread_id),
          runId: RunId.make(row.run_id),
          state: "terminal",
          runStatus: terminalResult.status,
          terminalResult,
          terminalAcknowledged: false,
        } satisfies ProgramAttemptSnapshot as ProgramAttemptSnapshot;
      },
    );

    const scanRetainedTerminalAttempts = Effect.suspend(() =>
      sql<ProgramAttemptRow>`
        SELECT * FROM program_attempts
        WHERE terminal_result_json IS NOT NULL AND terminal_acknowledged_at IS NULL
        ORDER BY updated_at ASC
      `.pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptPersistenceError({
              attemptId: ProgramAttemptId.make("program-attempt:terminal-scan"),
              operation: "scan_terminal_outbox",
              cause,
            }),
        ),
        Effect.flatMap((rows) => Effect.forEach(rows, retainedTerminalSnapshot)),
        Effect.map(
          (attempts): Array<ProgramAttemptSnapshot> =>
            attempts.flatMap((attempt) => (attempt === null ? [] : [attempt])),
        ),
      ),
    );

    const terminalAttempts: ProgramAttemptService["Service"]["terminalAttempts"] = Stream.merge(
      threads.streamDomainEvents.pipe(
        Stream.mapError(
          (cause) =>
            new ProgramAttemptOperationError({
              attemptId: ProgramAttemptId.make("program-attempt:terminal-stream"),
              operation: "projection",
              cause,
            }),
        ),
        Stream.filter(isAttemptObservationEvent),
        Stream.mapEffect((event) => {
          const observedRunId = observationRunId(event);
          const lookupId = ProgramAttemptId.make(`program-attempt:run:${observedRunId}`);
          return retryProgramAttemptReceipt(() =>
            sql<ProgramAttemptRow>`
              SELECT * FROM program_attempts
              WHERE thread_id = ${event.threadId} AND run_id = ${observedRunId}
              ORDER BY created_at DESC
              LIMIT 1
            `.pipe(
              Effect.mapError(
                (cause) =>
                  new ProgramAttemptPersistenceError({
                    attemptId: lookupId,
                    operation: "load_for_thread",
                    cause,
                  }),
              ),
              Effect.flatMap((rows) =>
                rows[0] === undefined ? Effect.succeed(null) : snapshot(rows[0]),
              ),
            ),
          );
        }),
        Stream.filter(
          (attempt): attempt is ProgramAttemptSnapshot =>
            attempt !== null && attempt.state === "terminal",
        ),
        Stream.retry(Schedule.exponential("250 millis")),
      ),
      Stream.fromEffect(scanRetainedTerminalAttempts).pipe(
        Stream.retry(Schedule.exponential("250 millis")),
        Stream.repeat(Schedule.spaced("1 second")),
        Stream.flatMap(Stream.fromIterable),
      ),
    );

    const retainProcessInterruptions: ProgramAttemptService["Service"]["retainProcessInterruptions"] =
      Effect.gen(function* () {
        const recoveryId = ProgramAttemptId.make("program-attempt:process-recovery");
        const rows = yield* sql<ProgramAttemptRow>`
          SELECT * FROM program_attempts
          WHERE terminal_result_json IS NULL AND thread_id IS NOT NULL AND run_id IS NOT NULL
        `.pipe(
          Effect.mapError(
            (cause) =>
              new ProgramAttemptPersistenceError({
                attemptId: recoveryId,
                operation: "load_live",
                cause,
              }),
          ),
        );
        let retained = 0;
        for (const row of rows) {
          const projection = yield* threads.getThreadProjection(ThreadId.make(row.thread_id!)).pipe(
            Effect.mapError(
              (cause) =>
                new ProgramAttemptOperationError({
                  attemptId: ProgramAttemptId.make(row.attempt_id),
                  operation: "recovery_projection",
                  cause,
                }),
            ),
          );
          const run = projection.runs.find((candidate) => candidate.id === row.run_id);
          if (run === undefined || ThreadManagementService.isTerminalRunStatus(run.status))
            continue;
          const completedAt = yield* now;
          yield* persistTerminal(row, {
            status: "interrupted",
            output: null,
            failure: {
              class: "transport_error",
              message: "T3 restarted before the Program Attempt completed.",
              code: "t3_restart_interrupted",
              retryable: true,
            },
            completedAt,
          });
          retained += 1;
        }
        return retained;
      });

    const launch: ProgramAttemptService["Service"]["launch"] = Effect.fn(
      "ProgramAttemptService.launch",
    )(function* (input) {
      const inputJson = yield* encodeLaunchInput(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptInvalidRecordError({
              attemptId: input.attemptId,
              operation: "encode_launch",
              cause,
            }),
        ),
      );
      const timestamp = yield* now;
      yield* sql`
        INSERT INTO program_attempts (
          attempt_id, launch_request_id, launch_input_json,
          project_id, created_at, updated_at
        ) VALUES (
          ${input.attemptId}, ${input.requestId}, ${inputJson},
          ${input.projectId}, ${timestamp}, ${timestamp}
        ) ON CONFLICT(attempt_id) DO NOTHING
      `.pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptPersistenceError({
              attemptId: input.attemptId,
              operation: "persist_launch_intent",
              cause,
            }),
        ),
      );
      const row = yield* load(input.attemptId);
      if (row.launch_input_json !== inputJson) {
        return yield* new ProgramAttemptRequestConflictError({
          attemptId: input.attemptId,
          request: "launch",
        });
      }
      const launched = yield* launches
        .launch({
          commandId: CommandId.make(`program-attempt:${input.attemptId}:launch`),
          ...(input.threadId === undefined
            ? {}
            : { threadId: input.threadId, reuseExistingThread: true }),
          projectId: input.projectId,
          title: input.title,
          generateTitle: false,
          modelSelection: input.providerPolicy.modelSelection,
          runtimeMode: input.providerPolicy.runtimeMode,
          interactionMode: input.providerPolicy.interactionMode,
          workspaceStrategy: { type: "prepared_worktree", ...input.checkout },
          initialMessage: { text: launchPrompt(input), attachments: [] },
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProgramAttemptOperationError({
                attemptId: input.attemptId,
                operation: "launch",
                cause,
              }),
          ),
        );
      if (launched.runId === null) {
        return yield* new ProgramAttemptStateError({
          attemptId: input.attemptId,
          state: "run_missing",
        });
      }
      const updatedAt = yield* now;
      yield* sql`
        UPDATE program_attempts
        SET thread_id = COALESCE(thread_id, ${launched.threadId}),
            run_id = COALESCE(run_id, ${launched.runId}),
            updated_at = ${updatedAt}
        WHERE attempt_id = ${input.attemptId}
      `.pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptPersistenceError({
              attemptId: input.attemptId,
              operation: "persist_launch_receipt",
              cause,
            }),
        ),
      );
      const persisted = yield* load(input.attemptId);
      if (persisted.thread_id !== launched.threadId || persisted.run_id !== launched.runId) {
        return yield* new ProgramAttemptInvalidRecordError({
          attemptId: input.attemptId,
          operation: "launch_receipt_mismatch",
        });
      }
      return yield* snapshot(persisted);
    });

    const bindEffectInput = Effect.fn("ProgramAttemptService.bindEffectInput")(function* (
      attemptId: ProgramAttemptId,
      column: "cancel_input_json" | "acknowledge_input_json",
      inputJson: string,
    ) {
      const updatedAt = yield* now;
      const query =
        column === "cancel_input_json"
          ? sql`
              UPDATE program_attempts
              SET cancel_input_json = COALESCE(cancel_input_json, ${inputJson}), updated_at = ${updatedAt}
              WHERE attempt_id = ${attemptId}
            `
          : sql`
              UPDATE program_attempts
              SET acknowledge_input_json = COALESCE(acknowledge_input_json, ${inputJson}), updated_at = ${updatedAt}
              WHERE attempt_id = ${attemptId}
            `;
      yield* query.pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptPersistenceError({
              attemptId,
              operation: "persist_effect_intent",
              cause,
            }),
        ),
      );
      const row = yield* load(attemptId);
      const bound =
        column === "cancel_input_json" ? row.cancel_input_json : row.acknowledge_input_json;
      if (bound !== inputJson) {
        return yield* new ProgramAttemptRequestConflictError({
          attemptId,
          request: column === "cancel_input_json" ? "cancel" : "acknowledge",
        });
      }
      return row;
    });

    const cancel: ProgramAttemptService["Service"]["cancel"] = Effect.fn(
      "ProgramAttemptService.cancel",
    )(function* (input) {
      let row = yield* load(input.attemptId);
      if (row.thread_id === null || row.run_id === null) {
        return yield* new ProgramAttemptStateError({
          attemptId: input.attemptId,
          state: "cancel_run_missing",
        });
      }
      const inputJson = yield* encodeCancelInput(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptInvalidRecordError({
              attemptId: input.attemptId,
              operation: "encode_cancel",
              cause,
            }),
        ),
      );
      row = yield* bindEffectInput(input.attemptId, "cancel_input_json", inputJson);
      if (row.thread_id === null || row.run_id === null) {
        return yield* new ProgramAttemptStateError({
          attemptId: input.attemptId,
          state: "cancel_run_missing",
        });
      }
      yield* threads
        .interruptThread({
          projectId: ProjectId.make(row.project_id),
          commandId: CommandId.make(`program-attempt:${input.attemptId}:cancel`),
          threadId: ThreadId.make(row.thread_id),
          runId: RunId.make(row.run_id),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProgramAttemptOperationError({
                attemptId: input.attemptId,
                operation: "cancel",
                cause,
              }),
          ),
        );
      yield* threads
        .waitForThread({
          projectId: ProjectId.make(row.project_id),
          threadId: ThreadId.make(row.thread_id),
          runId: RunId.make(row.run_id),
          timeoutMs: 30_000,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProgramAttemptOperationError({
                attemptId: input.attemptId,
                operation: "cancel",
                cause,
              }),
          ),
        );
      const cancelled = yield* snapshot(yield* load(input.attemptId));
      if (cancelled.state !== "terminal") {
        return yield* new ProgramAttemptStateError({
          attemptId: input.attemptId,
          state: "cancel_not_terminal",
          runId: RunId.make(row.run_id),
        });
      }
      return cancelled;
    });

    const acknowledge: ProgramAttemptService["Service"]["acknowledge"] = Effect.fn(
      "ProgramAttemptService.acknowledge",
    )(function* (input) {
      let row = yield* load(input.attemptId);
      const before = yield* snapshot(row);
      if (before.state !== "terminal") {
        return yield* new ProgramAttemptStateError({
          attemptId: input.attemptId,
          state: "attempt_not_terminal",
        });
      }
      const inputJson = yield* encodeAcknowledgeInput(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptInvalidRecordError({
              attemptId: input.attemptId,
              operation: "encode_acknowledgement",
              cause,
            }),
        ),
      );
      row = yield* bindEffectInput(input.attemptId, "acknowledge_input_json", inputJson);
      const acknowledgedAt = yield* now;
      yield* sql`
        UPDATE program_attempts
        SET terminal_acknowledged_at = COALESCE(terminal_acknowledged_at, ${acknowledgedAt}),
            updated_at = ${acknowledgedAt}
        WHERE attempt_id = ${input.attemptId}
      `.pipe(
        Effect.mapError(
          (cause) =>
            new ProgramAttemptPersistenceError({
              attemptId: input.attemptId,
              operation: "acknowledge",
              cause,
            }),
        ),
      );
      return yield* snapshot(yield* load(input.attemptId));
    });

    return ProgramAttemptService.of({
      launch,
      observe,
      observeThread,
      cancel,
      acknowledge,
      terminalAttempts,
      retainProcessInterruptions,
    });
  }),
);
export function retryProgramAttemptReceipt<A, E, R>(
  lookup: () => Effect.Effect<A | null, E, R>,
  options: { readonly attempts?: number; readonly delay?: Effect.Effect<void> } = {},
): Effect.Effect<A | null, E, R> {
  const attempts = options.attempts ?? 12;
  const delay = options.delay ?? Effect.sleep("250 millis");
  return Effect.gen(function* () {
    for (let index = 0; index < attempts; index += 1) {
      const result = yield* lookup();
      if (result !== null || index === attempts - 1) return result;
      yield* delay;
    }
    return null;
  });
}
