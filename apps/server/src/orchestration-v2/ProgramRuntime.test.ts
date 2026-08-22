import { assert, describe, expect, it } from "@effect/vitest";
import {
  ProgramId,
  ProgramPhaseId,
  ProgramRequestId,
  ThreadId,
  type ProgramEffect,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  makeDeterministicProgramDriver,
  makeProgramRuntime,
  ProgramRuntimeHookError,
  type ProgramEffectExecutor,
} from "./ProgramRuntime.ts";
import { makeProgramStore } from "./ProgramStore.ts";

const programId = ProgramId.make("program:slice-1");
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
      phaseId: ProgramPhaseId.make("phase:slice-1"),
      title: "Fake Phase",
      dependencyIds: [],
    },
  ],
  driverKind: "deterministic_fake",
} satisfies StartProgramInput;

function makeTrackingExecutor(options?: { readonly block?: Deferred.Deferred<void> }) {
  return Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ProgramEffect>>([]);
    const executor: ProgramEffectExecutor = {
      execute: (effect, context) =>
        Ref.update(calls, (current) => [...current, effect]).pipe(
          Effect.andThen(
            options?.block === undefined ? Effect.void : Deferred.await(options.block),
          ),
          Effect.map(() => ({
            receiptId: context.receiptId,
            programId: context.programId,
            programRevision: context.programRevision,
            effectId: effect.effectId,
            requestId: context.requestId,
            kind: "launch_phase_coordinator" as const,
            status: "succeeded" as const,
            resultDigest: `sha256:${effect.effectId}`,
            evidence: [],
            createdAt: context.now,
            acknowledged: false,
            identity:
              effect.kind === "launch_phase_coordinator"
                ? effect.identity
                : startInput.attachment.programId && {
                    programId,
                    phaseId: ProgramPhaseId.make("phase:slice-1"),
                    programCoordinatorThreadId: startInput.attachment.programCoordinatorThreadId,
                    requestId: context.requestId,
                  },
            result: { phaseCoordinatorThreadId: ThreadId.make("thread:phase-owner") },
          })),
        ),
    };
    return { calls, executor };
  });
}

describe("ProgramRuntime", () => {
  it.effect("retains one typed effect receipt across a crash before driver acknowledgement", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const driver = makeDeterministicProgramDriver();
      const firstRuntime = yield* makeProgramRuntime({
        store,
        driver,
        executor: tracking.executor,
        afterReceiptPersisted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "simulated_process_crash" })),
      });

      const interrupted = yield* firstRuntime.start(startInput).pipe(Effect.exit);
      assert(Exit.isFailure(interrupted));

      const recoveredRuntime = yield* makeProgramRuntime({
        store,
        driver,
        executor: tracking.executor,
      });
      const [recovered] = yield* recoveredRuntime.recover;
      const firstReconnectedClient = yield* recoveredRuntime.read({ programId });
      const secondReconnectedClient = yield* recoveredRuntime.read({ programId });
      const events = yield* store.events(programId);

      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      assert.isDefined(recovered);
      expect(recovered.projection.receipts).toHaveLength(1);
      expect(recovered.projection.receipts[0]).toMatchObject({
        receiptId: "receipt:effect:program:slice-1:1:launch_phase_coordinator",
        kind: "launch_phase_coordinator",
        acknowledged: true,
        result: { phaseCoordinatorThreadId: "thread:phase-owner" },
      });
      expect(firstReconnectedClient.projection.phases[0]).toMatchObject({
        phaseId: "phase:slice-1",
        ownerThreadId: "thread:phase-owner",
        receiptIds: ["receipt:effect:program:slice-1:1:launch_phase_coordinator"],
      });
      expect(firstReconnectedClient.projection.attempts[0]?.attemptId).toBe(
        "attempt:phase:slice-1:1",
      );
      expect({
        programId: firstReconnectedClient.projection.programId,
        phaseIds: firstReconnectedClient.projection.phases.map((phase) => phase.phaseId),
        attemptIds: firstReconnectedClient.projection.attempts.map((attempt) => attempt.attemptId),
        receiptIds: firstReconnectedClient.projection.receipts.map((receipt) => receipt.receiptId),
      }).toEqual({
        programId: secondReconnectedClient.projection.programId,
        phaseIds: secondReconnectedClient.projection.phases.map((phase) => phase.phaseId),
        attemptIds: secondReconnectedClient.projection.attempts.map((attempt) => attempt.attemptId),
        receiptIds: secondReconnectedClient.projection.receipts.map((receipt) => receipt.receiptId),
      });
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_event, index) => index + 1),
      );
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "program.started",
          "program.effect-proposed",
          "program.receipt-recorded",
          "program.receipts-acknowledged",
          "program.projection-saved",
        ]),
      );
      const latestProjectionEvent = events.findLast(
        (event) => event.type === "program.projection-saved",
      );
      assert.isDefined(latestProjectionEvent);
      expect(latestProjectionEvent.payload).toEqual(secondReconnectedClient.projection);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("returns stable decision codes for invalid pause, resume, and stop commands", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime({
        store,
        driver: makeDeterministicProgramDriver(),
        executor: tracking.executor,
      });
      yield* runtime.start(startInput);

      const invalidResume = yield* runtime.resume({
        programId,
        requestId: ProgramRequestId.make("request:resume:invalid"),
      });
      expect(invalidResume.decision).toMatchObject({ status: "rejected", code: "invalid_state" });

      const paused = yield* runtime.pause({
        programId,
        requestId: ProgramRequestId.make("request:pause"),
      });
      expect(paused.projection.state).toBe("paused");

      const duplicatePause = yield* runtime.pause({
        programId,
        requestId: ProgramRequestId.make("request:pause:invalid"),
      });
      expect(duplicatePause.decision.code).toBe("invalid_state");

      const resumed = yield* runtime.resume({
        programId,
        requestId: ProgramRequestId.make("request:resume"),
      });
      expect(resumed.projection.state).toBe("running");

      const stopped = yield* runtime.stop({
        programId,
        requestId: ProgramRequestId.make("request:stop"),
        reason: "test complete",
      });
      expect(stopped.projection.state).toBe("stopped");

      const invalidStop = yield* runtime.stop({
        programId,
        requestId: ProgramRequestId.make("request:stop:invalid"),
      });
      expect(invalidStop.decision.code).toBe("invalid_state");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("fences a second runtime while the first owns the durable wake lease", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const release = yield* Deferred.make<void>();
      const tracking = yield* makeTrackingExecutor({ block: release });
      const first = yield* makeProgramRuntime({
        store,
        driver: makeDeterministicProgramDriver(),
        executor: tracking.executor,
        workerId: "worker:first",
      });
      const second = yield* makeProgramRuntime({
        store,
        driver: makeDeterministicProgramDriver(),
        executor: tracking.executor,
        workerId: "worker:second",
      });

      const running = yield* first.start(startInput).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const fenced = yield* second.wake({
        programId,
        requestId: ProgramRequestId.make("request:concurrent"),
        cause: "manual",
      });
      expect(fenced.decision).toMatchObject({ status: "rejected", code: "lease_conflict" });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(running);
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory), Effect.timeout("2 seconds")),
  );
});
