import {
  ProgramAttemptId,
  type ProgramAttachment,
  type ProgramCommandDecision,
  type ProgramEffect,
  ProgramEffectId,
  ProgramEventId,
  ProgramId,
  type ProgramListSnapshot,
  type ProgramPhaseProjection,
  ProgramPhaseId,
  ProgramReceiptId,
  ProgramRequestId,
  type ProgramSnapshot,
  type ProgramState,
  type ProgramSummary,
  ProgramWakeId,
  type ReadProgramInput,
  type ReconcileProgramInput,
  type ResumeProgramInput,
  type RuntimeReceipt,
  type StartProgramInput,
  type StopProgramInput,
  ThreadId,
  type PauseProgramInput,
  type ProgramDriverDecision,
  type ProgramProjection,
  type WakeProgramInput,
  PauseProgramInput as PauseProgramInputSchema,
  ResumeProgramInput as ResumeProgramInputSchema,
  StartProgramInput as StartProgramInputSchema,
  StopProgramInput as StopProgramInputSchema,
  WakeProgramInput as WakeProgramInputSchema,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeKeyedSerialExecutor } from "./KeyedSerialExecutor.ts";
import { randomUuidV4 } from "./RandomUuid.ts";
import {
  makeProgramStore,
  ProgramStoreError,
  ProgramStoreLeaseError,
  type ClaimedProgramWake,
  type ProgramRecord,
  type ProgramStoreShape,
} from "./ProgramStore.ts";

export class ProgramNotFoundError extends Schema.TaggedErrorClass<ProgramNotFoundError>()(
  "ProgramNotFoundError",
  { programId: ProgramId },
) {
  override get message(): string {
    return `Program ${this.programId} was not found.`;
  }
}

export class ProgramEffectExecutionError extends Schema.TaggedErrorClass<ProgramEffectExecutionError>()(
  "ProgramEffectExecutionError",
  {
    programId: ProgramId,
    effectId: ProgramEffectId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `T3 could not execute Program effect ${this.effectId}.`;
  }
}

export class ProgramRuntimeHookError extends Schema.TaggedErrorClass<ProgramRuntimeHookError>()(
  "ProgramRuntimeHookError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The Program runtime stopped at an injected recovery boundary.";
  }
}

export type ProgramRuntimeError =
  | ProgramNotFoundError
  | ProgramEffectExecutionError
  | ProgramRuntimeHookError
  | ProgramStoreError
  | ProgramStoreLeaseError;

export interface DirtyloopsProgramDriver {
  readonly reconcile: (
    input: ReconcileProgramInput,
  ) => Effect.Effect<ProgramDriverDecision, ProgramRuntimeError>;
}

export interface ProgramEffectExecutorContext {
  readonly programId: ProgramId;
  readonly programRevision: number;
  readonly requestId: ProgramRequestId;
  readonly receiptId: ProgramReceiptId;
  readonly now: string;
}

export interface ProgramEffectExecutor {
  readonly execute: (
    effect: ProgramEffect,
    context: ProgramEffectExecutorContext,
  ) => Effect.Effect<RuntimeReceipt, ProgramEffectExecutionError>;
}

export interface ProgramRuntimeShape {
  readonly start: (input: StartProgramInput) => Effect.Effect<ProgramSnapshot, ProgramRuntimeError>;
  readonly wake: (input: WakeProgramInput) => Effect.Effect<ProgramSnapshot, ProgramRuntimeError>;
  readonly pause: (input: PauseProgramInput) => Effect.Effect<ProgramSnapshot, ProgramRuntimeError>;
  readonly resume: (
    input: ResumeProgramInput,
  ) => Effect.Effect<ProgramSnapshot, ProgramRuntimeError>;
  readonly stop: (input: StopProgramInput) => Effect.Effect<ProgramSnapshot, ProgramRuntimeError>;
  readonly read: (input: ReadProgramInput) => Effect.Effect<ProgramSnapshot, ProgramRuntimeError>;
  readonly list: Effect.Effect<ProgramListSnapshot, ProgramRuntimeError>;
  readonly changes: Stream.Stream<ProgramSummary>;
}

export class ProgramRuntime extends Context.Service<ProgramRuntime, ProgramRuntimeShape>()(
  "t3/orchestration-v2/ProgramRuntime",
) {}

