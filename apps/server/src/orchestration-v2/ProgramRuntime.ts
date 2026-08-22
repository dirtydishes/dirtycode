import {
  type AcceptedOperatorIntent,
  type ProgramCommandDecision,
  type ProgramDriverDecision,
  type ProgramEffect,
  ProgramEffectId,
  type ProgramEvent,
  ProgramEventId,
  ProgramId,
  type ProgramListSnapshot,
  ProgramReceiptId,
  ProgramRequestId,
  type ProgramSnapshot,
  type ProgramStreamItem,
  ProgramWakeId,
  type PauseProgramInput,
  type ReadProgramInput,
  type ReconcileProgramInput,
  type ResumeProgramInput,
  type RuntimeReceipt,
  type StartProgramInput,
  type StopProgramInput,
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

import { GoalDriver, type GoalDriverShape } from "./Adapters/GoalDriver.ts";
import { makeDeterministicProgramDriver } from "./Adapters/DeterministicProgramDriver.ts";
import { makeKeyedSerialExecutor } from "./KeyedSerialExecutor.ts";
import {
  acknowledgeProgramReceipts,
  applyProgramReceipt,
  makeInitialProgramProjection,
  replayProgramProjection,
  summarizeProgram,
} from "./ProgramProjection.ts";
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
  { programId: ProgramId, effectId: ProgramEffectId, cause: Schema.Defect() },
) {
  override get message(): string {
    return `T3 could not execute Program effect ${this.effectId}.`;
  }
}

export class ProgramReceiptMismatchError extends Schema.TaggedErrorClass<ProgramReceiptMismatchError>()(
  "ProgramReceiptMismatchError",
  {
    programId: ProgramId,
    effectId: ProgramEffectId,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `T3 rejected the receipt for Program effect ${this.effectId}: ${this.reason}`;
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
  | ProgramReceiptMismatchError
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
  readonly observe: (
    effect: ProgramEffect,
    context: ProgramEffectExecutorContext,
  ) => Effect.Effect<Option.Option<RuntimeReceipt>, ProgramEffectExecutionError>;
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
  readonly subscribe: Stream.Stream<ProgramStreamItem, ProgramRuntimeError>;
  readonly recover: Effect.Effect<ReadonlyArray<ProgramSnapshot>, ProgramRuntimeError>;
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

const encodeStartInput = Schema.encodeSync(Schema.fromJsonString(StartProgramInputSchema));
const encodeWakeInput = Schema.encodeSync(Schema.fromJsonString(WakeProgramInputSchema));
const encodePauseInput = Schema.encodeSync(Schema.fromJsonString(PauseProgramInputSchema));
const encodeResumeInput = Schema.encodeSync(Schema.fromJsonString(ResumeProgramInputSchema));
const encodeStopInput = Schema.encodeSync(Schema.fromJsonString(StopProgramInputSchema));

function validateReceipt(
  effect: ProgramEffect,
  receipt: RuntimeReceipt,
  context: ProgramEffectExecutorContext,
): ProgramReceiptMismatchError | null {
  const canonicalJson = (value: unknown): string =>
    JSON.stringify(value, (_key, item: unknown) =>
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item as Record<string, unknown>).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          )
        : item,
    );
  const mismatch = (reason: string) =>
    new ProgramReceiptMismatchError({
      programId: context.programId,
      effectId: effect.effectId,
      reason,
    });
  if (receipt.programId !== context.programId) return mismatch("programId does not match");
  if (receipt.effectId !== effect.effectId) return mismatch("effectId does not match");
  if (receipt.requestId !== context.requestId) return mismatch("requestId does not match");
  if (receipt.programRevision !== context.programRevision) {
    return mismatch("programRevision does not match");
  }
  if (receipt.kind !== effect.kind) return mismatch("effect kind does not match");
  if (canonicalJson(receipt.identity) !== canonicalJson(effect.identity)) {
    return mismatch("effect identity does not match");
  }
  if (
    receipt.kind === "launch_phase_coordinator" &&
    effect.kind === "launch_phase_coordinator" &&
    receipt.result.phaseCoordinatorThreadId !== effect.identity.phaseCoordinatorThreadId
  ) {
    return mismatch("phase coordinator thread does not match the proposed target");
  }
  return null;
}

