import { expect, it } from "@effect/vitest";
import {
  MessageId,
  OwnerResultId,
  PhaseCallbackAcknowledgement,
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
import * as Schema from "effect/Schema";

import type { CommandReceiptStoreV2Shape } from "../CommandReceiptStore.ts";
import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import { makeT3ProgramEffectExecutor } from "./T3ProgramEffectExecutor.ts";

const programId = ProgramId.make("program:t3-effect-callback");
const phaseId = ProgramPhaseId.make("phase:t3-effect-callback");
const phaseCoordinatorThreadId = ThreadId.make("thread:t3-effect-callback-coordinator");
const programCoordinatorThreadId = ThreadId.make("thread:t3-effect-program-coordinator");
const projectId = ProjectId.make("project:t3-effect-callback");
const providerInstanceId = ProviderInstanceId.make("codex");
const occurredAt = DateTime.makeUnsafe("2026-08-22T12:00:00.000Z");
const callbackRunId = RunId.make("run:phase-callback:1");
const callbackMessageId = MessageId.make("message:phase-callback:1");
const candidateCommit = "2".repeat(40);
const encodeAcknowledgement = Schema.encodeSync(
  Schema.fromJsonString(PhaseCallbackAcknowledgement),
);
const context: ProgramEffectExecutorContext = {
  programId,
  programRevision: 1,
  requestId: ProgramRequestId.make("request:t3-effect-callback"),
  receiptId: ProgramReceiptId.make("receipt:t3-effect-callback"),
  now: "2026-08-22T12:00:00.000Z",
};
const callbackEffect = {
  kind: "deliver_phase_callback",
  effectId: ProgramEffectId.make("effect:deliver-phase-callback"),
  identity: {
    programId,
    requestId: ProgramRequestId.make("request:deliver-phase-callback"),
    phaseCallbackId: PhaseCallbackId.make("phase-callback:adapter:1"),
    phaseId,
    phaseCoordinatorThreadId,
    programCoordinatorThreadId,
    sourceThreadId: phaseCoordinatorThreadId,
    nonce: `nonce:${"3".repeat(64)}`,
    ownerResultIds: [
      OwnerResultId.make("owner-result:implementation"),
      OwnerResultId.make("owner-result:review"),
    ],
    candidateCommit,
    disposition: "approved",
    evidence: [
      { kind: "commit", id: candidateCommit },
      { kind: "check", id: "ci:phase-callback" },
    ],
  },
} as const;

function callbackProjection(): OrchestrationV2ThreadProjection {
  const acknowledgementText = encodeAcknowledgement({
    kind: "phase_callback_acknowledgement",
    programId,
    phaseId,
    phaseCoordinatorThreadId,
    programCoordinatorThreadId,
    sourceThreadId: phaseCoordinatorThreadId,
    phaseCallbackId: callbackEffect.identity.phaseCallbackId,
    nonce: callbackEffect.identity.nonce,
    candidateCommit,
    disposition: "approved",
    accepted: true,
  });
  return {
    thread: {
      createdBy: "system",
      creationSource: "server",
      id: programCoordinatorThreadId,
      projectId,
      title: "Program coordinator",
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
        rootThreadId: programCoordinatorThreadId,
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
        id: callbackRunId,
        threadId: programCoordinatorThreadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
        providerThreadId: null,
        userMessageId: callbackMessageId,
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
        id: TurnItemId.make("turn-item:phase-callback:assistant"),
        threadId: programCoordinatorThreadId,
        runId: callbackRunId,
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
        messageId: MessageId.make("message:phase-callback:assistant"),
        text: acknowledgementText,
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

it.effect("delivers and recovers one exact nonce-bound Phase callback", () =>
  Effect.gen(function* () {
    let sendCount = 0;
    const threads = {
      dispatch: () => Effect.die("must not dispatch"),
      getThreadProjection: (threadId: ThreadId) =>
        threadId === programCoordinatorThreadId
          ? Effect.succeed(callbackProjection())
          : Effect.die("unexpected thread projection"),
      sendToThread: (input) => {
        sendCount += 1;
        expect(input.threadId).toBe(programCoordinatorThreadId);
        expect(JSON.parse(input.text)).toEqual({
          kind: "phase_callback",
          ...callbackEffect.identity,
        });
        const projection = callbackProjection();
        return Effect.succeed({
          dispatch: { sequence: 1, storedEvents: [] },
          projection,
          message: {
            id: input.messageId,
            threadId: programCoordinatorThreadId,
            runId: callbackRunId,
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
          threadId: programCoordinatorThreadId,
          run: callbackProjection().runs[0]!,
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
    const delivered = yield* first.execute(callbackEffect as unknown as ProgramEffect, context);
    expect(delivered.kind).toBe("deliver_phase_callback");

    const restarted = makeT3ProgramEffectExecutor(threads, noReceipts, mutable);
    const observed = yield* restarted.observe(callbackEffect as unknown as ProgramEffect, context);
    expect(Option.isSome(observed)).toBe(true);
    expect(sendCount).toBe(1);
  }),
);