const accepted = (message: string): ProgramCommandDecision => ({
  status: "accepted",
  code: "accepted",
  message,
});

const rejected = (
  code: Exclude<ProgramCommandDecision["code"], "accepted">,
  message: string,
): ProgramCommandDecision => ({ status: "rejected", code, message });

function allowedCommands(state: ProgramState): ProgramProjection["allowedCommands"] {
  switch (state) {
    case "running":
      return ["pause", "stop", "steer", "request_replan"];
    case "paused":
      return ["resume", "stop", "request_replan"];
    case "attention_required":
      return ["resume", "stop", "request_replan"];
    default:
      return [];
  }
}

function terminal(state: ProgramState): boolean {
  return state === "stopped" || state === "completed";
}

function programSummary(projection: ProgramProjection): ProgramSummary {
  return {
    programId: projection.programId,
    title: projection.title,
    state: projection.state,
    terminal: projection.terminal,
    phaseCount: projection.phases.length,
    activeAgentCount: projection.activeAgentCount,
    lastEventAt: projection.lastEventAt,
  };
}

function initialProjection(input: StartProgramInput): ProgramProjection {
  return {
    programId: input.attachment.programId,
    revision: 0,
    title: input.title,
    outcome: input.outcome,
    state: "running",
    terminal: false,
    attentionReason: null,
    allowedCommands: allowedCommands("running"),
    phases: input.phases.map(
      (phase): ProgramPhaseProjection => ({
        ...phase,
        state: "ready",
        activeAttemptId: null,
        ownerThreadId: null,
        receiptIds: [],
      }),
    ),
    attempts: [],
    receipts: [],
    threadBindings: [
      {
        threadId: input.attachment.programCoordinatorThreadId,
        role: "program_coordinator",
        phaseId: null,
        attemptId: null,
      },
      {
        threadId: input.attachment.integrationCoordinatorThreadId,
        role: "integration_coordinator",
        phaseId: null,
        attemptId: null,
      },
    ],
    statusRail: [
      { stage: "plan", state: "settled", receiptId: null },
      { stage: "ready", state: "settled", receiptId: null },
      { stage: "execute", state: "active", receiptId: null },
      { stage: "review", state: "pending", receiptId: null },
      { stage: "ci", state: "pending", receiptId: null },
      { stage: "admit", state: "pending", receiptId: null },
      { stage: "advance", state: "pending", receiptId: null },
    ],
    activity: [
      {
        eventId: ProgramEventId.make(`program-event:${input.attachment.programId}:started`),
        kind: "program_started",
        message: "Program started with the deterministic Slice 1 driver.",
        receiptId: null,
        occurredAt: input.attachment.createdAt,
      },
    ],
    activeAgentCount: 0,
    lastEventAt: input.attachment.createdAt,
  };
}

function emptyDriverProjection(
  attachment: ProgramAttachment,
  revision: number,
  now: string,
): ProgramProjection {
  return {
    programId: attachment.programId,
    revision,
    title: "Deterministic fake Program",
    outcome: "Exercise the T3-owned Program effect and receipt boundary.",
    state: "running",
    terminal: false,
    attentionReason: null,
    allowedCommands: allowedCommands("running"),
    phases: [],
    attempts: [],
    receipts: [],
    threadBindings: [],
    statusRail: [],
    activity: [],
    activeAgentCount: 0,
    lastEventAt: now,
  };
}

export function makeDeterministicProgramDriver(): DirtyloopsProgramDriver {
  return {
    reconcile: (input) =>
      Effect.sync(() => {
        const revision = input.observedProgramRevision + 1;
        const now = input.attachment.createdAt;
        const projection = emptyDriverProjection(input.attachment, revision, now);
        if (input.receipts.length > 0) {
          return {
            kind: "wait",
            programRevision: revision,
            projection,
            reason: "The deterministic fake effect is retained.",
            wakeConditions: ["operator_intent"],
          } satisfies ProgramDriverDecision;
        }
        return {
          kind: "effects",
          programRevision: revision,
          projection,
          proposalId: `proposal:${input.attachment.programId}:${revision}`,
          effects: [
            {
              kind: "launch_phase_coordinator",
              effectId: ProgramEffectId.make(
                `effect:${input.attachment.programId}:${revision}:launch_phase_coordinator`,
              ),
              identity: {
                programId: input.attachment.programId,
                phaseId: ProgramPhaseId.make(
                  input.attachment.programId.replace("program:", "phase:"),
                ),
                programCoordinatorThreadId: input.attachment.programCoordinatorThreadId,
                requestId: input.requestId,
              },
            },
          ],
        } satisfies ProgramDriverDecision;
      }),
  };
}

