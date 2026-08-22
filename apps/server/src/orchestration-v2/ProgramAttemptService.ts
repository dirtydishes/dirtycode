import {
  CommandId,
  type OrchestrationV2DomainEvent,
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
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ThreadLaunchService from "./ThreadLaunchService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

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

export class ProgramAttemptNotFoundError extends Schema.TaggedErrorClass<ProgramAttemptNotFoundError>()(
  "ProgramAttemptNotFoundError",
  { attemptId: ProgramAttemptId },
) {
  override get message(): string {
    return `Program Attempt ${this.attemptId} was not found.`;
  }
}

export class ProgramAttemptRequestConflictError extends Schema.TaggedErrorClass<ProgramAttemptRequestConflictError>()(
  "ProgramAttemptRequestConflictError",
  {
    attemptId: ProgramAttemptId,
    request: Schema.Literals(["launch", "cancel", "acknowledge"]),
  },
) {
  override get message(): string {
    return this.request === "launch"
      ? "This Attempt ID is already bound to a different launch request."
      : "This Attempt effect is already bound to a different request.";
  }
}

export class ProgramAttemptStateError extends Schema.TaggedErrorClass<ProgramAttemptStateError>()(
  "ProgramAttemptStateError",
  {
    attemptId: ProgramAttemptId,
    state: Schema.Literals([
      "launch_receipt_missing",
      "cancel_run_missing",
      "cancel_not_terminal",
      "run_missing",
      "run_not_terminal",
      "attempt_not_terminal",
    ]),
    runId: Schema.optional(RunId),
  },
) {
  override get message(): string {
    switch (this.state) {
      case "launch_receipt_missing":
        return "The launch intent exists but the thread and run receipt are not recorded yet.";
      case "cancel_run_missing":
        return "The Attempt has no run to cancel.";
      case "cancel_not_terminal":
        return "T3 did not acknowledge a terminal run before the cancellation wait ended.";
      case "run_missing":
        return this.runId === undefined
          ? "T3 accepted the Program Attempt without a durable run."
          : `Run ${this.runId} is missing from the thread.`;
      case "run_not_terminal":
        return `Run ${this.runId} is not terminal.`;
      case "attempt_not_terminal":
        return "A Program Attempt can be acknowledged only after it reaches a terminal state.";
    }
  }
}

export class ProgramAttemptPersistenceError extends Schema.TaggedErrorClass<ProgramAttemptPersistenceError>()(
  "ProgramAttemptPersistenceError",
  {
    attemptId: ProgramAttemptId,
    operation: Schema.Literals([
      "load",
      "load_for_thread",
      "load_live",
      "persist_terminal",
      "persist_launch_intent",
      "persist_launch_receipt",
      "persist_effect_intent",
      "acknowledge",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "load":
        return "Could not load the Program Attempt.";
      case "load_for_thread":
        return "Could not load the Program Attempt for this thread.";
      case "load_live":
        return "Could not load live Program Attempts.";
      case "persist_terminal":
        return "Could not retain the terminal result.";
      case "persist_launch_intent":
        return "Could not persist the launch intent.";
      case "persist_launch_receipt":
        return "Could not persist the launch receipt.";
      case "persist_effect_intent":
        return "Could not persist the effect intent.";
      case "acknowledge":
        return "Could not acknowledge the terminal result.";
    }
  }
}

export class ProgramAttemptOperationError extends Schema.TaggedErrorClass<ProgramAttemptOperationError>()(
  "ProgramAttemptOperationError",
  {
    attemptId: ProgramAttemptId,
    operation: Schema.Literals(["launch", "projection", "recovery_projection", "cancel"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "launch":
        return "T3 could not launch the Program Attempt.";
      case "projection":
        return "Could not load the Attempt thread.";
      case "recovery_projection":
        return "Could not load a live Program Attempt before process recovery.";
      case "cancel":
        return "T3 could not cancel the Program Attempt.";
    }
  }
}

export class ProgramAttemptInvalidRecordError extends Schema.TaggedErrorClass<ProgramAttemptInvalidRecordError>()(
  "ProgramAttemptInvalidRecordError",
  {
    attemptId: ProgramAttemptId,
    operation: Schema.Literals([
      "encode_terminal",
      "decode_launch",
      "decode_terminal",
      "encode_launch",
      "launch_receipt_mismatch",
      "encode_cancel",
      "encode_acknowledgement",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "encode_terminal":
        return "Could not encode the terminal result.";
      case "decode_launch":
        return "The retained launch request is invalid.";
      case "decode_terminal":
        return "The retained terminal result is invalid.";
      case "encode_launch":
        return "Could not encode the launch request.";
      case "launch_receipt_mismatch":
        return "The durable launch receipt does not match T3's idempotent launch receipt.";
      case "encode_cancel":
        return "Could not encode the cancel request.";
      case "encode_acknowledgement":
        return "Could not encode the acknowledgement request.";
    }
  }
}

export type ProgramAttemptError =
  | ProgramAttemptNotFoundError
  | ProgramAttemptRequestConflictError
  | ProgramAttemptStateError
  | ProgramAttemptPersistenceError
  | ProgramAttemptOperationError
  | ProgramAttemptInvalidRecordError;

type TerminalRunEvent = Extract<OrchestrationV2DomainEvent, { readonly type: "run.updated" }>;

const isTerminalRunEvent = (event: OrchestrationV2DomainEvent): event is TerminalRunEvent =>
  event.type === "run.updated" && ThreadManagementService.isTerminalRunStatus(event.payload.status);

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

export const layer = Layer.effect(
  ProgramAttemptService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const launches = yield* ThreadLaunchService.ThreadLaunchService;
    const threads = yield* ThreadManagementService.ThreadManagementService;

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
        ThreadManagementService.isTerminalRunStatus(run.status) &&
        row.terminal_result_json === null
      ) {
        row = yield* persistTerminal(row, yield* terminalResult(attemptId, projection, runId));
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
      } satisfies ProgramAttemptSnapshot;
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

    const terminalAttempts: ProgramAttemptService["Service"]["terminalAttempts"] =
      threads.streamDomainEvents.pipe(
        Stream.mapError(
          (cause) =>
            new ProgramAttemptOperationError({
              attemptId: ProgramAttemptId.make("program-attempt:terminal-stream"),
              operation: "projection",
              cause,
            }),
        ),
        Stream.filter(isTerminalRunEvent),
        Stream.mapEffect((event) => {
          const lookupId = ProgramAttemptId.make(`program-attempt:run:${event.payload.id}`);
          return retryProgramAttemptReceipt(() =>
            sql<ProgramAttemptRow>`
              SELECT * FROM program_attempts
              WHERE thread_id = ${event.threadId} AND run_id = ${event.payload.id}
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
        Stream.filter((attempt): attempt is ProgramAttemptSnapshot => attempt !== null),
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
          initialMessage: { text: input.prompt, attachments: [] },
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
