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

describe("ProgramRuntime recovery", () => {
  it.effect("automatically reconciles a retained effect receipt without a manual wake", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const wakeCauses = yield* Ref.make<Array<string>>([]);
      const baseDriver = makeDeterministicProgramDriver();
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          Ref.update(wakeCauses, (causes) => [...causes, input.wakeCause]).pipe(
            Effect.andThen(baseDriver.reconcile(input)),
          ),
      };
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: driver, dirtyloops: driver },
      });

      yield* runtime.start(startInput);

      expect(yield* Ref.get(wakeCauses)).toEqual(["start", "effect_receipt"]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect(
    "schedules a fresh durable decision after dirtyloops Admission before launching the next Phase",
    () =>
      Effect.gen(function* () {
        const store = yield* makeProgramStore;
        const tracking = yield* makeTrackingExecutor();
        const calls = yield* Ref.make<Array<{ readonly cause: string; readonly revision: number }>>(
          [],
        );
        const launch = {
          kind: "launch_phase_coordinator",
          effectId: ProgramEffectId.make("effect:next-phase-after-admission"),
          identity: {
            programId,
            phaseId,
            programCoordinatorThreadId: startInput.attachment.programCoordinatorThreadId,
            phaseCoordinatorThreadId,
            projectId: startInput.phases[0]!.projectId,
            threadTitle: "Next Phase coordinator",
            modelSelection: startInput.phases[0]!.modelSelection,
            runtimeMode: startInput.phases[0]!.runtimeMode,
            interactionMode: startInput.phases[0]!.interactionMode,
            branch: startInput.phases[0]!.branch,
            worktreePath: startInput.phases[0]!.worktreePath,
            requestId: ProgramRequestId.make("request:next-phase-after-admission"),
          },
        } satisfies ProgramEffect;
        const driver: DirtyloopsProgramDriver = {
          reconcile: (input) =>
            Ref.get(calls).pipe(
              Effect.flatMap((observed) =>
                Ref.update(calls, (current) => [
                  ...current,
                  { cause: input.wakeCause, revision: input.observedProgramRevision },
                ]).pipe(
                  Effect.as(
                    observed.length === 0
                      ? ({
                          kind: "wait",
                          programRevision: input.observedProgramRevision + 1,
                          projection: {
                            ...input.observedProjection,
                            revision: input.observedProgramRevision + 1,
                            lastEventAt: input.occurredAt,
                          },
                          operatorDecision: {
                            status: "accepted",
                            code: "accepted",
                            message: "Admission completed.",
                          },
                          reason: "Admission completed; recompute canonical readiness.",
                          wakeConditions: ["driver_continue"],
                        } satisfies ProgramDriverDecision)
                      : observed.length === 1
                        ? ({
                            kind: "effects",
                            programRevision: input.observedProgramRevision + 1,
                            projection: {
                              ...input.observedProjection,
                              revision: input.observedProgramRevision + 1,
                              lastEventAt: input.occurredAt,
                            },
                            operatorDecision: {
                              status: "accepted",
                              code: "accepted",
                              message: "Next Phase selected.",
                            },
                            proposalId: "proposal:next-phase-after-admission",
                            effects: [launch],
                          } satisfies ProgramDriverDecision)
                        : ({
                            kind: "wait",
                            programRevision: input.observedProgramRevision + 1,
                            projection: {
                              ...input.observedProjection,
                              revision: input.observedProgramRevision + 1,
                              lastEventAt: input.occurredAt,
                            },
                            operatorDecision: {
                              status: "accepted",
                              code: "accepted",
                              message: "Next Phase launch retained.",
                            },
                            reason: "Next Phase launch retained.",
                            wakeConditions: ["effect_receipt"],
                          } satisfies ProgramDriverDecision),
                  ),
                ),
              ),
            ),
        };
        const runtime = yield* makeProgramRuntime({
          store,
          drivers: { deterministic_fake: driver, dirtyloops: driver },
          executor: tracking.executor,
          goalDriver,
        });

        yield* runtime.start({ ...startInput, driverKind: "dirtyloops" });

        expect((yield* Ref.get(calls)).map((call) => call.cause)).toEqual([
          "start",
          "driver_continue",
          "effect_receipt",
        ]);
        expect(yield* Ref.get(tracking.calls)).toEqual([launch]);
      }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("recovers a durable lease-expiry wake after the scheduling process stops", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-08-22T12:00:00.000Z"));
      const store = yield* makeProgramStore;
      const wakeCauses = yield* Ref.make<Array<string>>([]);
      const ownerThreadId = ThreadId.make("thread:lease-expiry-owner");
      const expiresAt = "2026-08-22T12:00:01.000Z";
      const bindEffect = {
        kind: "bind_prepared_worktree",
        effectId: ProgramEffectId.make("effect:lease-expiry-bind"),
        identity: {
          programId,
          requestId: ProgramRequestId.make("request:lease-expiry-bind"),
          phaseId,
          phaseCoordinatorThreadId,
          ownerThreadId,
          projectId: ProjectId.make("project:program-runtime"),
          ownerThreadTitle: "Lease expiry owner",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-sol",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          leaseId: "lease:program:slice-1:phase:unrelated-7:1",
          leaseEpoch: 1,
          repositoryIdentity: "dirtydishes/dirtycode",
          repositoryRoot: "/home/delta/dev/dirtycode",
          gitCommonDir: "/home/delta/dev/dirtycode/.git",
          realPath: "/home/delta/dev/dirtycode-worktrees/lease-expiry",
          expectedIntegrationHead: "1".repeat(40),
          integrationRef: "refs/heads/feat/program-runtime-shell",
          budgetIdentity: "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
          symbolicBranch: "dirtyloops/lease-expiry",
          startingCommit: "1".repeat(40),
          clean: true,
          declaredPaths: ["apps/server"],
          expiresAt,
        },
      } satisfies ProgramEffect;
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          Ref.update(wakeCauses, (causes) => [...causes, input.wakeCause]).pipe(
            Effect.as(
              input.wakeCause === "start"
                ? ({
                    kind: "effects",
                    programRevision: input.observedProgramRevision + 1,
                    projection: {
                      ...input.observedProjection,
                      revision: input.observedProgramRevision + 1,
                      lastEventAt: input.occurredAt,
                    },
                    operatorDecision: {
                      status: "accepted",
                      code: "accepted",
                      message: "Prepared-worktree bind proposed.",
                    },
                    proposalId: "proposal:lease-expiry-bind:1",
                    effects: [bindEffect],
                  } satisfies ProgramDriverDecision)
                : ({
                    kind: "wait",
                    programRevision: input.observedProgramRevision + 1,
                    projection: {
                      ...input.observedProjection,
                      revision: input.observedProgramRevision + 1,
                      lastEventAt: input.occurredAt,
                    },
                    operatorDecision: {
                      status: "accepted",
                      code: "accepted",
                      message: "Wake observed.",
                    },
                    reason: "The fixture waits after retaining its worktree.",
                    wakeConditions: ["timer"],
                  } satisfies ProgramDriverDecision),
            ),
          ),
      };
      const executor: ProgramEffectExecutor = {
        observe: () => Effect.succeed(Option.none()),
        execute: (candidate, executionContext) => {
          assert(candidate.kind === "bind_prepared_worktree");
          return Effect.succeed({
            receiptId: executionContext.receiptId,
            programId: executionContext.programId,
            programRevision: executionContext.programRevision,
            effectId: candidate.effectId,
            requestId: executionContext.requestId,
            kind: "bind_prepared_worktree",
            status: "succeeded",
            resultDigest: `sha256:${"2".repeat(64)}`,
            evidence: [],
            createdAt: executionContext.now,
            acknowledged: false,
            identity: candidate.identity,
            result: { ownerThreadId, verifiedAt: executionContext.now },
          });
        },
      };
      const options = {
        store,
        drivers: { deterministic_fake: driver, dirtyloops: driver },
        executor,
        goalDriver,
      } as const;
      const stoppedRuntime = yield* Effect.scoped(makeProgramRuntime(options));
      yield* stoppedRuntime.start(startInput);

      const recoveredRuntime = yield* makeProgramRuntime(options);
      yield* recoveredRuntime.recover;
      yield* TestClock.adjust("1001 millis");
      for (let index = 0; index < 8; index += 1) yield* Effect.yieldNow;

      expect(yield* Ref.get(wakeCauses)).toContain("timer");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("wakes the Program when a bound T3 Attempt completes", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const completions = yield* PubSub.unbounded<ProgramAttemptSnapshot>();
      const wakeCauses = yield* Ref.make<Array<string>>([]);
      const baseDriver = makeDeterministicProgramDriver();
      const driver: DirtyloopsProgramDriver = {
        ...baseDriver,
        reconcile: (input) =>
          Ref.update(wakeCauses, (causes) => [...causes, input.wakeCause]).pipe(
            Effect.andThen(baseDriver.reconcile(input)),
          ),
      };
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: driver, dirtyloops: driver },
        attemptCompletions: Stream.fromPubSub(completions),
      });
      yield* runtime.start(startInput);
      yield* Effect.yieldNow;

      yield* PubSub.publish(completions, {
        attemptId,
        programId,
        taskId: "agents-0ur.4",
        attemptKind: "task",
        candidateId: null,
        reviewId: null,
        reviewKind: null,
        title: "Fixture implementation owner",
        checkout: {
          repositoryRoot: "/home/delta/dev/dirtycode",
          gitCommonDir: "/home/delta/dev/dirtycode/.git",
          worktreePath: "/home/delta/dev/dirtycode-worktrees/fixture",
          branch: "fixture",
          startingCommit: "abc123",
        },
        projectId: ProjectId.make("project:program-runtime"),
        threadId: ThreadId.make("thread:fixture-implementation-owner"),
        runId: RunId.make("run:fixture-implementation-owner"),
        state: "terminal",
        runStatus: "completed",
        terminalResult: {
          status: "completed",
          output: "Owner finished.",
          failure: null,
          completedAt: "2026-08-22T12:01:00.000Z",
        },
        terminalAcknowledged: false,
      });
      for (let index = 0; index < 8; index += 1) yield* Effect.yieldNow;

      expect(yield* Ref.get(wakeCauses)).toContain("attempt_completed");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("loads persisted Slice 1 projections after the Slice 2 schema upgrade", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(startInput);

      const sql = yield* SqlClient.SqlClient;
      const toSliceOneJson = (json: string) => {
        const visit = (value: unknown): void => {
          if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
          }
          if (value === null || typeof value !== "object") return;
          const record = value as Record<string, unknown>;
          for (const key of [
            "beadsStatus",
            "blockedBy",
            "blockerPath",
            "budgets",
            "policy",
            "certificationFailures",
            "sourceIdentity",
            "repositorySnapshot",
            "beadsRevision",
            "graphDigest",
          ]) {
            delete record[key];
          }
          for (const item of Object.values(record)) visit(item);
        };
        const value: unknown = JSON.parse(json);
        visit(value);
        return JSON.stringify(value);
      };

      const programs = yield* sql<{
        readonly program_id: string;
        readonly projection_json: string;
      }>`
        SELECT program_id, projection_json FROM programs
      `;
      for (const row of programs) {
        yield* sql`
          UPDATE programs
          SET projection_json = ${toSliceOneJson(row.projection_json)}
          WHERE program_id = ${row.program_id}
        `;
      }
      const events = yield* sql<{ readonly event_id: string; readonly event_json: string }>`
        SELECT event_id, event_json FROM program_events
      `;
      for (const row of events) {
        yield* sql`
          UPDATE program_events
          SET event_json = ${toSliceOneJson(row.event_json)}
          WHERE event_id = ${row.event_id}
        `;
      }
      const requests = yield* sql<{
        readonly request_id: string;
        readonly result_json: string | null;
      }>`
        SELECT request_id, result_json FROM program_requests
        WHERE result_json IS NOT NULL
      `;
      for (const row of requests) {
        assert(row.result_json !== null);
        yield* sql`
          UPDATE program_requests
          SET result_json = ${toSliceOneJson(row.result_json)}
          WHERE request_id = ${row.request_id}
        `;
      }

      const restarted = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* restarted.recover;
      const listed = yield* restarted.list;
      const read = yield* restarted.read({ programId });

      expect(listed.programs).toHaveLength(1);
      expect(read.projection.certificationFailures).toEqual([]);
      expect(read.projection.sourceIdentity).toBeNull();
      expect(read.projection.repositorySnapshot).toBeNull();
      expect(read.projection.phases[0]).toMatchObject({
        beadsStatus: null,
        blockedBy: [],
        blockerPath: [],
        budgets: null,
        policy: null,
      });
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("selects the persisted read-only driver without creating an Attempt or effect", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const fakeCalls = yield* Ref.make(0);
      const realCalls = yield* Ref.make(0);
      const passiveDriver = (calls: Ref.Ref<number>): DirtyloopsProgramDriver => ({
        reconcile: (input) =>
          Ref.update(calls, (value) => value + 1).pipe(
            Effect.as({
              kind: "wait" as const,
              programRevision: input.observedProgramRevision + 1,
              projection: {
                ...input.observedProjection,
                revision: input.observedProgramRevision + 1,
                lastEventAt: input.occurredAt,
              },
              operatorDecision: {
                status: "accepted" as const,
                code: "accepted" as const,
                message: "Read-only graph retained.",
              },
              reason: "Read-only graph retained.",
              wakeConditions: ["beads_changed"],
            }),
          ),
      });
      const runtime = yield* makeProgramRuntime({
        store,
        drivers: {
          deterministic_fake: passiveDriver(fakeCalls),
          dirtyloops: passiveDriver(realCalls),
        },
        executor: tracking.executor,
        goalDriver,
      });
      const result = yield* runtime.start({
        ...startInput,
        requestId: ProgramRequestId.make("request:readonly-driver"),
        phases: [],
        attempts: [],
        driverKind: "dirtyloops",
      });

      expect(yield* Ref.get(fakeCalls)).toBe(0);
      expect(yield* Ref.get(realCalls)).toBe(1);
      expect(yield* Ref.get(tracking.calls)).toEqual([]);
      expect(result.projection.phases).toEqual([]);
      expect(result.projection.attempts).toEqual([]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("replays a persisted receipt across three restarts without executing twice", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const firstRuntime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: TEST_CRASH_LEASE_SECONDS,
        afterReceiptPersisted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_receipt_event" })),
      });
      assert(Exit.isFailure(yield* firstRuntime.start(startInput).pipe(Effect.exit)));

      let recoveredRuntime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: TEST_CRASH_LEASE_SECONDS,
      });
      yield* recoveredRuntime.recover;
      yield* awaitScheduledRecovery;
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

  it.effect("does not release an effect after its durable wake lease expires", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: TEST_CRASH_LEASE_SECONDS,
        afterDecisionPersisted: () => Effect.sleep("100 millis"),
      });
      const startFiber = yield* runtime.start(startInput).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");

      const result = yield* Fiber.await(startFiber);

      assert(Exit.isFailure(result));
      expect(yield* Ref.get(tracking.calls)).toHaveLength(0);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("observes an external result after a crash before receipt persistence", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const first = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: TEST_CRASH_LEASE_SECONDS,
        afterEffectExecuted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_effect_return" })),
      });
      assert(Exit.isFailure(yield* first.start(startInput).pipe(Effect.exit)));
      const second = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: TEST_CRASH_LEASE_SECONDS,
      });
      yield* second.recover;
      yield* awaitScheduledRecovery;
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      expect((yield* second.read({ programId })).projection.receipts).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("fences a worker that finishes after lease expiry and recovers its T3 result", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const release = yield* Deferred.make<void>();
      const tracking = yield* makeTrackingExecutor({ block: release });
      const first = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      const running = yield* first.start(startInput).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("31 seconds");
      yield* Deferred.succeed(release, undefined);
      const staleWrite = yield* Fiber.join(running).pipe(Effect.flip);
      expect(staleWrite).toBeInstanceOf(ProgramStoreLeaseError);

      const recovered = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* recovered.recover;
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      expect((yield* recovered.read({ programId })).projection.receipts).toHaveLength(1);
    }).pipe(
      Effect.provide(Layer.merge(SqlitePersistenceMemory, TestClock.layer())),
      Effect.timeout("2 seconds"),
    ),
  );

  it.effect("recovers after the atomic decision event persists but the effect does not", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const recoveredProjection = yield* Deferred.make<void>();
      const first = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        afterDecisionPersisted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_decision_event" })),
      });
      assert(Exit.isFailure(yield* first.start(startInput).pipe(Effect.exit)));

      const recovered = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        afterProjectionPersisted: () => Deferred.succeed(recoveredProjection, undefined),
      });
      yield* recovered.recover;
      expect(yield* Ref.get(tracking.calls)).toHaveLength(0);
      yield* TestClock.adjust("31 seconds");
      yield* Deferred.await(recoveredProjection);
      expect(yield* Ref.get(tracking.calls)).toHaveLength(1);
      expect((yield* recovered.read({ programId })).projection.receipts).toHaveLength(1);
      const events = yield* store.events(programId);
      const recordedDecision = events.find((event) => event.type === "program.decision-recorded");
      const proposedEffect = events.find((event) => event.type === "program.effect-proposed");
      assert(recordedDecision?.type === "program.decision-recorded");
      assert(recordedDecision.payload.kind === "effects");
      assert(proposedEffect?.type === "program.effect-proposed");
      expect(proposedEffect.payload.effectId).toBe(recordedDecision.payload.effects[0]?.effectId);
      expect((yield* recovered.read({ programId })).projection.receipts[0]?.effectId).toBe(
        proposedEffect.payload.effectId,
      );
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_event, index) => index + 1),
      );
    }).pipe(Effect.provide(Layer.merge(SqlitePersistenceMemory, TestClock.layer()))),
  );

  it.effect("cancels a scheduled recovery retry when its runtime scope closes", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const firstTracking = yield* makeTrackingExecutor();
      const first = yield* makeProgramRuntime({
        ...runtimeOptions(store, firstTracking.executor),
        afterDecisionPersisted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_before_effect_execution" })),
      });
      assert(Exit.isFailure(yield* first.start(startInput).pipe(Effect.exit)));

      const recoveredTracking = yield* makeTrackingExecutor();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const recovered = yield* makeProgramRuntime(
            runtimeOptions(store, recoveredTracking.executor),
          );
          const results = yield* recovered.recover;
          expect(results[0]?.decision.code).toBe("lease_conflict");
        }),
      );

      yield* TestClock.adjust("31 seconds");
      yield* Effect.yieldNow;
      expect(yield* Ref.get(recoveredTracking.calls)).toHaveLength(0);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("replays an acknowledged receipt after a crash before projection persistence", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const crashing = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: TEST_CRASH_LEASE_SECONDS,
        afterReceiptsAcknowledged: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_ack_event" })),
      });
      assert(Exit.isFailure(yield* crashing.start(startInput).pipe(Effect.exit)));
      const recovered = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        leaseDurationSeconds: TEST_CRASH_LEASE_SECONDS,
      });
      yield* recovered.recover;
      yield* awaitScheduledRecovery;
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
        leaseDurationSeconds: TEST_CRASH_LEASE_SECONDS,
        afterProjectionPersisted: () =>
          Effect.fail(new ProgramRuntimeHookError({ cause: "crash_after_projection_event" })),
      });
      assert(Exit.isFailure(yield* crashing.start(startInput).pipe(Effect.exit)));
      const recovered = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* recovered.recover;
      yield* awaitScheduledRecovery;
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
});