function mergeDriverProjection(
  current: ProgramProjection,
  driver: ProgramProjection,
  now: string,
): ProgramProjection {
  return {
    ...current,
    revision: driver.revision,
    state: driver.state,
    terminal: driver.terminal,
    attentionReason: driver.attentionReason,
    allowedCommands: allowedCommands(driver.state),
    phases: driver.phases.length === 0 ? current.phases : driver.phases,
    attempts: driver.attempts.length === 0 ? current.attempts : driver.attempts,
    statusRail: driver.statusRail.length === 0 ? current.statusRail : driver.statusRail,
    lastEventAt: now,
  };
}

function applyReceipt(
  projection: ProgramProjection,
  receipt: RuntimeReceipt,
  now: string,
): ProgramProjection {
  if (receipt.kind !== "launch_phase_coordinator") {
    return {
      ...projection,
      receipts: [...projection.receipts, receipt],
      lastEventAt: now,
    };
  }
  const phase =
    projection.phases.find((candidate) => candidate.phaseId === receipt.identity.phaseId) ??
    projection.phases[0];
  if (phase === undefined) {
    return { ...projection, receipts: [...projection.receipts, receipt], lastEventAt: now };
  }
  const attemptId = ProgramAttemptId.make(`attempt:${phase.phaseId}:1`);
  const threadId = receipt.result.phaseCoordinatorThreadId;
  return {
    ...projection,
    phases: projection.phases.map((candidate) =>
      candidate.phaseId === phase.phaseId
        ? {
            ...candidate,
            state: "running",
            activeAttemptId: attemptId,
            ownerThreadId: threadId,
            receiptIds: [...candidate.receiptIds, receipt.receiptId],
          }
        : candidate,
    ),
    attempts: [
      ...projection.attempts,
      {
        attemptId,
        phaseId: phase.phaseId,
        ownerKind: "implementation",
        state: "running",
        threadId,
        terminalKind: null,
      },
    ],
    receipts: [...projection.receipts, receipt],
    threadBindings: [
      ...projection.threadBindings,
      {
        threadId,
        role: "phase_coordinator",
        phaseId: phase.phaseId,
        attemptId: null,
      },
    ],
    statusRail: projection.statusRail.map((item) =>
      item.stage === "execute" ? { ...item, receiptId: receipt.receiptId } : item,
    ),
    activity: [
      ...projection.activity,
      {
        eventId: ProgramEventId.make(`program-event:${receipt.receiptId}`),
        kind: "receipt_recorded",
        message: "Phase coordinator launch completed.",
        receiptId: receipt.receiptId,
        occurredAt: now,
      },
    ],
    activeAgentCount: 1,
    lastEventAt: now,
  };
}

function replaceReceipts(
  projection: ProgramProjection,
  acknowledged: ReadonlyArray<RuntimeReceipt>,
  now: string,
): ProgramProjection {
  const byId = new Map(acknowledged.map((receipt) => [receipt.receiptId, receipt] as const));
  return {
    ...projection,
    receipts: projection.receipts.map((receipt) => byId.get(receipt.receiptId) ?? receipt),
    activity: [
      ...projection.activity,
      ...acknowledged.map((receipt) => ({
        eventId: ProgramEventId.make(`program-event:${receipt.receiptId}:acknowledged`),
        kind: "receipt_acknowledged" as const,
        message: "dirtyloops acknowledged the retained T3 receipt.",
        receiptId: receipt.receiptId,
        occurredAt: now,
      })),
    ],
    lastEventAt: now,
  };
}

