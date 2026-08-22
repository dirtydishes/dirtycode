import { assert, describe, expect, it } from "@effect/vitest";
import {
  ProgramAttemptId,
  ProgramId,
  ProgramPhaseId,
  ProgramRequestId,
  ThreadId,
  type ProgramEffect,
  type RuntimeReceipt,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeDeterministicProgramDriver } from "./Adapters/DeterministicProgramDriver.ts";
import { makeUnsupportedGoalDriver } from "./Adapters/GoalDriver.ts";
import {
  makeProgramRuntime,
  ProgramReceiptMismatchError,
  ProgramRuntimeHookError,
  type ProgramEffectExecutor,
} from "./ProgramRuntime.ts";
import { makeProgramStore, type ProgramStoreShape } from "./ProgramStore.ts";

const programId = ProgramId.make("program:slice-1");
const phaseId = ProgramPhaseId.make("phase:unrelated-7");
const phaseCoordinatorThreadId = ThreadId.make("thread:ordinary-t3-phase-coordinator");
const attemptId = ProgramAttemptId.make("attempt:fixture-implementation-owner");
const goalDriver = makeUnsupportedGoalDriver(
  "Codex goal methods have not passed the dirtyloops certification suite.",
);

const startInput = {
  requestId: ProgramRequestId.make("request:start"),
  attachment: {
    programId,
    repositoryId: "dirtydishes/dirtycode",
    integrationRef: "refs/heads/feat/program-runtime-shell",
    programCoordinatorThreadId: ThreadId.make("thread:program-owner"),
    integrationCoordinatorThreadId: ThreadId.make("thread:integration-owner"),
    dirtyloopsGenerationId: "dirtyloops:3.0:test",
    dirtyloopsAdapterDigest: "sha256:deterministic-fake",
    t3EnvironmentId: "environment:test",
    createdAt: "2026-08-22T12:00:00.000Z",
  },
  title: "Recoverable Program shell",
  outcome: "Retain one fake T3 receipt across restart.",
  phases: [
    {
      phaseId,
      title: "Fake Phase",
      dependencyIds: [],
      phaseCoordinatorThreadId,
    },
  ],
  attempts: [
    {
      attemptId,
      phaseId,
      ownerKind: "implementation",
      state: "launch_pending",
      threadId: null,
      terminalKind: null,
    },
  ],
  driverKind: "deterministic_fake",
} satisfies StartProgramInput;

function makeTrackingExecutor(options?: {
  readonly block?: Deferred.Deferred<void>;
  readonly mismatch?: boolean;
}) {
  return Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ProgramEffect>>([]);
    const retained = yield* Ref.make(new Map<string, RuntimeReceipt>());
    const executor: ProgramEffectExecutor = {
      observe: (effect) =>
        Ref.get(retained).pipe(
          Effect.map((receipts) => Option.fromNullishOr(receipts.get(effect.effectId))),
        ),
      execute: (effect, context) =>
        Ref.update(calls, (current) => [...current, effect]).pipe(
          Effect.andThen(
            options?.block === undefined ? Effect.void : Deferred.await(options.block),
          ),
          Effect.flatMap(() => {
            assert(effect.kind === "launch_phase_coordinator");
            const receipt: RuntimeReceipt = {
              receiptId: context.receiptId,
              programId: context.programId,
              programRevision: context.programRevision,
              effectId: effect.effectId,
              requestId: context.requestId,
              kind: "launch_phase_coordinator",
              status: "succeeded",
              resultDigest: `sha256:${effect.effectId}`,
              evidence: [],
              createdAt: context.now,
              acknowledged: false,
              identity: effect.identity,
              result: {
                phaseCoordinatorThreadId:
                  options?.mismatch === true
                    ? ThreadId.make("thread:mismatched")
                    : effect.identity.phaseCoordinatorThreadId,
              },
            };
            return Ref.update(retained, (receipts) =>
              new Map(receipts).set(effect.effectId, receipt),
            ).pipe(Effect.as(receipt));
          }),
        ),
    };
    return { calls, executor };
  });
}

function runtimeOptions(store: ProgramStoreShape, executor: ProgramEffectExecutor) {
  return {
    store,
    driver: makeDeterministicProgramDriver(),
    executor,
    goalDriver,
  } as const;
}