export interface MakeProgramRuntimeOptions {
  readonly store: ProgramStoreShape;
  readonly driver: DirtyloopsProgramDriver;
  readonly executor: ProgramEffectExecutor;
  readonly goalDriver: GoalDriverShape;
  readonly workerId?: string;
  readonly leaseDurationSeconds?: number;
  readonly afterEffectExecuted?: (
    receipt: RuntimeReceipt,
  ) => Effect.Effect<void, ProgramRuntimeHookError>;
  readonly afterReceiptPersisted?: (
    receipt: RuntimeReceipt,
  ) => Effect.Effect<void, ProgramRuntimeHookError>;
  readonly afterReceiptsAcknowledged?: () => Effect.Effect<void, ProgramRuntimeHookError>;
  readonly afterProjectionPersisted?: () => Effect.Effect<void, ProgramRuntimeHookError>;
}

export const makeProgramRuntime = (options: MakeProgramRuntimeOptions) =>
  Effect.gen(function* () {
    const serial = yield* makeKeyedSerialExecutor<ProgramId>();
    const updates = yield* PubSub.unbounded<ReturnType<typeof summarizeProgram>>();
    const workerId = options.workerId ?? `program-worker:${yield* randomUuidV4}`;
    const leaseDurationSeconds = options.leaseDurationSeconds ?? 30;

    const nowPair = Effect.gen(function* () {
      const instant = yield* DateTime.now;
      return {
        now: DateTime.formatIso(instant),
        leaseExpiresAt: DateTime.formatIso(
          DateTime.add(instant, { seconds: leaseDurationSeconds }),
        ),
      };
    });

    const loadRequired = (programId: ProgramId) =>
      Effect.gen(function* () {
        const found = yield* options.store.load(programId);
        if (Option.isNone(found)) return yield* new ProgramNotFoundError({ programId });
        const events = yield* options.store.events(programId);
        return {
          ...found.value,
          projection:
            events.length === 0 ? found.value.projection : replayProgramProjection(events),
        } satisfies ProgramRecord;
      });

    const listPrograms: ProgramRuntimeShape["list"] = options.store.list.pipe(
      Effect.flatMap((stored) =>
        Effect.forEach(stored.programs, (item) => loadRequired(item.programId)),
      ),
      Effect.map((records) => ({
        schemaVersion: 1,
        programs: records.map((record) => summarizeProgram(record.projection)),
      })),
    );

    const publish = (projection: ProgramRecord["projection"]) =>
      PubSub.publish(updates, summarizeProgram(projection)).pipe(Effect.asVoid);

    const appendEvent = (
      programId: ProgramId,
      makeEvent: (sequence: number) => ProgramEvent,
      lease?: ClaimedProgramWake,
    ) =>
      options.store.nextEventSequence(programId).pipe(
        Effect.flatMap((sequence) =>
          options.store.appendEvent({
            ...(lease === undefined ? {} : { lease }),
            event: makeEvent(sequence),
          }),
        ),
      );

    const snapshot = (
      requestId: ProgramRequestId,
      decision: ProgramCommandDecision,
      projection: ProgramRecord["projection"],
    ): ProgramSnapshot => ({ requestId, decision, projection });

    const conflictSnapshot = (requestId: ProgramRequestId, record: ProgramRecord) =>
      snapshot(
        requestId,
        rejected("request_conflict", "This request ID is already bound to another command."),
        record.projection,
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
          if (request.kind === "conflict") return conflictSnapshot(input.requestId, record);
          return yield* run(record, now);
        }),
      );

    const drain = (
      programId: ProgramId,
      fallbackRequestId: ProgramRequestId,
    ): Effect.Effect<ProgramSnapshot, ProgramRuntimeError> =>
      Effect.gen(function* () {
        const times = yield* nowPair;
        const claimed = yield* options.store.claimWake({
          programId,
          workerId,
          ...times,
        });
        if (Option.isNone(claimed)) {
          const current = (yield* loadRequired(programId)).projection;
          return snapshot(
            fallbackRequestId,
            rejected(
              "lease_conflict",
              "Another worker owns this Program wake; retry this request.",
            ),
            current,
          );
        }
        const lease = claimed.value;
        const incompleteEffects = yield* options.store.incompleteEffects(programId);
        for (const pending of incompleteEffects) {
          const context: ProgramEffectExecutorContext = {
            programId,
            programRevision: pending.programRevision,
            requestId: pending.requestId,
            receiptId: ProgramReceiptId.make(`receipt:${pending.effect.effectId}`),
            now: times.now,
          };
          const observed = yield* options.executor.observe(pending.effect, context);
          const receipt = Option.isSome(observed)
            ? observed.value
            : yield* options.executor
                .execute(pending.effect, context)
                .pipe(
                  Effect.tap((executed) => options.afterEffectExecuted?.(executed) ?? Effect.void),
                );
          const mismatch = validateReceipt(pending.effect, receipt, context);
          if (mismatch !== null) return yield* mismatch;
          const persisted = yield* options.store.saveReceipt({ lease, receipt });
          yield* options.afterReceiptPersisted?.(persisted) ?? Effect.void;
        }
        const record = yield* loadRequired(programId);
        const receipts = yield* options.store.receipts(programId);
        const decision = yield* options.driver.reconcile({
          attachment: record.attachment,
          requestId: lease.requestId,
          observedProgramRevision: record.projection.revision,
          observedProjection: record.projection,
          wakeCause: lease.cause,
          operatorIntent: lease.operatorIntent,
          occurredAt: times.now,
          receipts,
        });
        yield* appendEvent(
          programId,
          (sequence) => ({
            eventId: ProgramEventId.make(
              `program-event:${lease.wakeId}:decision:${decision.programRevision}`,
            ),
            programId,
            sequence,
            revision: decision.programRevision,
            requestId: lease.requestId,
            occurredAt: times.now,
            type: "program.decision-recorded",
            payload: decision,
          }),
          lease,
        );
        let projection = decision.projection;

        const unacknowledged = receipts.filter((receipt) => !receipt.acknowledged);
        if (unacknowledged.length > 0) {
          const acknowledged = yield* options.store.acknowledgeReceipts({
            lease,
            receiptIds: unacknowledged.map((receipt) => receipt.receiptId),
            now: times.now,
          });
          yield* options.afterReceiptsAcknowledged?.() ?? Effect.void;
          projection = acknowledgeProgramReceipts(
            projection,
            acknowledged.map((receipt) => receipt.receiptId),
            times.now,
          );
        }

        if (decision.kind === "effects") {
          for (const effect of decision.effects) {
            yield* options.store.saveEffect({
              lease,
              effect,
              programRevision: decision.programRevision,
              now: times.now,
            });
            const context: ProgramEffectExecutorContext = {
              programId,
              programRevision: decision.programRevision,
              requestId: lease.requestId,
              receiptId: ProgramReceiptId.make(`receipt:${effect.effectId}`),
              now: times.now,
            };
            const retained = yield* options.store.receiptByEffect(effect.effectId);
            const observed = Option.isSome(retained)
              ? retained
              : yield* options.executor.observe(effect, context);
            const receipt = Option.isSome(observed)
              ? observed.value
              : yield* options.executor
                  .execute(effect, context)
                  .pipe(
                    Effect.tap(
                      (executed) => options.afterEffectExecuted?.(executed) ?? Effect.void,
                    ),
                  );
            const mismatch = validateReceipt(effect, receipt, context);
            if (mismatch !== null) return yield* mismatch;
            const persisted = yield* options.store.saveReceipt({ lease, receipt });
            yield* options.afterReceiptPersisted?.(persisted) ?? Effect.void;
            projection = applyProgramReceipt(projection, persisted, times.now);
          }
        }

        yield* options.store.saveProjection({ lease, projection, now: times.now });
        yield* options.afterProjectionPersisted?.() ?? Effect.void;
        const result = snapshot(lease.requestId, decision.operatorDecision, projection);
        yield* options.store.finishWake({ lease, snapshot: result, now: times.now });
        yield* publish(projection);
        return lease.requestId === fallbackRequestId
          ? result
          : yield* drain(programId, fallbackRequestId);
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
            if (request.kind === "conflict")
              return conflictSnapshot(input.requestId, existing.value);
          } else {
            const capability = yield* options.goalDriver.capabilities();
            yield* options.store.create(input, makeInitialProgramProjection(input, capability));
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
            operatorIntent: null,
            now,
          });
          return yield* drain(input.attachment.programId, input.requestId);
        }),
      );

    const wake: ProgramRuntimeShape["wake"] = (input) =>
      withRequest("wake", input, encodeWakeInput(input), (_record, now) =>
        options.store
          .enqueueWake({
            wakeId: ProgramWakeId.make(`wake:${input.programId}:${input.requestId}`),
            ...input,
            operatorIntent: null,
            now,
          })
          .pipe(Effect.andThen(drain(input.programId, input.requestId))),
      );

    const command = (
      operation: AcceptedOperatorIntent["kind"],
      input: PauseProgramInput | ResumeProgramInput | StopProgramInput,
      inputJson: string,
      operatorIntent: AcceptedOperatorIntent,
    ) =>
      withRequest(operation, input, inputJson, (_record, now) =>
        options.store
          .enqueueWake({
            wakeId: ProgramWakeId.make(`wake:${input.programId}:${input.requestId}:command`),
            programId: input.programId,
            requestId: input.requestId,
            cause: "operator_intent",
            operatorIntent,
            now,
          })
          .pipe(Effect.andThen(drain(input.programId, input.requestId))),
      );

    const recover: ProgramRuntimeShape["recover"] = listPrograms.pipe(
      Effect.flatMap((programs) =>
        Effect.forEach(
          programs.programs.filter((program) => !program.terminal),
          (program) =>
            loadRequired(program.programId).pipe(
              Effect.flatMap((record) =>
                wake({
                  programId: program.programId,
                  requestId: ProgramRequestId.make(
                    `request:restart:${program.programId}:${record.projection.revision}`,
                  ),
                  cause: "restart",
                }),
              ),
            ),
          { concurrency: 1 },
        ),
      ),
    );

    const subscribe: ProgramRuntimeShape["subscribe"] = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(updates);
        const initial = yield* listPrograms;
        return Stream.concat(
          Stream.fromIterable<ProgramStreamItem>([
            { kind: "snapshot", snapshot: initial },
            { kind: "synchronized" },
          ]),
          Stream.fromSubscription(subscription).pipe(
            Stream.map((program): ProgramStreamItem => ({ kind: "program.updated", program })),
          ),
        );
      }),
    );

    return {
      start,
      wake,
      pause: (input) => command("pause", input, encodePauseInput(input), { kind: "pause" }),
      resume: (input) => command("resume", input, encodeResumeInput(input), { kind: "resume" }),
      stop: (input) =>
        command(
          "stop",
          input,
          encodeStopInput(input),
          input.reason === undefined ? { kind: "stop" } : { kind: "stop", reason: input.reason },
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
      list: listPrograms,
      subscribe,
      recover,
    } satisfies ProgramRuntimeShape;
  });

export function makeDeterministicEffectExecutor(): ProgramEffectExecutor {
  const observed = new Map<string, RuntimeReceipt>();
  return {
    observe: (effect) => Effect.succeed(Option.fromNullishOr(observed.get(effect.effectId))),
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
      const receipt: RuntimeReceipt = {
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
        result: { phaseCoordinatorThreadId: effect.identity.phaseCoordinatorThreadId },
      };
      observed.set(effect.effectId, receipt);
      return Effect.succeed(receipt);
    },
  };
}

export const deterministicEffectExecutor = makeDeterministicEffectExecutor();

export const layer = Layer.effect(
  ProgramRuntime,
  Effect.gen(function* () {
    const store = yield* makeProgramStore;
    const goalDriver = yield* GoalDriver;
    return yield* makeProgramRuntime({
      store,
      driver: makeDeterministicProgramDriver(),
      executor: makeDeterministicEffectExecutor(),
      goalDriver,
    });
  }),
);