function withState(
  projection: ProgramProjection,
  state: ProgramState,
  now: string,
  message: string,
): ProgramProjection {
  return {
    ...projection,
    revision: projection.revision + 1,
    state,
    terminal: terminal(state),
    allowedCommands: allowedCommands(state),
    activity: [
      ...projection.activity,
      {
        eventId: ProgramEventId.make(
          `program-event:${projection.programId}:${state}:${projection.revision + 1}`,
        ),
        kind: "state_changed",
        message,
        receiptId: null,
        occurredAt: now,
      },
    ],
    lastEventAt: now,
  };
}

export interface MakeProgramRuntimeOptions {
  readonly store: ProgramStoreShape;
  readonly driver: DirtyloopsProgramDriver;
  readonly executor: ProgramEffectExecutor;
  readonly workerId?: string;
  readonly afterReceiptPersisted?: (
    receipt: RuntimeReceipt,
  ) => Effect.Effect<void, ProgramRuntimeHookError>;
}

const encodeStartInput = Schema.encodeSync(Schema.fromJsonString(StartProgramInputSchema));
const encodeWakeInput = Schema.encodeSync(Schema.fromJsonString(WakeProgramInputSchema));
const encodePauseInput = Schema.encodeSync(Schema.fromJsonString(PauseProgramInputSchema));
const encodeResumeInput = Schema.encodeSync(Schema.fromJsonString(ResumeProgramInputSchema));
const encodeStopInput = Schema.encodeSync(Schema.fromJsonString(StopProgramInputSchema));

