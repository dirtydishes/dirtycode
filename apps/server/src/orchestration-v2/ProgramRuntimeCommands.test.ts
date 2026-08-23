import { assert, describe, expect, it } from "@effect/vitest";
import {
  ProgramAttemptId,
  type ProgramAttemptSnapshot,
  LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
  type ProgramDriverDecision,
  ProgramEffectId,
  ProgramId,
  ProgramPhaseId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ProgramEffect,
  type RuntimeReceipt,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeDeterministicProgramDriver } from "./Adapters/DeterministicProgramDriver.ts";
import { makeUnsupportedGoalDriver } from "./Adapters/GoalDriver.ts";
import {
  makeProgramRuntime,
  ProgramReceiptMismatchError,
  ProgramRuntimeHookError,
  type DirtyloopsProgramDriver,
  type ProgramEffectExecutor,
} from "./ProgramRuntime.ts";
import {
  makeProgramStore,
  ProgramStoreLeaseError,
  type ProgramStoreShape,
} from "./ProgramStore.ts";

import {
  TEST_CRASH_LEASE_SECONDS,
  attemptId,
  awaitScheduledRecovery,
  goalDriver,
  makeTrackingExecutor,
  phaseCoordinatorThreadId,
  phaseId,
  programId,
  runtimeOptions,
  startInput,
} from "./ProgramRuntime.testkit.ts";

