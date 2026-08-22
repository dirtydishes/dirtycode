import {
  type AcceptedOperatorIntent,
  type ProgramCommandDecision,
  type ProgramEffect,
  ProgramEffectId,
  type ProgramEvent,
  ProgramId,
  ProjectId,
  ProviderInstanceId,
  type ProgramListSnapshot,
  type ProgramProjection,
  ProgramReceiptId,
  ProgramRequestId,
  type ProgramSnapshot,
  type ProgramStreamItem,
  ProgramWakeId,
  type PauseProgramInput,
  type ReadProgramInput,
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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { GoalDriver, type GoalDriverShape } from "./Adapters/GoalDriver.ts";
import { makeDeterministicProgramDriver } from "./Adapters/DeterministicProgramDriver.ts";
import {
  makeDirtyloopsProcessInvoker,
  makeDirtyloopsReadOnlyProgramDriver,
} from "./Adapters/DirtyloopsProgramDriver.ts";
import { makeT3ProgramEffectExecutor } from "./Adapters/T3ProgramEffectExecutor.ts";
import { makeKeyedSerialExecutor } from "./KeyedSerialExecutor.ts";
import { CommandReceiptStoreV2 } from "./CommandReceiptStore.ts";
import {
  ProgramEffectExecutionError,
  type ProgramEffectExecutor,
  type ProgramEffectExecutorContext,
} from "./ProgramEffectExecutor.ts";
import {
  acknowledgeProgramReceipts,
  applyProgramReceipt,
  makeInitialProgramProjection,
  replayProgramProjection,
} from "./ProgramProjection.ts";
import { randomUuidV4 } from "./RandomUuid.ts";
import {
  ProgramDriverError,
  type DirtyloopsProgramDriver,
  type ProgramDriverRegistry,
} from "./ProgramDriver.ts";
import {
  makeProgramStore,
  ProgramStoreError,
  ProgramStoreLeaseError,
  type ProgramRecord,
  type ProgramStoreShape,
} from "./ProgramStore.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

export {
  ProgramEffectExecutionError,
  type ProgramEffectExecutor,
  type ProgramEffectExecutorContext,
} from "./ProgramEffectExecutor.ts";

export class ProgramNotFoundError extends Schema.TaggedErrorClass<ProgramNotFoundError>()(
  "ProgramNotFoundError",
  { programId: ProgramId },
) {
  override get message(): string {
    return `Program ${this.programId} was not found.`;
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
  | ProgramDriverError
  | ProgramStoreError
  | ProgramStoreLeaseError;

export { ProgramDriverError, type DirtyloopsProgramDriver, type ProgramDriverRegistry };

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

function startIdentityMatches(
  started: Extract<ProgramEvent, { readonly type: "program.started" }>,
  driverKind: ProgramRecord["driverKind"],
  input: StartProgramInput,
): boolean {
  const initial = started.payload.projection;
  const retained = {
    attachment: started.payload.attachment,
    driverKind,
    title: initial.title,
    outcome: initial.outcome,
    phases: initial.phases.map((phase) => ({
      phaseId: phase.phaseId,
      title: phase.title,
      dependencyIds: phase.dependencyIds,
      phaseCoordinatorThreadId: phase.phaseCoordinatorTargetThreadId,
      projectId: phase.projectId,
      threadTitle: phase.threadTitle,
      modelSelection: phase.modelSelection,
      runtimeMode: phase.runtimeMode,
      interactionMode: phase.interactionMode,
      branch: phase.branch,
      worktreePath: phase.worktreePath,
    })),
    attempts: initial.attempts,
  };
  return (
    canonicalJson(retained) ===
    canonicalJson({
      attachment: input.attachment,
      driverKind: input.driverKind,
      title: input.title,
      outcome: input.outcome,
      phases: input.phases,
      attempts: input.attempts,
    })
  );
}

function validateReceipt(
  effect: ProgramEffect,
  receipt: RuntimeReceipt,
  context: ProgramEffectExecutorContext,
): ProgramReceiptMismatchError | null {
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
  readonly drivers: ProgramDriverRegistry;
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
  readonly afterDecisionPersisted?: () => Effect.Effect<void, ProgramRuntimeHookError>;
  readonly afterReceiptsAcknowledged?: () => Effect.Effect<void, ProgramRuntimeHookError>;
  readonly afterProjectionPersisted?: () => Effect.Effect<void, ProgramRuntimeHookError>;
}

export const makeProgramRuntime = (options: MakeProgramRuntimeOptions) =>
  Effect.gen(function* () {
    const serial = yield* makeKeyedSerialExecutor<ProgramId>();
    const updateSignal = yield* PubSub.sliding<void>(1);
    const latestUpdates = yield* Ref.make<ReadonlyMap<ProgramId, ProgramProjection>>(new Map());
    const recoveryScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
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

    const listPrograms: ProgramRuntimeShape["list"] = options.store.list;

    const publish = (projection: ProgramRecord["projection"]) =>
      Ref.update(latestUpdates, (current) => {
        const next = new Map(current);
        next.set(projection.programId, projection);
        return next;
      }).pipe(Effect.andThen(PubSub.publish(updateSignal, undefined)), Effect.asVoid);

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
          const persisted = yield* options.store.saveReceipt({
            lease,
            receipt,
            now: DateTime.formatIso(yield* DateTime.now),
          });
          yield* options.afterReceiptPersisted?.(persisted) ?? Effect.void;
        }
        const record = yield* loadRequired(programId);
        const receipts = yield* options.store.receipts(programId);
        const decision = yield* options.drivers[record.driverKind].reconcile({
          attachment: record.attachment,
          requestId: lease.requestId,
          observedProgramRevision: record.projection.revision,
          observedProjection: record.projection,
          wakeCause: lease.cause,
          operatorIntent: lease.operatorIntent,
          occurredAt: times.now,
          receipts: receipts.filter((receipt) => !receipt.acknowledged),
        });
        yield* options.store.saveDecision({
          lease,
          decision,
          now: DateTime.formatIso(yield* DateTime.now),
        });
        yield* options.afterDecisionPersisted?.() ?? Effect.void;
        let projection = decision.projection;

        const unacknowledged = receipts.filter((receipt) => !receipt.acknowledged);
        if (unacknowledged.length > 0) {
          const acknowledgedAt = DateTime.formatIso(yield* DateTime.now);
          const acknowledged = yield* options.store.acknowledgeReceipts({
            lease,
            receiptIds: unacknowledged.map((receipt) => receipt.receiptId),
            now: acknowledgedAt,
          });
          yield* options.afterReceiptsAcknowledged?.() ?? Effect.void;
          projection = acknowledgeProgramReceipts(
            projection,
            acknowledged.map((receipt) => receipt.receiptId),
            acknowledgedAt,
          );
        }

        if (decision.kind === "effects") {
          for (const effect of decision.effects) {
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
            const persisted = yield* options.store.saveReceipt({
              lease,
              receipt,
              now: DateTime.formatIso(yield* DateTime.now),
            });
            yield* options.afterReceiptPersisted?.(persisted) ?? Effect.void;
            projection = applyProgramReceipt(projection, persisted, times.now);
          }
        }

        yield* options.store.saveProjection({
          lease,
          projection,
          now: DateTime.formatIso(yield* DateTime.now),
        });
        yield* options.afterProjectionPersisted?.() ?? Effect.void;
        const result = snapshot(lease.requestId, decision.operatorDecision, projection);
        yield* options.store.finishWake({
          lease,
          snapshot: result,
          now: DateTime.formatIso(yield* DateTime.now),
        });
        yield* publish(projection);
        const next = yield* options.store.nextPendingRequestId(programId);
        if (Option.isSome(next)) yield* drain(programId, next.value);
        if (lease.requestId === fallbackRequestId) return result;
        const requested = yield* options.store.requestSnapshot(fallbackRequestId);
        return Option.isSome(requested)
          ? requested.value
          : snapshot(
              fallbackRequestId,
              rejected("lease_conflict", "The queued Program request remains pending."),
              projection,
            );
      });

    const start: ProgramRuntimeShape["start"] = (input) =>
      serial.withLock(
        input.attachment.programId,
        Effect.gen(function* () {
          const now = DateTime.formatIso(yield* DateTime.now);
          const existing = yield* options.store.load(input.attachment.programId);
          if (Option.isNone(existing)) {
            const capability = yield* options.goalDriver.capabilities();
            yield* options.store.create(input, makeInitialProgramProjection(input, capability));
          }
          const retained = yield* loadRequired(input.attachment.programId);
          const request = yield* options.store.beginRequest({
            programId: input.attachment.programId,
            requestId: input.requestId,
            operation: "start",
            inputJson: encodeStartInput(input),
            now,
          });
          if (request.kind === "completed") return request.snapshot;
          if (request.kind === "conflict") return conflictSnapshot(input.requestId, retained);
          const started = (yield* options.store.events(input.attachment.programId)).find(
            (event) => event.type === "program.started",
          );
          if (
            started?.type !== "program.started" ||
            !startIdentityMatches(started, retained.driverKind, input)
          ) {
            const result = snapshot(
              input.requestId,
              rejected(
                "attachment_mismatch",
                "This Program ID is already attached to a different Program identity.",
              ),
              retained.projection,
            );
            yield* options.store.completeRequest({
              requestId: input.requestId,
              snapshot: result,
              now,
            });
            return result;
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

    const recoverRequest = (
      input: WakeProgramInput,
    ): Effect.Effect<ProgramSnapshot, ProgramRuntimeError> =>
      wake(input).pipe(
        Effect.flatMap((result) => {
          if (result.decision.code !== "lease_conflict") return Effect.succeed(result);
          return Effect.gen(function* () {
            const expiresAt = yield* options.store.activeLeaseExpiresAt(input.programId);
            const now = DateTime.formatIso(yield* DateTime.now);
            const delayMillis = Option.match(expiresAt, {
              onNone: () => 1,
              onSome: (value) => Math.max(1, Date.parse(value) - Date.parse(now)),
            });
            yield* recoverRequest(input).pipe(
              Effect.delay(Duration.millis(delayMillis)),
              Effect.ignoreCause({ log: true }),
              Effect.forkIn(recoveryScope),
            );
            return result;
          });
        }),
      );

    const recover: ProgramRuntimeShape["recover"] = listPrograms.pipe(
      Effect.flatMap((programs) =>
        Effect.forEach(
          programs.programs.filter((program) => !program.terminal),
          (program) =>
            loadRequired(program.programId).pipe(
              Effect.flatMap((record) =>
                recoverRequest({
                  programId: program.programId,
                  requestId: ProgramRequestId.make(
                    `request:restart:${program.programId}:${record.projection.revision}`,
                  ),
                  cause: "restart",
                }),
              ),
            ),
          { concurrency: "unbounded" },
        ),
      ),
    );

    const subscribe: ProgramRuntimeShape["subscribe"] = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(updateSignal);
        const initial = yield* listPrograms;
        const records = yield* Effect.forEach(initial.programs, (program) =>
          loadRequired(program.programId),
        );
        const seenRevisions = yield* Ref.make(
          new Map(
            records.map((record) => [record.projection.programId, record.projection.revision]),
          ),
        );
        const liveUpdates = Stream.fromSubscription(subscription).pipe(
          Stream.mapEffect(() => Ref.get(latestUpdates)),
          Stream.flatMap((latest: ReadonlyMap<ProgramId, ProgramProjection>) =>
            Stream.fromIterable<ProgramProjection>(latest.values()),
          ),
          Stream.filterEffect((projection) =>
            Ref.modify(seenRevisions, (seen) => {
              const retained = seen.get(projection.programId);
              if (retained !== undefined && retained >= projection.revision) return [false, seen];
              const next = new Map(seen);
              next.set(projection.programId, projection.revision);
              return [true, next];
            }),
          ),
          Stream.map((projection): ProgramStreamItem => ({ kind: "program.updated", projection })),
        );
        return Stream.concat(
          Stream.fromIterable<ProgramStreamItem>([
            { kind: "snapshot", snapshot: initial },
            ...records.map(
              (record): ProgramStreamItem => ({
                kind: "program.updated",
                projection: record.projection,
              }),
            ),
            { kind: "synchronized" },
          ]),
          liveUpdates,
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

export const layer = Layer.effect(
  ProgramRuntime,
  Effect.gen(function* () {
    const store = yield* makeProgramStore;
    const goalDriver = yield* GoalDriver;
    const threadManagement = yield* ThreadManagementService;
    const commandReceipts = yield* CommandReceiptStoreV2;
    const repoRoot = process.env.T3_DIRTYLOOPS_REPO_ROOT?.trim();
    const sourceSkillRoot = process.env.T3_DIRTYLOOPS_SOURCE_SKILL_ROOT?.trim();
    const installedSkillRoot = process.env.T3_DIRTYLOOPS_INSTALLED_SKILL_ROOT?.trim();
    const driverPath = process.env.T3_DIRTYLOOPS_DRIVER_PATH?.trim();
    const readOnlyDriver: DirtyloopsProgramDriver =
      repoRoot && sourceSkillRoot && installedSkillRoot && driverPath
        ? makeDirtyloopsReadOnlyProgramDriver({
            projectId: ProjectId.make(
              process.env.T3_DIRTYLOOPS_PROJECT_ID?.trim() || "project:dirtyloops-readonly",
            ),
            modelSelection: {
              instanceId: ProviderInstanceId.make(
                process.env.T3_DIRTYLOOPS_PROVIDER_INSTANCE_ID?.trim() || "codex",
              ),
              model: process.env.T3_DIRTYLOOPS_MODEL?.trim() || "gpt-5.6-sol",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            invoke: yield* makeDirtyloopsProcessInvoker({
              executable: process.execPath,
              args: [
                driverPath,
                "reconcile",
                "--repo-root",
                repoRoot,
                "--source-skill-root",
                sourceSkillRoot,
                "--installed-skill-root",
                installedSkillRoot,
              ],
              cwd: repoRoot,
            }),
          })
        : {
            reconcile: () =>
              Effect.fail(
                new ProgramDriverError({
                  reason: "The read-only dirtyloops adapter is not configured for this T3 server.",
                }),
              ),
          };
    return yield* makeProgramRuntime({
      store,
      drivers: {
        deterministic_fake: makeDeterministicProgramDriver(),
        dirtyloops_readonly: readOnlyDriver,
      },
      executor: makeT3ProgramEffectExecutor(threadManagement, commandReceipts),
      goalDriver,
    });
  }),
);
