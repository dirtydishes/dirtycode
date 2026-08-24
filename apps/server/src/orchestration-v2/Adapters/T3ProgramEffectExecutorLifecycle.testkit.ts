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
import * as Schema from "effect/Schema";

import type { CommandReceiptStoreV2Shape, CommandReceiptV2 } from "../CommandReceiptStore.ts";
import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import * as ProgramAttemptService from "../ProgramAttemptService.ts";
import { makeProgramOwnerResult } from "../ProgramOwnerResult.ts";
import type { ThreadLaunchInput } from "../ThreadLaunchService.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import { makeT3ProgramEffectExecutor } from "./T3ProgramEffectExecutor.ts";

const programId = ProgramId.make("program:t3-effect-lifecycle");
const phaseId = ProgramPhaseId.make("phase:lifecycle");
const phaseCoordinatorThreadId = ThreadId.make("thread:t3-effect-lifecycle:phase");
const ownerThreadId = ThreadId.make("thread:t3-effect-lifecycle:owner");
const projectId = ProjectId.make("project:t3-effect-lifecycle");
const providerInstanceId = ProviderInstanceId.make("codex");
const attemptId = ProgramAttemptId.make("attempt:t3-effect-lifecycle:1");
const runId = RunId.make("run:t3-effect-lifecycle:1");
const occurredAt = DateTime.makeUnsafe("2026-08-22T12:00:00.000Z");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.6-sol" } as const;
const decodeOwnerResult = Schema.decodeUnknownSync(Schema.fromJsonString(OwnerResultSchema));
const encodeOwnerResultAcknowledgement = Schema.encodeSync(
  Schema.fromJsonString(OwnerResultAcknowledgement),
);

const context: ProgramEffectExecutorContext = {
  programId,
  programRevision: 1,
  requestId: ProgramRequestId.make("request:t3-effect-lifecycle"),
  receiptId: ProgramReceiptId.make("receipt:t3-effect-lifecycle"),
  now: "2026-08-22T12:00:00.000Z",
};

const preparedWorktree = {
  programId,
  requestId: ProgramRequestId.make("request:t3-effect-lifecycle:bind"),
  phaseId,
  phaseCoordinatorThreadId,
  ownerThreadId,
  projectId,
  ownerThreadTitle: "Lifecycle implementation owner",
  modelSelection,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  leaseId: "lease:t3-effect-lifecycle:1",
  leaseEpoch: 1,
  repositoryIdentity: "dirtydishes/dirtycode",
  repositoryRoot: "/repo",
  gitCommonDir: "/repo/.git",
  realPath: "/repo-worktrees/program-lifecycle",
  expectedIntegrationHead: "1".repeat(40),
  integrationRef: "refs/heads/main",
  budgetIdentity: "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
  symbolicBranch: "dirtyloops/program/lifecycle",
  startingCommit: "1".repeat(40),
  clean: true as const,
  declaredPaths: ["apps/server"],
  expiresAt: "2099-08-22T12:30:00.000Z",
};

export const bindEffect = {
  kind: "bind_prepared_worktree",
  effectId: ProgramEffectId.make("effect:t3-effect-lifecycle:bind"),
  identity: preparedWorktree,
} satisfies ProgramEffect;

export const launchEffect = {
  kind: "launch_owner_attempt",
  effectId: ProgramEffectId.make("effect:t3-effect-lifecycle:launch"),
  identity: {
    programId,
    requestId: ProgramRequestId.make("request:t3-effect-lifecycle:launch"),
    phaseId,
    phaseCoordinatorThreadId,
    attemptId,
    ownerThreadId,
    preparedWorktree,
    prompt: "Implement only the declared lifecycle paths.",
    providerPolicy: { modelSelection, runtimeMode: "full-access", interactionMode: "default" },
    teamPolicy: { mode: "solo" },
  },
} satisfies ProgramEffect;