describe("ProgramRuntime", () => {
  it.effect("replays a persisted receipt across three restarts without executing twice", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const firstRuntime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: 0,
        afterReceiptPersisted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_receipt_event" })),
      });
      assert(Exit.isFailure(yield* firstRuntime.start(startInput).pipe(Effect.exit)));

      let recoveredRuntime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* recoveredRuntime.recover;
      recoveredRuntime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* recoveredRuntime.recover;
      recoveredRuntime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* recoveredRuntime.recover;

      const firstClient = yield* recoveredRuntime.read({ programId });
      const secondClient = yield* recoveredRuntime.read({ programId });
      const events = yield* store.events(programId);
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      expect(firstClient.projection).toEqual(secondClient.projection);
      expect(firstClient.projection.phases[0]).toMatchObject({
        phaseId,
        phaseCoordinatorTargetThreadId: phaseCoordinatorThreadId,
        phaseCoordinatorThreadId,
        ownerThreadId: null,
      });
      expect(firstClient.projection.attempts).toEqual(startInput.attempts);
      expect(firstClient.projection.receipts).toHaveLength(1);
      expect(firstClient.projection.receipts[0]?.acknowledged).toBe(true);
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_event, index) => index + 1),
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("observes an external result after a crash before receipt persistence", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const first = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: 0,
        afterEffectExecuted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_effect_return" })),
      });
      assert(Exit.isFailure(yield* first.start(startInput).pipe(Effect.exit)));
      const second = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: 0,
      });
      yield* second.recover;
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      expect((yield* second.read({ programId })).projection.receipts).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("replays an acknowledged receipt after a crash before projection persistence", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const first = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* first.start(startInput);
      const crashing = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: 0,
        afterReceiptsAcknowledged: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_ack_event" })),
      });
      assert(
        Exit.isFailure(
          yield* crashing
            .wake({
              programId,
              requestId: ProgramRequestId.make("request:ack-boundary"),
              cause: "manual",
            })
            .pipe(Effect.exit),
        ),
      );
      const recovered = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: 0,
      });
      yield* recovered.recover;
      expect((yield* recovered.read({ programId })).projection.receipts[0]?.acknowledged).toBe(
        true,
      );
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("replays a saved projection after a crash before wake completion", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const crashing = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: 0,
        afterProjectionPersisted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_projection_event" })),
      });
      assert(Exit.isFailure(yield* crashing.start(startInput).pipe(Effect.exit)));
      const recovered = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* recovered.recover;
      expect((yield* recovered.read({ programId })).projection.receipts).toHaveLength(1);
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("keeps a paused Program paused across restart without another dispatch", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(startInput);
      yield* runtime.pause({ programId, requestId: ProgramRequestId.make("request:pause") });
      const restarted = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* restarted.recover;
      expect((yield* restarted.read({ programId })).projection.state).toBe("paused");
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("returns stable dirtyloops decision codes for operator commands", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(startInput);
      expect(
        (yield* runtime.resume({
          programId,
          requestId: ProgramRequestId.make("request:resume:invalid"),
        })).decision,
      ).toMatchObject({ status: "rejected", code: "invalid_state" });
      expect(
        (yield* runtime.pause({
          programId,
          requestId: ProgramRequestId.make("request:pause"),
        })).projection.state,
      ).toBe("paused");
      expect(
        (yield* runtime.resume({
          programId,
          requestId: ProgramRequestId.make("request:resume"),
        })).projection.state,
      ).toBe("running");
      expect(
        (yield* runtime.stop({
          programId,
          requestId: ProgramRequestId.make("request:stop"),
          reason: "test complete",
        })).projection.state,
      ).toBe("stopped");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("leaves a contended request pending and settles it after lease release", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const release = yield* Deferred.make<void>();
      const tracking = yield* makeTrackingExecutor({ block: release });
      const first = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        workerId: "worker:first",
      });
      const second = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        workerId: "worker:second",
      });
      const running = yield* first.start(startInput).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const request = {
        programId,
        requestId: ProgramRequestId.make("request:contended"),
        cause: "manual" as const,
      };
      expect((yield* second.wake(request)).decision.code).toBe("lease_conflict");
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(running);
      const settled = yield* second.wake(request);
      const repeated = yield* second.wake(request);
      expect(settled.decision.code).toBe("accepted");
      expect(repeated).toEqual(settled);
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory), Effect.timeout("2 seconds")),
  );

  it.effect("fails closed when a receipt does not match the proposed identity", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor({ mismatch: true });
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      const error = yield* runtime.start(startInput).pipe(Effect.flip);
      expect(error).toBeInstanceOf(ProgramReceiptMismatchError);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("projects the real Goal adapter capability instead of a UI assumption", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      const started = yield* runtime.start(startInput);
      expect(started.projection.goalCapability).toEqual({
        available: false,
        adapter: "unsupported",
        reason: "Codex goal methods have not passed the dirtyloops certification suite.",
      });
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("gives two real subscribers the same deep Program identities", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const firstRuntime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* firstRuntime.start(startInput);
      const secondRuntime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      const firstWire = yield* firstRuntime.subscribe.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.map(Array.from),
      );
      const secondWire = yield* secondRuntime.subscribe.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.map(Array.from),
      );
      expect(firstWire).toEqual(secondWire);

      const first = (yield* firstRuntime.read({ programId })).projection;
      const second = (yield* secondRuntime.read({ programId })).projection;
      const identities = (projection: typeof first) => ({
        programId: projection.programId,
        phaseIds: projection.phases.map((phase) => phase.phaseId),
        attemptIds: projection.attempts.map((attempt) => attempt.attemptId),
        receiptIds: projection.receipts.map((receipt) => receipt.receiptId),
      });
      expect(identities(first)).toEqual(identities(second));
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
