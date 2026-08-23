import { assert, describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  OwnerResult as OwnerResultSchema,
  OwnerResultAcknowledgement,
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
  TurnItemId,
  type OrchestrationV2ThreadProjection,
  type OwnerResult,
  type ProgramAttemptSnapshot,
  type ProgramEffect,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

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
const decodeOwnerResult = Schema.decodeUnknownSync(Schema.fromJsonString(OwnerResultSchema));
const encodeOwnerResultAcknowledgement = Schema.encodeSync(
  Schema.fromJsonString(OwnerResultAcknowledgement),
);

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
    "requires the Phase coordinator's typed acknowledgement before acknowledging an OwnerResult",
    () =>
      Effect.gen(function* () {
        const ownerThreadId = ThreadId.make("thread:t3-effect-owner-ack");
        const attemptId = ProgramAttemptId.make("attempt:t3-effect-owner-ack:1");
        const runId = RunId.make("run:t3-effect-owner-ack:1");
        const coordinatorRunId = RunId.make("run:t3-effect-phase-ack:1");
        const coordinatorMessageId = MessageId.make("message:t3-effect-phase-ack:1");
        const preparedWorktree = {
          programId,
          requestId: ProgramRequestId.make("request:owner-ack"),
          phaseId: effect.identity.phaseId,
          phaseCoordinatorThreadId,
          ownerThreadId,
          projectId,
          ownerThreadTitle: "Slice 3 acknowledgement owner",
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
          expiresAt: "2099-08-22T12:30:00.000Z",
        } as const;
        const snapshot: ProgramAttemptSnapshot = {
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
          state: "terminal",
          runStatus: "completed",
          terminalResult: {
            status: "completed",
            output: "Owner finished the requested Phase work.",
            failure: null,
            completedAt: "2026-08-22T12:10:00.000Z",
          },
          terminalAcknowledged: false,
        };
        const ownerResult = makeProgramOwnerResult({
          programId,
          phaseId: effect.identity.phaseId,
          phaseCoordinatorThreadId,
          ownerKind: "implementation",
          snapshot,
        });
        assert(ownerResult !== null);
        const acknowledgeEffect = {
          kind: "acknowledge_owner_result",
          effectId: ProgramEffectId.make("effect:coordinator-ack-owner-result"),
          identity: {
            requestId: ProgramRequestId.make("request:coordinator-ack-owner-result"),
            ...ownerResult,
            leaseId: preparedWorktree.leaseId,
            leaseEpoch: preparedWorktree.leaseEpoch,
            expiresAt: preparedWorktree.expiresAt,
          },
        } satisfies ProgramEffect;
        const acknowledgementText = encodeOwnerResultAcknowledgement({
          kind: "owner_result_acknowledgement",
          ownerResultId: ownerResult.ownerResultId,
          programId,
          phaseId: effect.identity.phaseId,
          phaseCoordinatorThreadId,
          ownerThreadId,
          attemptId,
          resultDigest: ownerResult.resultDigest,
          leaseId: preparedWorktree.leaseId,
          leaseEpoch: preparedWorktree.leaseEpoch,
          accepted: true,
        });
        const coordinatorProjection = (): OrchestrationV2ThreadProjection => ({
          ...emptyProjection(),
          runs: [
            {
              id: coordinatorRunId,
              threadId: phaseCoordinatorThreadId,
              ordinal: 1,
              providerInstanceId,
              modelSelection: effect.identity.modelSelection,
              providerThreadId: null,
              userMessageId: coordinatorMessageId,
              rootNodeId: null,
              activeAttemptId: null,
              status: "completed",
              requestedAt: occurredAt,
              startedAt: occurredAt,
              completedAt: occurredAt,
              checkpointId: null,
              contextHandoffId: null,
            },
          ],
          turnItems: [
            {
              id: TurnItemId.make("turn-item:t3-effect-phase-ack:assistant"),
              threadId: phaseCoordinatorThreadId,
              runId: coordinatorRunId,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 1,
              status: "completed",
              title: null,
              startedAt: occurredAt,
              completedAt: occurredAt,
              updatedAt: occurredAt,
              type: "assistant_message",
              messageId: MessageId.make("message:t3-effect-phase-ack:assistant"),
              text: acknowledgementText,
              streaming: false,
            },
          ],
        });
        let sendCount = 0;
        let acknowledgeCount = 0;
        const boundaryOrder: Array<string> = [];
        const threads = {
          dispatch: () => Effect.die("phase dispatch is not used in this fixture"),
          getThreadProjection: (threadId: ThreadId) =>
            threadId === phaseCoordinatorThreadId
              ? Effect.succeed(coordinatorProjection())
              : Effect.die("unexpected thread projection"),
          sendToThread: (input) => {
            sendCount += 1;
            boundaryOrder.push("phase_coordinator_send");
            expect(input.threadId).toBe(phaseCoordinatorThreadId);
            expect(decodeOwnerResult(input.text)).toEqual(ownerResult);
            const projection = coordinatorProjection();
            return Effect.succeed({
              dispatch: { sequence: 1, storedEvents: [] },
              projection,
              message: {
                id: input.messageId,
                threadId: phaseCoordinatorThreadId,
                runId: coordinatorRunId,
                nodeId: null,
                role: "user",
                text: input.text,
                attachments: [],
                streaming: false,
                createdBy: "system",
                creationSource: "server",
                createdAt: occurredAt,
                updatedAt: occurredAt,
              },
              run: projection.runs[0]!,
              turnItem: null,
              delivery: "started",
            });
          },
          waitForThread: () =>
            Effect.succeed({
              threadId: phaseCoordinatorThreadId,
              run: coordinatorProjection().runs[0]!,
              timedOut: false,
            }),
        } satisfies Pick<
          ThreadManagementServiceShape,
          "dispatch" | "getThreadProjection" | "sendToThread" | "waitForThread"
        >;
        const noReceipts = {
          getByCommandId: () => Effect.succeed(Option.none()),
        } satisfies Pick<CommandReceiptStoreV2Shape, "getByCommandId">;
        const mutable = {
          preparedWorktrees: { verify: () => Effect.die("must not verify") },
          launches: { launch: () => Effect.die("must not bind") },
          attempts: {
            launch: () => Effect.die("must not launch"),
            observe: () => Effect.succeed(snapshot),
            cancel: () => Effect.die("must not cancel"),
            acknowledge: () => {
              acknowledgeCount += 1;
              boundaryOrder.push("attempt_acknowledge");
              return Effect.succeed({ ...snapshot, terminalAcknowledged: true });
            },
          },
        };

        const adapter = makeT3ProgramEffectExecutor(threads, noReceipts, mutable);
        yield* adapter.execute(acknowledgeEffect, context);

        expect(sendCount).toBe(1);
        expect(acknowledgeCount).toBe(1);
        expect(boundaryOrder).toEqual(["phase_coordinator_send", "attempt_acknowledge"]);
      }),
  );

  it.effect("checks current time immediately before releasing an owner provider launch", () =>
    Effect.gen(function* () {
      const ownerThreadId = ThreadId.make("thread:stale-time-owner");
      const attemptId = ProgramAttemptId.make("attempt:stale-time-owner:1");
      const launchEffect = {
        kind: "launch_owner_attempt",
        effectId: ProgramEffectId.make("effect:stale-time-launch"),
        identity: {
          programId,
          requestId: ProgramRequestId.make("request:stale-time-launch"),
          phaseId: effect.identity.phaseId,
          phaseCoordinatorThreadId,
          attemptId,
          ownerThreadId,
          preparedWorktree: {
            programId,
            requestId: ProgramRequestId.make("request:stale-time-worktree"),
            phaseId: effect.identity.phaseId,
            phaseCoordinatorThreadId,
            ownerThreadId,
            projectId,
            ownerThreadTitle: "Stale-time owner",
            modelSelection: effect.identity.modelSelection,
            runtimeMode: effect.identity.runtimeMode,
            interactionMode: effect.identity.interactionMode,
            leaseId: "lease:stale-time",
            leaseEpoch: 1,
            repositoryIdentity: "dirtydishes/dirtycode",
            repositoryRoot: "/repo",
            gitCommonDir: "/repo/.git",
            realPath: "/repo-worktrees/stale-time",
            expectedIntegrationHead: "1".repeat(40),
            integrationRef: "refs/heads/main",
            budgetIdentity:
              "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
            symbolicBranch: "dirtyloops/stale-time",
            startingCommit: "1".repeat(40),
            clean: true,
            declaredPaths: ["apps/server"],
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
          prompt: "This provider must not start after lease expiry.",
          providerPolicy: {
            modelSelection: effect.identity.modelSelection,
            runtimeMode: effect.identity.runtimeMode,
            interactionMode: effect.identity.interactionMode,
          },
        },
      } satisfies ProgramEffect;
      let launchCount = 0;
      const unavailableThreads = {
        dispatch: () => Effect.die("must not dispatch"),
        getThreadProjection: () => Effect.die("must not project"),
        sendToThread: () => Effect.die("must not send"),
        waitForThread: () => Effect.die("must not wait"),
      } satisfies Pick<
        ThreadManagementServiceShape,
        "dispatch" | "getThreadProjection" | "sendToThread" | "waitForThread"
      >;
      const noReceipts = {
        getByCommandId: () => Effect.succeed(Option.none()),
      } satisfies Pick<CommandReceiptStoreV2Shape, "getByCommandId">;
      const mutable = {
        preparedWorktrees: { verify: () => Effect.die("must not verify") },
        launches: { launch: () => Effect.die("must not bind") },
        attempts: {
          launch: () => {
            launchCount += 1;
            return Effect.succeed({
              attemptId,
              programId,
              taskId: effect.identity.phaseId,
              attemptKind: "task" as const,
              candidateId: null,
              reviewId: null,
              reviewKind: null,
              title: launchEffect.identity.preparedWorktree.ownerThreadTitle,
              checkout: {
                repositoryRoot: "/repo",
                gitCommonDir: "/repo/.git",
                worktreePath: "/repo-worktrees/stale-time",
                branch: "dirtyloops/stale-time",
                startingCommit: "1".repeat(40),
              },
              projectId,
              threadId: ownerThreadId,
              runId: RunId.make("run:stale-time-owner:1"),
              state: "active" as const,
              runStatus: "running" as const,
              terminalResult: null,
              terminalAcknowledged: false,
            });
          },
          observe: () => Effect.die("must not observe"),
          cancel: () => Effect.die("must not cancel"),
          acknowledge: () => Effect.die("must not acknowledge"),
        },
      };
      const staleContext = { ...context, now: "2019-12-31T23:59:00.000Z" };
      const adapter = makeT3ProgramEffectExecutor(unavailableThreads, noReceipts, mutable, {
        now: Effect.succeed("2020-01-01T00:00:01.000Z"),
      });

      const result = yield* adapter.execute(launchEffect, staleContext).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      expect(launchCount).toBe(0);
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
          expiresAt: "2099-08-22T12:30:00.000Z",
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
        const coordinatorRunId = RunId.make("run:t3-effect-owner:coordinator-ack");
        let phaseProjection = emptyProjection();
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
            if (threadId === phaseCoordinatorThreadId) return Effect.succeed(phaseProjection);
            const projection = projections.get(threadId);
            return projection === undefined
              ? Effect.die("missing owner projection")
              : Effect.succeed(projection);
          },
          sendToThread: (input) => {
            const delivered: OwnerResult = decodeOwnerResult(input.text);
            const acknowledgement = encodeOwnerResultAcknowledgement({
              kind: "owner_result_acknowledgement",
              ownerResultId: delivered.ownerResultId,
              programId: delivered.programId,
              phaseId: delivered.phaseId,
              phaseCoordinatorThreadId: delivered.phaseCoordinatorThreadId,
              ownerThreadId: delivered.ownerThreadId,
              attemptId: delivered.attemptId,
              resultDigest: delivered.resultDigest,
              leaseId: preparedWorktree.leaseId,
              leaseEpoch: preparedWorktree.leaseEpoch,
              accepted: true,
            });
            const run = {
              id: coordinatorRunId,
              threadId: phaseCoordinatorThreadId,
              ordinal: 1,
              providerInstanceId,
              modelSelection: effect.identity.modelSelection,
              providerThreadId: null,
              userMessageId: input.messageId,
              rootNodeId: null,
              activeAttemptId: null,
              status: "completed" as const,
              requestedAt: occurredAt,
              startedAt: occurredAt,
              completedAt: occurredAt,
              checkpointId: null,
              contextHandoffId: null,
            };
            phaseProjection = {
              ...emptyProjection(),
              runs: [run],
              turnItems: [
                {
                  id: TurnItemId.make("turn-item:t3-effect-owner:coordinator-ack"),
                  threadId: phaseCoordinatorThreadId,
                  runId: coordinatorRunId,
                  nodeId: null,
                  providerThreadId: null,
                  providerTurnId: null,
                  nativeItemRef: null,
                  parentItemId: null,
                  ordinal: 1,
                  status: "completed",
                  title: null,
                  startedAt: occurredAt,
                  completedAt: occurredAt,
                  updatedAt: occurredAt,
                  type: "assistant_message",
                  messageId: MessageId.make("message:t3-effect-owner:coordinator-ack"),
                  text: acknowledgement,
                  streaming: false,
                },
              ],
            };
            return Effect.succeed({
              dispatch: { sequence: 1, storedEvents: [] },
              projection: phaseProjection,
              message: {
                id: input.messageId,
                threadId: phaseCoordinatorThreadId,
                runId: coordinatorRunId,
                nodeId: null,
                role: "user",
                text: input.text,
                attachments: [],
                streaming: false,
                createdBy: "system",
                creationSource: "server",
                createdAt: occurredAt,
                updatedAt: occurredAt,
              },
              run,
              turnItem: null,
              delivery: "started",
            });
          },
          waitForThread: () =>
            Effect.succeed({
              threadId: phaseCoordinatorThreadId,
              run: phaseProjection.runs[0]!,
              timedOut: false,
            }),
        } satisfies Pick<
          ThreadManagementServiceShape,
          "dispatch" | "getThreadProjection" | "sendToThread" | "waitForThread"
        >;
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
        sendToThread: () => Effect.die("must not send"),
        waitForThread: () => Effect.die("must not wait"),
      } satisfies Pick<
        ThreadManagementServiceShape,
        "dispatch" | "getThreadProjection" | "sendToThread" | "waitForThread"
      >;
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
      const adapter = makeT3ProgramEffectExecutor(unavailableThreads, noReceipts, mutable, {
        now: Effect.succeed("2026-08-22T12:00:00.000Z"),
      });
      const failure = yield* adapter.execute(expired, context).pipe(Effect.flip);
      expect(String(failure.cause)).toContain("lease expired");
      expect(verifyCount).toBe(0);
    }),
  );
});