export const cancelEffect = {
  ...launchEffect,
  kind: "cancel_owner_attempt",
  effectId: ProgramEffectId.make("effect:t3-effect-lifecycle:cancel"),
} satisfies ProgramEffect;

function emptyProjection(threadId = phaseCoordinatorThreadId): OrchestrationV2ThreadProjection {
  return {
    thread: {
      createdBy: "system",
      creationSource: "server",
      id: threadId,
      projectId,
      title: threadId === ownerThreadId ? preparedWorktree.ownerThreadTitle : "Phase coordinator",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: preparedWorktree.symbolicBranch,
      worktreePath: preparedWorktree.realPath,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
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

export function makeOwnerLifecycleHarness() {
  const commandReceiptsById = new Map<CommandId, CommandReceiptV2>();
  const projections = new Map<ThreadId, OrchestrationV2ThreadProjection>();
  const counts = { verify: 0, bind: 0, launch: 0, cancel: 0, acknowledge: 0 };
  let launched = false;
  let terminal = false;
  let acknowledged = false;
  const coordinatorRunId = RunId.make("run:t3-effect-lifecycle:coordinator-ack");
  let phaseProjection = emptyProjection();

  const snapshot = (): ProgramAttemptSnapshot => ({
    attemptId,
    programId,
    taskId: phaseId,
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
        modelSelection,
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
            id: TurnItemId.make("turn-item:t3-effect-lifecycle:coordinator-ack"),
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
            messageId: MessageId.make("message:t3-effect-lifecycle:coordinator-ack"),
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
          role: "user" as const,
          text: input.text,
          attachments: [],
          streaming: false,
          createdBy: "system" as const,
          creationSource: "server" as const,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        run,
        turnItem: null,
        delivery: "started" as const,
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
        counts.verify += 1;
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
        counts.bind += 1;
        const ownerProjection = emptyProjection(ownerThreadId);
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
        counts.launch += 1;
        launched = true;
        return Effect.succeed(snapshot());
      },
      observe: () =>
        launched
          ? Effect.succeed(snapshot())
          : Effect.fail(new ProgramAttemptService.ProgramAttemptNotFoundError({ attemptId })),
      cancel: () => {
        counts.cancel += 1;
        terminal = true;
        return Effect.succeed(snapshot());
      },
      acknowledge: () => {
        counts.acknowledge += 1;
        acknowledged = true;
        return Effect.succeed(snapshot());
      },
    },
  };
  const adapter = makeT3ProgramEffectExecutor(threads, commandReceipts, mutable);

  const acknowledgeEffect = () => {
    const ownerResult = makeProgramOwnerResult({
      programId,
      phaseId,
      phaseCoordinatorThreadId,
      ownerKind: "implementation",
      snapshot: snapshot(),
    });
    if (ownerResult === null) throw new Error("terminal owner result missing");
    return {
      kind: "acknowledge_owner_result",
      effectId: ProgramEffectId.make("effect:t3-effect-lifecycle:acknowledge"),
      identity: {
        requestId: ProgramRequestId.make("request:t3-effect-lifecycle:acknowledge"),
        ...ownerResult,
        leaseId: preparedWorktree.leaseId,
        leaseEpoch: preparedWorktree.leaseEpoch,
        expiresAt: preparedWorktree.expiresAt,
      },
    } satisfies ProgramEffect;
  };

  return {
    adapter,
    restarted: () => makeT3ProgramEffectExecutor(threads, commandReceipts, mutable),
    context,
    counts,
    acknowledgeEffect,
    foreignAcknowledgement: (acknowledgement: ReturnType<typeof acknowledgeEffect>) =>
      ({
        ...acknowledgement,
        effectId: ProgramEffectId.make("effect:t3-effect-lifecycle:foreign-phase"),
        identity: { ...acknowledgement.identity, phaseId: ProgramPhaseId.make("phase:foreign") },
      }) satisfies ProgramEffect,
  };
}
