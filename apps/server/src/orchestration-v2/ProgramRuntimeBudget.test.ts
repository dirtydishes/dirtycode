import { assert, describe, expect, it } from "@effect/vitest";
import {
  ProgramAttemptId,
  type ProgramAttemptSnapshot,
  LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
  ProgramEffectId,
  ProgramPhaseId,
  ProgramRequestId,
  RunId,
  ThreadId,
  type ProgramEffect,
  type RuntimeReceipt,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  makeProgramRuntime,
  type DirtyloopsProgramDriver,
  type ProgramEffectExecutor,
} from "./ProgramRuntime.ts";
import { makeProgramStore } from "./ProgramStore.ts";

import {
  attemptId,
  goalDriver,
  makeTrackingExecutor,
  phaseId,
  programId,
  runtimeOptions,
  startInput,
} from "./ProgramRuntime.testkit.ts";

describe("ProgramRuntime budgets", () => {
  it.effect("stops dispatch when measured provider turns exhaust the Program budget", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      let reconcileCount = 0;
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          Effect.sync(() => {
            reconcileCount += 1;
            const revision = input.observedProgramRevision + 1;
            const budgets = input.observedProjection.budgets ?? {
              ...LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
              providerTurns: { used: 0, limit: 1 },
              measured: [],
              exhausted: [],
              dispatchAllowed: true,
            };
            const exhausted = budgets.providerTurns.used >= budgets.providerTurns.limit;
            const projection = {
              ...input.observedProjection,
              revision,
              state: exhausted ? ("attention_required" as const) : input.observedProjection.state,
              attentionReason: exhausted ? "Program provider-turn budget exhausted." : null,
              budgets,
              lastEventAt: input.occurredAt,
            };
            return exhausted
              ? {
                  kind: "attention_required" as const,
                  programRevision: revision,
                  projection,
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Measured budget stop accepted.",
                  },
                  reasonCode: "budget_exhausted",
                  evidence: [],
                }
              : {
                  kind: "wait" as const,
                  programRevision: revision,
                  projection,
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Budget baseline retained.",
                  },
                  reason: "Continue after measuring usage.",
                  wakeConditions: reconcileCount === 1 ? ["driver_continue"] : [],
                };
          }),
      };
      const observedAttempt = {
        attemptId,
        programId,
        taskId: phaseId,
        attemptKind: "task",
        candidateId: null,
        reviewId: null,
        reviewKind: null,
        title: "Measured owner Attempt",
        checkout: {
          repositoryRoot: "/repo",
          gitCommonDir: "/repo/.git",
          worktreePath: "/repo/worktrees/measured",
          branch: "measured",
          startingCommit: "a".repeat(40),
        },
        projectId: startInput.phases[0]!.projectId,
        threadId: ThreadId.make("thread:measured-owner"),
        runId: RunId.make("run:measured-owner"),
        state: "active",
        runStatus: "running",
        terminalResult: null,
        terminalAcknowledged: false,
        teamPolicy: { mode: "solo" },
        runtimeUsage: {
          activeThreads: 1,
          nativeHelpers: 0,
          helperDepth: 0,
          providerTurns: 1,
          wallClockMinutes: 1,
          tokens: null,
          costMilliUsd: null,
        },
      } satisfies ProgramAttemptSnapshot;
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: driver, dirtyloops: driver },
        observeAttemptSnapshots: () => Effect.succeed([observedAttempt]),
      });

      yield* runtime.start(startInput);
      const current = yield* runtime.read({ programId });

      expect(current.projection.state).toBe("attention_required");
      expect(current.projection.budgets?.providerTurns).toEqual({ used: 1, limit: 1 });
      expect(current.projection.budgets?.measured).toContain("providerTurns");
      expect(current.projection.budgets?.exhausted).toContain("providerTurns");
      expect(current.projection.budgets?.dispatchAllowed).toBe(false);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("stops dispatch on measured active threads without inventing token usage", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const limits = {
        ...LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
        activeThreads: { used: 0, limit: 2 },
        providerTurns: { used: 0, limit: 100 },
      };
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          Effect.sync(() => {
            const revision = input.observedProgramRevision + 1;
            const budgets = input.observedProjection.budgets ?? {
              ...limits,
              measured: [],
              exhausted: [],
              dispatchAllowed: true,
            };
            const exhausted = budgets.activeThreads.used >= budgets.activeThreads.limit;
            const projection = {
              ...input.observedProjection,
              revision,
              state: exhausted ? ("attention_required" as const) : input.observedProjection.state,
              attentionReason: exhausted ? "Program active-thread budget exhausted." : null,
              budgets,
              lastEventAt: input.occurredAt,
            };
            return exhausted
              ? {
                  kind: "attention_required" as const,
                  programRevision: revision,
                  projection,
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Measured thread budget stop accepted.",
                  },
                  reasonCode: "budget_exhausted",
                  evidence: [],
                }
              : {
                  kind: "wait" as const,
                  programRevision: revision,
                  projection,
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Budget baseline retained.",
                  },
                  reason: "Await a measured wake.",
                  wakeConditions: [],
                };
          }),
      };
      const observedAttempt = {
        attemptId,
        programId,
        taskId: phaseId,
        attemptKind: "task",
        candidateId: null,
        reviewId: null,
        reviewKind: null,
        title: "Measured team Attempt",
        checkout: {
          repositoryRoot: "/repo",
          gitCommonDir: "/repo/.git",
          worktreePath: "/repo/worktrees/measured-team",
          branch: "measured-team",
          startingCommit: "b".repeat(40),
        },
        projectId: startInput.phases[0]!.projectId,
        threadId: ThreadId.make("thread:measured-team-owner"),
        runId: RunId.make("run:measured-team-owner"),
        state: "active",
        runStatus: "running",
        terminalResult: null,
        terminalAcknowledged: false,
        teamPolicy: {
          mode: "native_collaborative",
          maxHelpers: 1,
          maxConcurrent: 1,
          maxDepth: 1,
        },
        runtimeUsage: {
          activeThreads: 2,
          nativeHelpers: 1,
          helperDepth: 1,
          providerTurns: 1,
          wallClockMinutes: 3,
          tokens: null,
          costMilliUsd: null,
        },
      } satisfies ProgramAttemptSnapshot;
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: driver, dirtyloops: driver },
        observeAttemptSnapshots: () => Effect.succeed([observedAttempt]),
      });
      yield* runtime.start(startInput);

      const current = yield* runtime.wake({
        programId,
        requestId: ProgramRequestId.make("request:measured-team-budget"),
        cause: "manual",
      });

      expect(current.projection.state).toBe("attention_required");
      expect(current.projection.budgets).toMatchObject({
        activeThreads: { used: 2, limit: 2 },
        nativeHelpers: { used: 1 },
        helperDepth: { used: 1 },
        providerTurns: { used: 1 },
        wallClockMinutes: { used: 3 },
        tokens: { used: 0 },
        costMilliUsd: { used: 0 },
        dispatchAllowed: false,
      });
      expect(current.projection.budgets?.measured).toEqual(
        expect.arrayContaining([
          "activeThreads",
          "nativeHelpers",
          "helperDepth",
          "providerTurns",
          "wallClockMinutes",
        ]),
      );
      expect(current.projection.budgets?.measured).not.toContain("tokens");
      expect(current.projection.budgets?.measured).not.toContain("costMilliUsd");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("stops dispatch when provider-reported cost reaches the Program budget", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const limits = {
        ...LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
        tokens: { used: 0, limit: 10_000 },
        costMilliUsd: { used: 0, limit: 1_000 },
      };
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          Effect.sync(() => {
            const revision = input.observedProgramRevision + 1;
            const budgets = input.observedProjection.budgets ?? {
              ...limits,
              measured: [],
              exhausted: [],
              dispatchAllowed: true,
            };
            const exhausted = budgets.costMilliUsd.used >= budgets.costMilliUsd.limit;
            const projection = {
              ...input.observedProjection,
              revision,
              state: exhausted ? ("attention_required" as const) : input.observedProjection.state,
              attentionReason: exhausted ? "Program provider-cost budget exhausted." : null,
              budgets,
              lastEventAt: input.occurredAt,
            };
            return exhausted
              ? {
                  kind: "attention_required" as const,
                  programRevision: revision,
                  projection,
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Measured provider cost stop accepted.",
                  },
                  reasonCode: "budget_exhausted",
                  evidence: [],
                }
              : {
                  kind: "wait" as const,
                  programRevision: revision,
                  projection,
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Provider cost baseline retained.",
                  },
                  reason: "Await measured provider usage.",
                  wakeConditions: [],
                };
          }),
      };
      const observedAttempts = [
        {
          attemptId: ProgramAttemptId.make("attempt:reported-provider-usage-a"),
          programId,
          taskId: phaseId,
          attemptKind: "task",
          candidateId: null,
          reviewId: null,
          reviewKind: null,
          title: "Reported provider usage A",
          checkout: {
            repositoryRoot: "/repo",
            gitCommonDir: "/repo/.git",
            worktreePath: "/repo/worktrees/reported-a",
            branch: "reported-a",
            startingCommit: "c".repeat(40),
          },
          projectId: startInput.phases[0]!.projectId,
          threadId: ThreadId.make("thread:reported-provider-usage-a"),
          runId: RunId.make("run:reported-provider-usage-a"),
          state: "active",
          runStatus: "running",
          terminalResult: null,
          terminalAcknowledged: false,
          teamPolicy: { mode: "solo" },
          runtimeUsage: {
            activeThreads: 1,
            nativeHelpers: 0,
            helperDepth: 0,
            providerTurns: 1,
            wallClockMinutes: 2,
            tokens: 40,
            costMilliUsd: 300,
          },
        },
        {
          attemptId: ProgramAttemptId.make("attempt:reported-provider-usage-b"),
          programId,
          taskId: phaseId,
          attemptKind: "task",
          candidateId: null,
          reviewId: null,
          reviewKind: null,
          title: "Reported provider usage B",
          checkout: {
            repositoryRoot: "/repo",
            gitCommonDir: "/repo/.git",
            worktreePath: "/repo/worktrees/reported-b",
            branch: "reported-b",
            startingCommit: "d".repeat(40),
          },
          projectId: startInput.phases[0]!.projectId,
          threadId: ThreadId.make("thread:reported-provider-usage-b"),
          runId: RunId.make("run:reported-provider-usage-b"),
          state: "active",
          runStatus: "running",
          terminalResult: null,
          terminalAcknowledged: false,
          teamPolicy: { mode: "solo" },
          runtimeUsage: {
            activeThreads: 1,
            nativeHelpers: 0,
            helperDepth: 0,
            providerTurns: 1,
            wallClockMinutes: 3,
            tokens: 60,
            costMilliUsd: 700,
          },
        },
      ] satisfies ReadonlyArray<ProgramAttemptSnapshot>;
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: driver, dirtyloops: driver },
        observeAttemptSnapshots: () => Effect.succeed(observedAttempts),
      });
      yield* runtime.start(startInput);

      const current = yield* runtime.wake({
        programId,
        requestId: ProgramRequestId.make("request:reported-provider-budget"),
        cause: "manual",
      });

      expect(current.projection.state).toBe("attention_required");
      expect(current.projection.budgets?.tokens).toEqual({ used: 100, limit: 10_000 });
      expect(current.projection.budgets?.costMilliUsd).toEqual({ used: 1_000, limit: 1_000 });
      expect(current.projection.budgets?.measured).toEqual(
        expect.arrayContaining(["tokens", "costMilliUsd"]),
      );
      expect(current.projection.budgets?.exhausted).toContain("costMilliUsd");
      expect(current.projection.budgets?.dispatchAllowed).toBe(false);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("stops dispatch when durable action receipts reach the Program budget", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const secondPhaseId = ProgramPhaseId.make("phase:measured-worktree-b");
      const measuredStart = {
        ...startInput,
        requestId: ProgramRequestId.make("request:measured-program-resources:start"),
        phases: [
          startInput.phases[0]!,
          {
            ...startInput.phases[0]!,
            phaseId: secondPhaseId,
            title: "Measured worktree B",
            phaseCoordinatorThreadId: ThreadId.make("thread:measured-worktree-b"),
            threadTitle: "Measured worktree B coordinator",
            branch: "feat/measured-worktree-b",
            worktreePath: "/repo/worktrees/measured-b",
          },
        ],
        attempts: [],
      } satisfies StartProgramInput;
      const limits = {
        ...LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
        actions: { used: 0, limit: 2 },
        concurrentWorktrees: { used: 0, limit: 2 },
      };
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          Effect.sync(() => {
            const revision = input.observedProgramRevision + 1;
            const budgets = input.observedProjection.budgets ?? {
              ...limits,
              measured: [],
              exhausted: [],
              dispatchAllowed: true,
            };
            if (budgets.actions.used >= budgets.actions.limit) {
              return {
                kind: "attention_required" as const,
                programRevision: revision,
                projection: {
                  ...input.observedProjection,
                  revision,
                  state: "attention_required" as const,
                  attentionReason: "Program action budget exhausted.",
                  budgets,
                  lastEventAt: input.occurredAt,
                },
                operatorDecision: {
                  status: "accepted" as const,
                  code: "accepted" as const,
                  message: "Measured action stop accepted.",
                },
                reasonCode: "budget_exhausted",
                evidence: [],
              };
            }
            const phase = input.observedProjection.phases.find(
              (candidate) => candidate.preparedWorktree === null,
            );
            if (phase === undefined) {
              return {
                kind: "wait" as const,
                programRevision: revision,
                projection: {
                  ...input.observedProjection,
                  revision,
                  budgets,
                  lastEventAt: input.occurredAt,
                },
                operatorDecision: {
                  status: "accepted" as const,
                  code: "accepted" as const,
                  message: "Program resources retained.",
                },
                reason: "Await a measured resource change.",
                wakeConditions: [],
              };
            }
            const ordinal = phase.phaseId === secondPhaseId ? "b" : "a";
            const effect = {
              effectId: ProgramEffectId.make(`effect:bind-measured-worktree:${ordinal}`),
              kind: "bind_prepared_worktree" as const,
              identity: {
                requestId: input.requestId,
                programId,
                phaseId: phase.phaseId,
                phaseCoordinatorThreadId: phase.phaseCoordinatorTargetThreadId,
                leaseId: `lease:measured-worktree:${ordinal}`,
                leaseEpoch: 1,
                repositoryIdentity: "dirtydishes/dirtycode",
                repositoryRoot: "/repo",
                gitCommonDir: "/repo/.git",
                realPath: `/repo/worktrees/measured-${ordinal}`,
                expectedIntegrationHead: "e".repeat(40),
                integrationRef: "refs/heads/feat/program-runtime-shell",
                budgetIdentity: `sha256:${"f".repeat(64)}`,
                symbolicBranch: `feat/measured-worktree-${ordinal}`,
                startingCommit: "e".repeat(40),
                clean: true,
                declaredPaths: [ordinal === "a" ? "apps/server" : "apps/web"],
                expiresAt: "2026-08-22T13:00:00.000Z",
                ownerThreadId: ThreadId.make(`thread:measured-owner-${ordinal}`),
                projectId: phase.projectId,
                ownerThreadTitle: `Measured owner ${ordinal.toUpperCase()}`,
                modelSelection: phase.modelSelection,
                runtimeMode: phase.runtimeMode,
                interactionMode: phase.interactionMode,
              },
            } satisfies ProgramEffect;
            return {
              kind: "effects" as const,
              programRevision: revision,
              projection: {
                ...input.observedProjection,
                revision,
                budgets,
                lastEventAt: input.occurredAt,
              },
              operatorDecision: {
                status: "accepted" as const,
                code: "accepted" as const,
                message: "Prepared-worktree bind accepted.",
              },
              proposalId: `proposal:bind-measured-worktree:${ordinal}`,
              effects: [effect],
            };
          }),
      };
      const retained = yield* Ref.make(new Map<string, RuntimeReceipt>());
      const executor: ProgramEffectExecutor = {
        observe: (effect) =>
          Ref.get(retained).pipe(
            Effect.map((receipts) => Option.fromNullishOr(receipts.get(effect.effectId))),
          ),
        execute: (effect, context) => {
          assert(effect.kind === "bind_prepared_worktree");
          const receipt = {
            receiptId: context.receiptId,
            programId: context.programId,
            programRevision: context.programRevision,
            effectId: effect.effectId,
            requestId: context.requestId,
            kind: "bind_prepared_worktree" as const,
            status: "succeeded" as const,
            resultDigest: `sha256:${"0".repeat(64)}`,
            evidence: [],
            createdAt: context.now,
            acknowledged: false,
            identity: effect.identity,
            result: { ownerThreadId: effect.identity.ownerThreadId, verifiedAt: context.now },
          } satisfies RuntimeReceipt;
          return Ref.update(retained, (receipts) =>
            new Map(receipts).set(effect.effectId, receipt),
          ).pipe(Effect.as(receipt));
        },
      };
      const runtime = yield* makeProgramRuntime({
        store,
        drivers: { deterministic_fake: driver, dirtyloops: driver },
        executor,
        goalDriver,
      });
      yield* runtime.start(measuredStart);
      yield* runtime.wake({
        programId,
        requestId: ProgramRequestId.make("request:measured-program-resources:second-bind"),
        cause: "manual",
      });
      const current = yield* runtime.wake({
        programId,
        requestId: ProgramRequestId.make("request:measured-program-resources:stop"),
        cause: "manual",
      });

      expect(current.projection.state).toBe("attention_required");
      expect(current.projection.budgets?.actions).toEqual({ used: 2, limit: 2 });
      expect(current.projection.budgets?.concurrentWorktrees).toEqual({ used: 2, limit: 2 });
      expect(current.projection.budgets?.measured).toEqual(
        expect.arrayContaining(["actions", "concurrentWorktrees"]),
      );
      expect(current.projection.budgets?.exhausted).toContain("actions");
      expect(current.projection.budgets?.dispatchAllowed).toBe(false);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("stops dispatch when Program wall-clock time reaches its budget", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const timedStart = {
        ...startInput,
        requestId: ProgramRequestId.make("request:program-wall-clock:start"),
        attachment: { ...startInput.attachment, createdAt },
        attempts: [],
      } satisfies StartProgramInput;
      const limits = {
        ...LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
        wallClockMinutes: { used: 0, limit: 5 },
      };
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          Effect.sync(() => {
            const revision = input.observedProgramRevision + 1;
            const budgets = input.observedProjection.budgets ?? {
              ...limits,
              measured: [],
              exhausted: [],
              dispatchAllowed: true,
            };
            const exhausted = budgets.wallClockMinutes.used >= budgets.wallClockMinutes.limit;
            return exhausted
              ? {
                  kind: "attention_required" as const,
                  programRevision: revision,
                  projection: {
                    ...input.observedProjection,
                    revision,
                    state: "attention_required" as const,
                    attentionReason: "Program wall-clock budget exhausted.",
                    budgets,
                    lastEventAt: input.occurredAt,
                  },
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Measured wall-clock stop accepted.",
                  },
                  reasonCode: "budget_exhausted",
                  evidence: [],
                }
              : {
                  kind: "wait" as const,
                  programRevision: revision,
                  projection: {
                    ...input.observedProjection,
                    revision,
                    budgets,
                    lastEventAt: input.occurredAt,
                  },
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Wall-clock baseline retained.",
                  },
                  reason: "Await the next Program wake.",
                  wakeConditions: [],
                };
          }),
      };
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: driver, dirtyloops: driver },
        observeAttemptSnapshots: () => Effect.succeed([]),
      });
      yield* runtime.start(timedStart);
      yield* TestClock.adjust("5 minutes");

      const current = yield* runtime.wake({
        programId,
        requestId: ProgramRequestId.make("request:program-wall-clock:stop"),
        cause: "timer",
      });

      expect(current.projection.state).toBe("attention_required");
      expect(current.projection.budgets?.wallClockMinutes).toEqual({ used: 5, limit: 5 });
      expect(current.projection.budgets?.measured).toContain("wallClockMinutes");
      expect(current.projection.budgets?.exhausted).toContain("wallClockMinutes");
      expect(current.projection.budgets?.dispatchAllowed).toBe(false);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("stops dispatch when a reviewed repair reaches the Program budget", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const attemptHistory = [
        {
          attemptId: ProgramAttemptId.make("attempt:retry-history:first-implementation"),
          phaseId,
          ownerKind: "implementation" as const,
          state: "acknowledged" as const,
          threadId: ThreadId.make("thread:retry-history:first-implementation"),
          terminalKind: "failed" as const,
          ownerResultId: null,
          resultDigest: null,
        },
        {
          attemptId: ProgramAttemptId.make("attempt:retry-history:second-implementation"),
          phaseId,
          ownerKind: "implementation" as const,
          state: "acknowledged" as const,
          threadId: ThreadId.make("thread:retry-history:second-implementation"),
          terminalKind: "succeeded" as const,
          ownerResultId: null,
          resultDigest: null,
        },
        {
          attemptId: ProgramAttemptId.make("attempt:retry-history:failed-review"),
          phaseId,
          ownerKind: "review" as const,
          state: "acknowledged" as const,
          threadId: ThreadId.make("thread:retry-history:failed-review"),
          terminalKind: "failed" as const,
          ownerResultId: null,
          resultDigest: null,
        },
        {
          attemptId: ProgramAttemptId.make("attempt:retry-history:reviewed-repair"),
          phaseId,
          ownerKind: "implementation" as const,
          state: "running" as const,
          threadId: ThreadId.make("thread:retry-history:reviewed-repair"),
          terminalKind: null,
          ownerResultId: null,
          resultDigest: null,
        },
      ];
      const retryStart = {
        ...startInput,
        requestId: ProgramRequestId.make("request:retry-repair-budget:start"),
        attempts: attemptHistory,
      } satisfies StartProgramInput;
      const limits = {
        ...LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
        repairs: { used: 0, limit: 1 },
        retries: { used: 0, limit: 10 },
      };
      const driver: DirtyloopsProgramDriver = {
        reconcile: (input) =>
          Effect.sync(() => {
            const revision = input.observedProgramRevision + 1;
            const budgets = input.observedProjection.budgets ?? {
              ...limits,
              measured: [],
              exhausted: [],
              dispatchAllowed: true,
            };
            const exhausted = budgets.repairs.used >= budgets.repairs.limit;
            return exhausted
              ? {
                  kind: "attention_required" as const,
                  programRevision: revision,
                  projection: {
                    ...input.observedProjection,
                    revision,
                    state: "attention_required" as const,
                    attentionReason: "Program repair budget exhausted.",
                    budgets,
                    lastEventAt: input.occurredAt,
                  },
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Measured repair stop accepted.",
                  },
                  reasonCode: "budget_exhausted",
                  evidence: [],
                }
              : {
                  kind: "wait" as const,
                  programRevision: revision,
                  projection: {
                    ...input.observedProjection,
                    revision,
                    budgets,
                    lastEventAt: input.occurredAt,
                  },
                  operatorDecision: {
                    status: "accepted" as const,
                    code: "accepted" as const,
                    message: "Retry and repair baseline retained.",
                  },
                  reason: "Await an Attempt-history change.",
                  wakeConditions: [],
                };
          }),
      };
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: driver, dirtyloops: driver },
      });
      yield* runtime.start(retryStart);

      const current = yield* runtime.wake({
        programId,
        requestId: ProgramRequestId.make("request:retry-repair-budget:stop"),
        cause: "manual",
      });

      expect(current.projection.state).toBe("attention_required");
      expect(current.projection.budgets?.retries).toEqual({ used: 1, limit: 10 });
      expect(current.projection.budgets?.repairs).toEqual({ used: 1, limit: 1 });
      expect(current.projection.budgets?.measured).toEqual(
        expect.arrayContaining(["retries", "repairs"]),
      );
      expect(current.projection.budgets?.exhausted).toContain("repairs");
      expect(current.projection.budgets?.dispatchAllowed).toBe(false);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
