import { assert, describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ProgramAttemptId,
  ProgramEffectId,
  ProgramId,
  ProgramPhaseId,
  ProgramReceiptId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type ProgramAttemptSnapshot,
  type ProgramEffect,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { OrchestratorProjectionError } from "../Orchestrator.ts";
import type { CommandReceiptStoreV2Shape, CommandReceiptV2 } from "../CommandReceiptStore.ts";
import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import * as ProgramAttemptService from "../ProgramAttemptService.ts";
import { makeProgramOwnerResult } from "../ProgramOwnerResult.ts";
import type { ThreadLaunchInput } from "../ThreadLaunchService.ts";
import { makeT3ProgramEffectExecutor } from "./T3ProgramEffectExecutor.ts";

const programId = ProgramId.make("program:t3-effect-adapter");
const phaseCoordinatorThreadId = ThreadId.make("thread:t3-effect-adapter");
const projectId = ProjectId.make("project:t3-effect-adapter");
const providerInstanceId = ProviderInstanceId.make("codex");
const occurredAt = DateTime.makeUnsafe("2026-08-22T12:00:00.000Z");

const effect = {
  kind: "launch_phase_coordinator",
  effectId: ProgramEffectId.make(
    "effect:program:t3-effect-adapter:phase:adapter:1:launch_phase_coordinator",
  ),
  identity: {
    programId,
    phaseId: ProgramPhaseId.make("phase:adapter"),
    programCoordinatorThreadId: ThreadId.make("thread:program-owner"),
    phaseCoordinatorThreadId,
    projectId,
    threadTitle: "Adapter phase coordinator",
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feat/program-runtime-shell",
    worktreePath: "/home/delta/dev/dirtycode",
    requestId: ProgramRequestId.make("request:adapter"),
  },
} satisfies ProgramEffect;

const context: ProgramEffectExecutorContext = {
  programId,
  programRevision: 1,
  requestId: ProgramRequestId.make("request:adapter"),
  receiptId: ProgramReceiptId.make(`receipt:${effect.effectId}`),
  now: "2026-08-22T12:00:00.000Z",
};

function emptyProjection(): OrchestrationV2ThreadProjection {
  return {
    thread: {
      createdBy: "system",
      creationSource: "server",
      id: phaseCoordinatorThreadId,
      projectId,
      title: effect.identity.threadTitle,
      providerInstanceId,
      modelSelection: effect.identity.modelSelection,
      runtimeMode: effect.identity.runtimeMode,
      interactionMode: effect.identity.interactionMode,
      branch: effect.identity.branch,
      worktreePath: effect.identity.worktreePath,
      activeProviderThreadId: null,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: phaseCoordinatorThreadId,
      },
      forkedFrom: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: occurredAt,
  };
}

describe("T3ProgramEffectExecutor", () => {
  it.effect("recovers through a fresh adapter and reuses one idempotent T3 command identity", () =>
    Effect.gen(function* () {
      const projections = new Map<ThreadId, OrchestrationV2ThreadProjection>();
      const receipts = new Map<CommandId, CommandReceiptV2>();
      const dispatchedCommandIds: Array<string> = [];
      let durableCreates = 0;
      const threads = {
        dispatch: (command) =>
          Effect.sync(() => {
            assert(command.type === "thread.create");
            dispatchedCommandIds.push(command.commandId);
            if (!projections.has(command.threadId)) {
              durableCreates += 1;
              projections.set(command.threadId, emptyProjection());
            }
            receipts.set(command.commandId, {
              commandId: command.commandId,
              threadId: command.threadId,
              commandType: command.type,
              acceptedAt: occurredAt,
              resultSequence: 1,
              status: "accepted",
              error: null,
            });
            return { sequence: 1, storedEvents: [] };
          }),
        getThreadProjection: (threadId) =>
          Effect.suspend(() => {
            const projection = projections.get(threadId);
            return projection === undefined
              ? Effect.fail(new OrchestratorProjectionError({ threadId }))
              : Effect.succeed(projection);
          }),
      } satisfies Pick<ThreadManagementServiceShape, "dispatch" | "getThreadProjection">;
      const commandReceipts = {
        getByCommandId: (commandId) =>
          Effect.succeed(Option.fromNullishOr(receipts.get(commandId))),
      } satisfies Pick<CommandReceiptStoreV2Shape, "getByCommandId">;

      const firstProcess = makeT3ProgramEffectExecutor(threads, commandReceipts);
      expect(Option.isNone(yield* firstProcess.observe(effect, context))).toBe(true);
      yield* firstProcess.execute(effect, context);

      const restartedProcess = makeT3ProgramEffectExecutor(threads, commandReceipts);
      expect(Option.isSome(yield* restartedProcess.observe(effect, context))).toBe(true);
      yield* restartedProcess.execute(effect, context);

      expect(durableCreates).toBe(1);
      expect(dispatchedCommandIds).toEqual([
        `command:${effect.effectId}`,
        `command:${effect.effectId}`,
      ]);
    }),
  );

  it.effect(
    "binds one dirtyloops-prepared worktree and recovers launch, cancel, and result acknowledgement",
    () =>
      Effect.gen(function* () {
        const ownerThreadId = ThreadId.make("thread:t3-effect-owner");
        const attemptId = ProgramAttemptId.make("attempt:t3-effect-owner:1");
        const runId = RunId.make("run:t3-effect-owner:1");
        const preparedWorktree = {
          programId,
          requestId: ProgramRequestId.make("request:bind-owner"),
          phaseId: effect.identity.phaseId,
          phaseCoordinatorThreadId,
          ownerThreadId,
          projectId,
          ownerThreadTitle: "Slice 3 implementation owner",
          modelSelection: effect.identity.modelSelection,
          runtimeMode: effect.identity.runtimeMode,
          interactionMode: effect.identity.interactionMode,
          leaseId: "lease:phase:adapter:1",
          leaseEpoch: 1,
          repositoryIdentity: "dirtydishes/dirtycode",
          repositoryRoot: "/repo",
          gitCommonDir: "/repo/.git",
          realPath: "/repo-worktrees/program-phase",
          expectedIntegrationHead: "1".repeat(40),
          integrationRef: "refs/heads/main",
          budgetIdentity: "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
          symbolicBranch: "dirtyloops/program/phase",
          startingCommit: "1".repeat(40),
          clean: true,
          declaredPaths: ["apps/server"],
          expiresAt: "2026-08-22T12:30:00.000Z",
        } as const;
        const bindEffect = {
          kind: "bind_prepared_worktree",
          effectId: ProgramEffectId.make("effect:bind-owner"),
          identity: preparedWorktree,
        } satisfies ProgramEffect;
        const launchEffect = {
          kind: "launch_owner_attempt",
          effectId: ProgramEffectId.make("effect:launch-owner"),
          identity: {
            programId,
            requestId: ProgramRequestId.make("request:launch-owner"),
            phaseId: effect.identity.phaseId,
            phaseCoordinatorThreadId,
            attemptId,
            ownerThreadId,
            preparedWorktree,
            prompt: "Implement only the declared Slice 3 paths.",
            providerPolicy: {
              modelSelection: effect.identity.modelSelection,
              runtimeMode: effect.identity.runtimeMode,
              interactionMode: effect.identity.interactionMode,
            },
          },
        } satisfies ProgramEffect;
        const ownerProjection: OrchestrationV2ThreadProjection = {
          ...emptyProjection(),
          thread: {
            ...emptyProjection().thread,
            id: ownerThreadId,
            title: preparedWorktree.ownerThreadTitle,
            branch: preparedWorktree.symbolicBranch,
            worktreePath: preparedWorktree.realPath,
            lineage: {
              parentThreadId: null,
              relationshipToParent: null,
              rootThreadId: ownerThreadId,
            },
          },
        };
        const commandReceiptsById = new Map<CommandId, CommandReceiptV2>();
        const projections = new Map<ThreadId, OrchestrationV2ThreadProjection>();
        let verifyCount = 0;
        let bindCount = 0;
        let launchCount = 0;
        let cancelCount = 0;
        let acknowledgeCount = 0;
        let launched = false;
        let terminal = false;
        let acknowledged = false;
        const snapshot = (): ProgramAttemptSnapshot => ({
          attemptId,
          programId,
          taskId: effect.identity.phaseId,
          attemptKind: "task",
          candidateId: null,
          reviewId: null,
          reviewKind: null,
          title: preparedWorktree.ownerThreadTitle,
          checkout: {
            repositoryRoot: preparedWorktree.repositoryRoot,
            gitCommonDir: preparedWorktree.gitCommonDir,
            worktreePath: preparedWorktree.realPath,
            branch: preparedWorktree.symbolicBranch,
            startingCommit: preparedWorktree.startingCommit,
          },
          projectId,
          threadId: ownerThreadId,
          runId,
          state: terminal ? "terminal" : "active",
          runStatus: terminal ? "cancelled" : "running",
          terminalResult:
            terminal && !acknowledged
              ? {
                  status: "cancelled",
                  output: null,
                  failure: null,
                  completedAt: "2026-08-22T12:10:00.000Z",
                }
              : null,
          terminalAcknowledged: acknowledged,
        });
        const threads = {
          dispatch: () => Effect.die("phase dispatch is not used in this fixture"),
          getThreadProjection: (threadId: ThreadId) => {
            const projection = projections.get(threadId);
            return projection === undefined
              ? Effect.die("missing owner projection")
              : Effect.succeed(projection);
          },
        } satisfies Pick<ThreadManagementServiceShape, "dispatch" | "getThreadProjection">;
        const commandReceipts = {
          getByCommandId: (commandId: CommandId) =>
            Effect.succeed(Option.fromNullishOr(commandReceiptsById.get(commandId))),
        } satisfies Pick<CommandReceiptStoreV2Shape, "getByCommandId">;
        const mutable = {
          preparedWorktrees: {
            verify: () => {
              verifyCount += 1;
              return Effect.succeed({
                repositoryRoot: preparedWorktree.repositoryRoot,
                gitCommonDir: preparedWorktree.gitCommonDir,
                worktreePath: preparedWorktree.realPath,
                branch: preparedWorktree.symbolicBranch,
                startingCommit: preparedWorktree.startingCommit,
              });
            },
          },
          launches: {
            launch: (input: ThreadLaunchInput) => {
              bindCount += 1;
              projections.set(ownerThreadId, ownerProjection);
              commandReceiptsById.set(input.commandId, {
                commandId: input.commandId,
                threadId: ownerThreadId,
                commandType: "thread.create",
                acceptedAt: occurredAt,
                resultSequence: 1,
                status: "accepted",
                error: null,
              });
              return Effect.succeed({
                threadId: ownerThreadId,
                runId: null,
                projection: ownerProjection,
                resumed: false,
              });
            },
          },
          attempts: {
            launch: () => {
              launchCount += 1;
              launched = true;
              return Effect.succeed(snapshot());
            },
            observe: () =>
              launched
                ? Effect.succeed(snapshot())
                : Effect.fail(new ProgramAttemptService.ProgramAttemptNotFoundError({ attemptId })),
            cancel: () => {
              cancelCount += 1;
              terminal = true;
              return Effect.succeed(snapshot());
            },
            acknowledge: () => {
              acknowledgeCount += 1;
              acknowledged = true;
              return Effect.succeed(snapshot());
            },
          },
        };
        const adapter = makeT3ProgramEffectExecutor(threads, commandReceipts, mutable);

        expect(Option.isNone(yield* adapter.observe(bindEffect, context))).toBe(true);
        yield* adapter.execute(bindEffect, context);
        expect(Option.isSome(yield* adapter.observe(bindEffect, context))).toBe(true);
        expect({ verifyCount, bindCount }).toEqual({ verifyCount: 1, bindCount: 1 });

        expect(Option.isNone(yield* adapter.observe(launchEffect, context))).toBe(true);
        yield* adapter.execute(launchEffect, context);
        const restarted = makeT3ProgramEffectExecutor(threads, commandReceipts, mutable);
        expect(Option.isSome(yield* restarted.observe(launchEffect, context))).toBe(true);
        expect(launchCount).toBe(1);

        const cancelEffect = {
          ...launchEffect,
          kind: "cancel_owner_attempt",
          effectId: ProgramEffectId.make("effect:cancel-owner"),
        } satisfies ProgramEffect;
        yield* adapter.execute(cancelEffect, context);
        expect(Option.isSome(yield* restarted.observe(cancelEffect, context))).toBe(true);
        expect(cancelCount).toBe(1);

        const ownerResult = makeProgramOwnerResult({
          programId,
          phaseId: effect.identity.phaseId,
          phaseCoordinatorThreadId,
          ownerKind: "implementation",
          snapshot: snapshot(),
        });
        assert(ownerResult !== null);
        const acknowledgeEffect = {
          kind: "acknowledge_owner_result",
          effectId: ProgramEffectId.make("effect:ack-owner-result"),
          identity: {
            requestId: ProgramRequestId.make("request:ack-owner-result"),
            ...ownerResult,
            leaseId: preparedWorktree.leaseId,
            leaseEpoch: preparedWorktree.leaseEpoch,
            expiresAt: preparedWorktree.expiresAt,
          },
        } satisfies ProgramEffect;
        yield* adapter.execute(acknowledgeEffect, context);
        expect(Option.isSome(yield* restarted.observe(acknowledgeEffect, context))).toBe(true);
        expect(acknowledgeCount).toBe(1);

        const foreignAcknowledgement = {
          ...acknowledgeEffect,
          effectId: ProgramEffectId.make("effect:ack-owner-result:foreign-phase"),
          identity: {
            ...acknowledgeEffect.identity,
            phaseId: ProgramPhaseId.make("phase:foreign"),
          },
        } satisfies ProgramEffect;
        const foreignFailure = yield* restarted
          .observe(foreignAcknowledgement, context)
          .pipe(Effect.flip);
        expect(String(foreignFailure.cause)).toContain("ProgramAttempt identity does not match");
      }),
  );

  it.effect("rejects an expired dirtyloops mutation lease before T3 touches the owner", () =>
    Effect.gen(function* () {
      let verifyCount = 0;
      const expired = {
        kind: "bind_prepared_worktree",
        effectId: ProgramEffectId.make("effect:expired-bind"),
        identity: {
          programId,
          requestId: ProgramRequestId.make("request:expired-bind"),
          phaseId: effect.identity.phaseId,
          phaseCoordinatorThreadId,
          ownerThreadId: ThreadId.make("thread:expired-owner"),
          projectId,
          ownerThreadTitle: "Expired owner",
          modelSelection: effect.identity.modelSelection,
          runtimeMode: effect.identity.runtimeMode,
          interactionMode: effect.identity.interactionMode,
          leaseId: "lease:expired",
          leaseEpoch: 1,
          repositoryIdentity: "dirtydishes/dirtycode",
          repositoryRoot: "/repo",
          gitCommonDir: "/repo/.git",
          realPath: "/repo-worktrees/expired",
          expectedIntegrationHead: "1".repeat(40),
          integrationRef: "refs/heads/main",
          budgetIdentity: "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
          symbolicBranch: "dirtyloops/expired",
          startingCommit: "1".repeat(40),
          clean: true,
          declaredPaths: [],
          expiresAt: "2026-08-22T11:59:59.000Z",
        },
      } satisfies ProgramEffect;
      const unavailableThreads = {
        dispatch: () => Effect.die("must not dispatch"),
        getThreadProjection: () => Effect.die("must not project"),
      } satisfies Pick<ThreadManagementServiceShape, "dispatch" | "getThreadProjection">;
      const noReceipts = {
        getByCommandId: () => Effect.succeed(Option.none()),
      } satisfies Pick<CommandReceiptStoreV2Shape, "getByCommandId">;
      const mutable = {
        preparedWorktrees: {
          verify: () => {
            verifyCount += 1;
            return Effect.die("must not verify");
          },
        },
        launches: { launch: () => Effect.die("must not bind") },
        attempts: {
          launch: () => Effect.die("must not launch"),
          observe: () => Effect.die("must not observe"),
          cancel: () => Effect.die("must not cancel"),
          acknowledge: () => Effect.die("must not acknowledge"),
        },
      };
      const adapter = makeT3ProgramEffectExecutor(unavailableThreads, noReceipts, mutable);
      const failure = yield* adapter.execute(expired, context).pipe(Effect.flip);
      expect(String(failure.cause)).toContain("lease expired");
      expect(verifyCount).toBe(0);
    }),
  );
});