export const makeProgramRuntime = (options: MakeProgramRuntimeOptions) =>
  Effect.gen(function* () {
    const serial = yield* makeKeyedSerialExecutor<ProgramId>();
    const updates = yield* PubSub.unbounded<ProgramSummary>();
    const workerId = options.workerId ?? `program-worker:${yield* randomUuidV4}`;

    const nowPair = Effect.gen(function* () {
      const now = yield* DateTime.now;
      return {
        now: DateTime.formatIso(now),
        leaseExpiresAt: DateTime.formatIso(DateTime.add(now, { seconds: 30 })),
      };
    });

    const loadRequired = (programId: ProgramId) =>
      options.store.load(programId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new ProgramNotFoundError({ programId })),
            onSome: Effect.succeed,
          }),
        ),
      );

    const publish = (projection: ProgramProjection) =>
      PubSub.publish(updates, programSummary(projection)).pipe(Effect.asVoid);

    const snapshot = (
      requestId: ProgramRequestId,
      decision: ProgramCommandDecision,
      projection: ProgramProjection,
    ): ProgramSnapshot => ({ requestId, decision, projection });

    const conflictSnapshot = (requestId: ProgramRequestId, projection: ProgramProjection) =>
      snapshot(
        requestId,
        rejected("request_conflict", "This request ID is already bound to another command."),
        projection,
      );

    const withRequest = <
      A extends { readonly programId: ProgramId; readonly requestId: ProgramRequestId },
    >(
      operation: string,
      input: A,
      inputJson: string,
      run: (
        record: ProgramRecord,
        now: string,
      ) => Effect.Effect<ProgramSnapshot, ProgramRuntimeError>,
    ) =>
      serial.withLock(
        input.programId,
        Effect.gen(function* () {
          const record = yield* loadRequired(input.programId);
          const now = DateTime.formatIso(yield* DateTime.now);
          const request = yield* options.store.beginRequest({
            programId: input.programId,
            requestId: input.requestId,
            operation,
            inputJson,
            now,
          });
          if (request.kind === "completed") return request.snapshot;
          if (request.kind === "conflict") {
            return conflictSnapshot(input.requestId, record.projection);
          }
          const result = yield* run(record, now);
          yield* options.store.completeRequest({
            requestId: input.requestId,
            snapshot: result,
            now,
          });
          return result;
        }),
      );

    const drain = (
      programId: ProgramId,
      fallbackRequestId: ProgramRequestId,
      wakeOptions?: { readonly allowTakeover?: boolean },
    ) =>
      Effect.gen(function* () {
        const times = yield* nowPair;
        const claimed = yield* options.store.claimWake({
          programId,
          workerId,
          ...times,
          ...(wakeOptions?.allowTakeover === true ? { allowTakeover: true } : {}),
        });
        if (Option.isNone(claimed)) {
          const current = (yield* loadRequired(programId)).projection;
          return snapshot(
            fallbackRequestId,
            rejected("lease_conflict", "Another worker owns this Program wake."),
            current,
          );
        }
        const lease = claimed.value;
        let record = yield* loadRequired(programId);
        const receipts = yield* options.store.unacknowledgedReceipts(programId);
        const decision = yield* options.driver.reconcile({
          attachment: record.attachment,
          requestId: lease.requestId,
          observedProgramRevision: record.projection.revision,
          wakeCause: lease.cause,
          receipts,
        });
        let projection = mergeDriverProjection(record.projection, decision.projection, times.now);

        if (receipts.length > 0) {
          const acknowledged = yield* options.store.acknowledgeReceipts({
            lease,
            receiptIds: receipts.map((receipt) => receipt.receiptId),
            now: times.now,
          });
          projection = replaceReceipts(projection, acknowledged, times.now);
        }

        if (decision.kind === "effects") {
          for (const effect of decision.effects) {
            yield* options.store.saveEffect({ lease, effect, now: times.now });
            const retained = yield* options.store.receiptByEffect(effect.effectId);
            const receipt = Option.isSome(retained)
              ? retained.value
              : yield* options.executor.execute(effect, {
                  programId,
                  programRevision: decision.programRevision,
                  requestId: lease.requestId,
                  receiptId: ProgramReceiptId.make(`receipt:${effect.effectId}`),
                  now: times.now,
                });
            const persisted = yield* options.store.saveReceipt({ lease, receipt });
            if (!projection.receipts.some((candidate) => candidate.effectId === effect.effectId)) {
              projection = applyReceipt(projection, persisted, times.now);
              yield* options.store.saveProjection({ lease, projection, now: times.now });
            }
            yield* options.afterReceiptPersisted?.(persisted) ?? Effect.void;
          }
        }

        if (decision.kind === "attention_required") {
          projection = {
            ...projection,
            state: "attention_required",
            terminal: false,
            attentionReason: decision.reasonCode,
            allowedCommands: allowedCommands("attention_required"),
          };
        } else if (decision.kind === "complete") {
          projection = {
            ...projection,
            state: "completed",
            terminal: true,
            attentionReason: null,
            allowedCommands: [],
          };
        }
        yield* options.store.saveProjection({ lease, projection, now: times.now });
        yield* options.store.finishWake({ lease, now: times.now });
        yield* publish(projection);
        return snapshot(lease.requestId, accepted("Program wake completed."), projection);
      });

    const start: ProgramRuntimeShape["start"] = (input) =>
      serial.withLock(
        input.attachment.programId,
        Effect.gen(function* () {
          const now = DateTime.formatIso(yield* DateTime.now);
          const existing = yield* options.store.load(input.attachment.programId);
          if (Option.isSome(existing)) {
            const request = yield* options.store.beginRequest({
              programId: input.attachment.programId,
              requestId: input.requestId,
              operation: "start",
              inputJson: encodeStartInput(input),
              now,
            });
            if (request.kind === "completed") return request.snapshot;
            if (request.kind === "conflict") {
              return conflictSnapshot(input.requestId, existing.value.projection);
            }
          } else {
            yield* options.store.create(input, initialProjection(input));
            yield* options.store.beginRequest({
              programId: input.attachment.programId,
              requestId: input.requestId,
              operation: "start",
              inputJson: encodeStartInput(input),
              now,
            });
          }
          yield* options.store.enqueueWake({
            wakeId: ProgramWakeId.make(`wake:${input.attachment.programId}:${input.requestId}`),
            programId: input.attachment.programId,
            requestId: input.requestId,
            cause: "start",
            now,
          });
          const result = yield* drain(input.attachment.programId, input.requestId);
          yield* options.store.completeRequest({
            requestId: input.requestId,
            snapshot: result,
            now,
          });
          return result;
        }),
      );

    const wake: ProgramRuntimeShape["wake"] = (input) =>
      withRequest("wake", input, encodeWakeInput(input), (_record, now) =>
        options.store
          .enqueueWake({
            wakeId: ProgramWakeId.make(`wake:${input.programId}:${input.requestId}`),
            ...input,
            now,
          })
          .pipe(
            Effect.andThen(
              drain(input.programId, input.requestId, {
                allowTakeover: input.cause === "restart",
              }),
            ),
            Effect.map((result) => ({ ...result, requestId: input.requestId })),
          ),
      );

    const mutateState = (
      operation: "pause" | "resume" | "stop",
      input: PauseProgramInput | ResumeProgramInput | StopProgramInput,
      allowedFrom: ReadonlyArray<ProgramState>,
      nextState: ProgramState,
      message: string,
    ) =>
      withRequest(
        operation,
        input,
        operation === "pause"
          ? encodePauseInput(input)
          : operation === "resume"
            ? encodeResumeInput(input)
            : encodeStopInput(input),
        (record, now) => {
          if (!allowedFrom.includes(record.projection.state)) {
            return Effect.succeed(
              snapshot(
                input.requestId,
                rejected(
                  "invalid_state",
                  `${operation} is not allowed while the Program is ${record.projection.state}.`,
                ),
                record.projection,
              ),
            );
          }
          const wakeId = ProgramWakeId.make(`wake:${input.programId}:${input.requestId}:command`);
          return options.store
            .enqueueWake({
              wakeId,
              programId: input.programId,
              requestId: input.requestId,
              cause: "operator_intent",
              now,
            })
            .pipe(
              Effect.andThen(
                options.store.claimWake({
                  programId: input.programId,
                  workerId,
                  now,
                  leaseExpiresAt: DateTime.formatIso(
                    DateTime.add(DateTime.makeUnsafe(now), { seconds: 30 }),
                  ),
                }),
              ),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.succeed(
                      snapshot(
                        input.requestId,
                        rejected("lease_conflict", "Another worker owns this Program wake."),
                        record.projection,
                      ),
                    ),
                  onSome: (lease: ClaimedProgramWake) => {
                    const projection = withState(record.projection, nextState, now, message);
                    return options.store
                      .saveProjection({ lease, projection, now })
                      .pipe(
                        Effect.andThen(options.store.finishWake({ lease, now })),
                        Effect.andThen(publish(projection)),
                        Effect.as(snapshot(input.requestId, accepted(message), projection)),
                      );
                  },
                }),
              ),
            );
        },
      );

    const runtime: ProgramRuntimeShape = {
      start,
      wake,
      pause: (input) =>
        mutateState("pause", input, ["running"], "paused", "Program paused at a safe boundary."),
      resume: (input) =>
        mutateState(
          "resume",
          input,
          ["paused", "attention_required"],
          "running",
          "Program resumed.",
        ),
      stop: (input) =>
        mutateState(
          "stop",
          input,
          ["running", "paused", "attention_required"],
          "stopped",
          "Program stopped.",
        ),
      read: ({ programId }) =>
        loadRequired(programId).pipe(
          Effect.map((record) =>
            snapshot(
              ProgramRequestId.make(`request:read:${programId}:${record.projection.revision}`),
              accepted("Program projection loaded."),
              record.projection,
            ),
          ),
        ),
      list: options.store.list,
      changes: Stream.fromPubSub(updates),
    };
    return runtime;
  });

export const deterministicEffectExecutor: ProgramEffectExecutor = {
  execute: (effect, context) => {
    if (effect.kind !== "launch_phase_coordinator") {
      return Effect.fail(
        new ProgramEffectExecutionError({
          programId: context.programId,
          effectId: effect.effectId,
          cause: `The Slice 1 executor does not implement ${effect.kind}.`,
        }),
      );
    }
    return Effect.succeed({
      receiptId: context.receiptId,
      programId: context.programId,
      programRevision: context.programRevision,
      effectId: effect.effectId,
      requestId: context.requestId,
      kind: effect.kind,
      status: "succeeded",
      resultDigest: `sha256:${effect.effectId}`,
      evidence: [],
      createdAt: context.now,
      acknowledged: false,
      identity: effect.identity,
      result: {
        phaseCoordinatorThreadId: ThreadId.make(`thread:${effect.identity.phaseId}:coordinator`),
      },
    });
  },
};

export const layer = Layer.effect(
  ProgramRuntime,
  Effect.gen(function* () {
    const store = yield* makeProgramStore;
    return yield* makeProgramRuntime({
      store,
      driver: makeDeterministicProgramDriver(),
      executor: deterministicEffectExecutor,
    });
  }),
);
