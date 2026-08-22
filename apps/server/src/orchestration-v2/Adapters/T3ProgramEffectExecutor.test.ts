import { assert, describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ProgramEffectId,
  ProgramId,
  ProgramPhaseId,
  ProgramReceiptId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type ProgramEffect,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { OrchestratorProjectionError } from "../Orchestrator.ts";
import type { CommandReceiptStoreV2Shape, CommandReceiptV2 } from "../CommandReceiptStore.ts";
import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
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
});