describe("ProgramRuntime commands", () => {
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

  it.effect("durably requests replan without resuming an attention Program", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor({ status: "failed" });
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      const started = yield* runtime.start(startInput);
      expect(started.projection.state).toBe("attention_required");

      const replanned = yield* runtime.requestReplan({
        programId,
        requestId: ProgramRequestId.make("request:replan"),
      });

      expect(replanned.decision).toEqual({
        status: "accepted",
        code: "accepted",
        message: "Program replan requested.",
      });
      expect(replanned.projection.state).toBe("attention_required");
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
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
      expect(
        Option.isNone(
          yield* store.nextPendingRequestId(programId, DateTime.formatIso(yield* DateTime.now)),
        ),
      ).toBe(true);
      const settled = yield* second.wake(request);
      const repeated = yield* second.wake(request);
      expect(settled.decision.code).toBe("accepted");
      expect(repeated).toEqual(settled);
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      const eventSequences = (yield* store.events(programId)).map((event) => event.sequence);
      expect(eventSequences).toEqual(eventSequences.map((_sequence, index) => index + 1));
      expect(new Set(eventSequences).size).toBe(eventSequences.length);
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

  it.effect("rejects a repeated start whose durable attachment identity changed", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(startInput);
      const changed = {
        ...startInput,
        requestId: ProgramRequestId.make("request:start:mismatched"),
        attachment: { ...startInput.attachment, integrationRef: "refs/heads/other" },
      } satisfies StartProgramInput;
      const rejected = yield* runtime.start(changed);
      expect(rejected.decision).toMatchObject({
        status: "rejected",
        code: "attachment_mismatch",
      });
      expect(yield* runtime.start(changed)).toEqual(rejected);
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("fences two fresh runtimes racing to start different Program identities", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const emptyReads = yield* Ref.make(0);
      const bothObservedEmpty = yield* Deferred.make<void>();
      const racingStore: ProgramStoreShape = {
        ...store,
        load: (requestedProgramId) =>
          store.load(requestedProgramId).pipe(
            Effect.tap((loaded) =>
              Option.isSome(loaded)
                ? Effect.void
                : Ref.updateAndGet(emptyReads, (count) => count + 1).pipe(
                    Effect.flatMap((count) =>
                      count === 2
                        ? Deferred.succeed(bothObservedEmpty, undefined).pipe(Effect.asVoid)
                        : Effect.void,
                    ),
                    Effect.andThen(Deferred.await(bothObservedEmpty)),
                  ),
            ),
          ),
      };
      const tracking = yield* makeTrackingExecutor();
      const first = yield* makeProgramRuntime(runtimeOptions(racingStore, tracking.executor));
      const second = yield* makeProgramRuntime(runtimeOptions(racingStore, tracking.executor));
      const conflictingInput: StartProgramInput = {
        ...startInput,
        requestId: ProgramRequestId.make("request:start:conflicting-race"),
        title: "Conflicting Program identity",
      };

      const results = yield* Effect.all([first.start(startInput), second.start(conflictingInput)], {
        concurrency: "unbounded",
      });

      expect(results.map((result) => result.decision.code).sort()).toEqual([
        "accepted",
        "attachment_mismatch",
      ]);
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      const started = (yield* store.events(programId)).filter(
        (event) => event.type === "program.started",
      );
      expect(started).toHaveLength(1);
      expect([startInput.title, conflictingInput.title]).toContain(
        started[0]?.payload.projection.title,
      );
      expect(Option.isSome(yield* store.requestSnapshot(startInput.requestId))).toBe(true);
      expect(Option.isSome(yield* store.requestSnapshot(conflictingInput.requestId))).toBe(true);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("matches repeated start against the immutable initial attempt identity", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const base = makeDeterministicProgramDriver();
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          base.reconcile(input).pipe(
            Effect.map((decision) => ({
              ...decision,
              projection: {
                ...decision.projection,
                attempts: decision.projection.attempts.map((attempt) => ({
                  ...attempt,
                  state: "running" as const,
                })),
              },
            })),
          ),
      };
      const runtime = yield* makeProgramRuntime({
        store,
        drivers: { deterministic_fake: driver, dirtyloops: driver },
        executor: tracking.executor,
        goalDriver,
      });
      const started = yield* runtime.start(startInput);
      expect(started.projection.attempts[0]?.state).toBe("running");

      const repeated = yield* runtime.start({
        ...startInput,
        requestId: ProgramRequestId.make("request:start:original-identity"),
      });
      expect(repeated.decision.code).not.toBe("attachment_mismatch");
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("keeps failed and ambiguous launch receipts unbound and asks for attention", () =>
    Effect.gen(function* () {
      for (const status of ["failed", "ambiguous"] as const) {
        const store = yield* makeProgramStore;
        const tracking = yield* makeTrackingExecutor({ status });
        const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
        const started = yield* runtime.start({
          ...startInput,
          requestId: ProgramRequestId.make(`request:start:${status}`),
          attachment: {
            ...startInput.attachment,
            programId: ProgramId.make(`program:slice-1:${status}`),
          },
        });
        expect(started.projection.state).toBe("attention_required");
        expect(started.projection.phases[0]?.phaseCoordinatorThreadId).toBeNull();
        expect(
          started.projection.threadBindings.filter(
            (binding) => binding.role === "phase_coordinator",
          ),
        ).toHaveLength(0);
        expect(started.projection.activeAgentCount).toBe(0);
        const acknowledged = yield* runtime.wake({
          programId: started.projection.programId,
          requestId: ProgramRequestId.make(`request:${status}:acknowledge`),
          cause: "effect_receipt",
        });
        const retained = yield* runtime.wake({
          programId: started.projection.programId,
          requestId: ProgramRequestId.make(`request:${status}:retained`),
          cause: "manual",
        });
        expect(acknowledged.projection.state).toBe("attention_required");
        expect(retained.projection.state).toBe("attention_required");
        expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      }
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

  it.effect("gives two subscribers the same deep reconnect and live projections", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(startInput);
      const restartedRuntime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      const firstWire = yield* runtime.subscribe.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.map(Array.from),
      );
      const secondWire = yield* restartedRuntime.subscribe.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.map(Array.from),
      );
      expect(firstWire).toEqual(secondWire);

      const nextProjection = runtime.subscribe.pipe(
        Stream.drop(3),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
      const firstLive = yield* nextProjection.pipe(Effect.forkChild);
      const secondLive = yield* nextProjection.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* runtime.pause({
        programId,
        requestId: ProgramRequestId.make("request:stream-pause"),
      });
      const firstUpdate = yield* Fiber.join(firstLive);
      const secondUpdate = yield* Fiber.join(secondLive);
      expect(firstUpdate).toEqual(secondUpdate);
      assert(firstUpdate.kind === "program.updated");
      expect(firstUpdate.projection.state).toBe("paused");
      expect(firstUpdate.projection.phases[0]?.phaseId).toBe(phaseId);
      expect(firstUpdate.projection.attempts[0]?.attemptId).toBe(attemptId);
      expect(firstUpdate.projection.receipts[0]?.receiptId).toBe(
        secondUpdate.kind === "program.updated"
          ? secondUpdate.projection.receipts[0]?.receiptId
          : undefined,
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("coalesces a slow subscriber onto the latest Program revision", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(startInput);
      const subscriptionReady = yield* Deferred.make<void>();
      const firstUpdateSeen = yield* Deferred.make<void>();
      const releaseSlowConsumer = yield* Deferred.make<void>();
      const slow = yield* runtime.subscribe.pipe(
        Stream.tap((item) =>
          item.kind === "synchronized"
            ? Deferred.succeed(subscriptionReady, undefined).pipe(Effect.asVoid)
            : Effect.void,
        ),
        Stream.drop(3),
        Stream.tap(() =>
          Deferred.succeed(firstUpdateSeen, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSlowConsumer)),
          ),
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.map((items) => Array.from(items)),
        Effect.forkChild,
      );
      yield* Deferred.await(subscriptionReady);

      yield* runtime.pause({
        programId,
        requestId: ProgramRequestId.make("request:slow:pause:1"),
      });
      yield* Deferred.await(firstUpdateSeen);
      yield* runtime.resume({
        programId,
        requestId: ProgramRequestId.make("request:slow:resume:1"),
      });
      yield* runtime.pause({
        programId,
        requestId: ProgramRequestId.make("request:slow:pause:2"),
      });
      const latest = yield* runtime.resume({
        programId,
        requestId: ProgramRequestId.make("request:slow:resume:2"),
      });
      yield* Deferred.succeed(releaseSlowConsumer, undefined);

      const items = yield* Fiber.join(slow);
      const last = items.at(-1);
      assert(last?.kind === "program.updated");
      expect(last.projection.revision).toBe(latest.projection.revision);
      expect(last.projection.state).toBe("running");
    }).pipe(Effect.provide(SqlitePersistenceMemory), Effect.timeout("2 seconds")),
  );
});
