import { expect, it } from "@effect/vitest";
import {
  MessageId,
  PhaseCallbackId,
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
  type ProgramEffect,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { CommandReceiptStoreV2Shape } from "../CommandReceiptStore.ts";
import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import { makeT3ProgramEffectExecutor } from "./T3ProgramEffectExecutor.ts";

const programId = ProgramId.make("program:integration-admission");
const phaseId = ProgramPhaseId.make("phase:integration-admission");
const programCoordinatorThreadId = ThreadId.make("thread:program-coordinator");
const integrationCoordinatorThreadId = ThreadId.make("thread:integration-coordinator");
const projectId = ProjectId.make("project:integration-admission");
const providerInstanceId = ProviderInstanceId.make("codex");
const occurredAt = DateTime.makeUnsafe("2026-08-22T12:00:00.000Z");
const runId = RunId.make("run:integration-admission:1");
const messageId = MessageId.make("message:integration-admission:1");
const candidateCommit = "2".repeat(40);
const expectedParent = "1".repeat(40);

const integrationEffect = {
  kind: "deliver_integration_admission_request",
  effectId: ProgramEffectId.make("effect:deliver-integration-admission-request"),
  identity: {
    programId,
    requestId: ProgramRequestId.make("request:deliver-integration-admission"),
    integrationAdmissionRequestId:
      "integration-admission-request:program:integration-admission:phase:integration-admission:2222222222222222222222222222222222222222",
    phaseId,
    programCoordinatorThreadId,
    integrationCoordinatorThreadId,
    sourceThreadId: programCoordinatorThreadId,
    phaseCallbackId: PhaseCallbackId.make("phase-callback:integration-admission"),
    phaseCallbackNonce: `nonce:${"3".repeat(64)}`,
    candidateCommit,
    expectedParent,
    integrationRef: "refs/heads/main",
    leaseId: "lease:integration-admission:1",
    leaseEpoch: 1,
    expiresAt: "2026-08-22T13:00:00.000Z",
    integrationAdmissionNonce: `nonce:${"4".repeat(64)}`,
  },
} as const;

const context: ProgramEffectExecutorContext = {
  programId,
  programRevision: 14,
  requestId: integrationEffect.identity.requestId,
  receiptId: ProgramReceiptId.make(`receipt:${integrationEffect.effectId}`),
  now: "2026-08-22T12:00:00.000Z",
};

function projectionWithAcknowledgement(): OrchestrationV2ThreadProjection {
  const acknowledgement = JSON.stringify({
    kind: "integration_admission_acknowledgement",
    ...integrationEffect.identity,
    accepted: true,
  });
  return {
    thread: {
      createdBy: "system",
      creationSource: "server",
      id: integrationCoordinatorThreadId,
      projectId,
      title: "Integration coordinator",
      providerInstanceId,
      modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "feat/program-runtime-shell",
      worktreePath: "/home/delta/dev/dirtycode",
      activeProviderThreadId: null,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: integrationCoordinatorThreadId,
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
    runs: [
      {
        id: runId,
        threadId: integrationCoordinatorThreadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
        providerThreadId: null,
        userMessageId: messageId,
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
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [
      {
        id: TurnItemId.make("turn-item:integration-admission:assistant"),
        threadId: integrationCoordinatorThreadId,
        runId,
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
        messageId: MessageId.make("message:integration-admission:assistant"),
        text: acknowledgement,
        streaming: false,
      },
    ],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: occurredAt,
  };
}

it.effect("delivers and recovers one exact integration Admission acknowledgement", () =>
  Effect.gen(function* () {
    let sendCount = 0;
    const threads = {
      dispatch: () => Effect.die("must not dispatch"),
      getThreadProjection: (threadId: ThreadId) =>
        threadId === integrationCoordinatorThreadId
          ? Effect.succeed(projectionWithAcknowledgement())
          : Effect.die("unexpected thread projection"),
      sendToThread: (input) => {
        sendCount += 1;
        expect(input.threadId).toBe(integrationCoordinatorThreadId);
        expect(JSON.parse(input.text)).toEqual({
          kind: "integration_admission_request",
          ...integrationEffect.identity,
        });
        const projection = projectionWithAcknowledgement();
        return Effect.succeed({
          dispatch: { sequence: 1, storedEvents: [] },
          projection,
          message: {
            id: input.messageId,
            threadId: integrationCoordinatorThreadId,
            runId,
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
          threadId: integrationCoordinatorThreadId,
          run: projectionWithAcknowledgement().runs[0]!,
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
        observe: () => Effect.die("must not observe"),
        cancel: () => Effect.die("must not cancel"),
        acknowledge: () => Effect.die("must not acknowledge"),
      },
    };

    const first = makeT3ProgramEffectExecutor(threads, noReceipts, mutable);
    const delivered = yield* first.execute(integrationEffect as unknown as ProgramEffect, context);
    expect(delivered.kind).toBe("deliver_integration_admission_request");
    expect(delivered.result).toEqual({
      integrationAdmissionRequestId: integrationEffect.identity.integrationAdmissionRequestId,
      nonce: integrationEffect.identity.integrationAdmissionNonce,
    });

    const restarted = makeT3ProgramEffectExecutor(threads, noReceipts, mutable);
    const observed = yield* restarted.observe(
      integrationEffect as unknown as ProgramEffect,
      context,
    );
    expect(Option.isSome(observed)).toBe(true);
    expect(sendCount).toBe(1);
  }),
);
