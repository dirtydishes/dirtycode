import {
  type GoalCapability,
  ProgramEventId,
  type ProgramEvent,
  type ProgramPhaseProjection,
  type ProgramProjection,
  type StartProgramInput,
} from "@t3tools/contracts";

import { applyProgramReceipt } from "./ProgramReceiptProjection.ts";
import {
  allowedProgramCommands,
  appendProgramActivity,
  isTerminalProgramState,
} from "./ProgramProjectionSupport.ts";

export {
  allowedProgramCommands,
  appendProgramActivity,
  applyProgramReceipt,
  isTerminalProgramState,
};

export function makeInitialProgramProjection(
  input: StartProgramInput,
  goalCapability: GoalCapability,
): ProgramProjection {
  return {
    programId: input.attachment.programId,
    revision: 0,
    title: input.title,
    outcome: input.outcome,
    state: "running",
    terminal: false,
    attentionReason: null,
    certificationFailures: [],
    allowedCommands: allowedProgramCommands("running"),
    sourceIdentity: null,
    repositorySnapshot: null,
    beadsRevision: null,
    graphDigest: null,
    phases: input.phases.map(
      (phase): ProgramPhaseProjection => ({
        phaseId: phase.phaseId,
        title: phase.title,
        dependencyIds: phase.dependencyIds,
        state: "ready",
        beadsStatus: null,
        blockedBy: [],
        blockerPath: [],
        budgets: null,
        policy: null,
        activeAttemptId:
          input.attempts.find((attempt) => attempt.phaseId === phase.phaseId)?.attemptId ?? null,
        phaseCoordinatorTargetThreadId: phase.phaseCoordinatorThreadId,
        projectId: phase.projectId,
        threadTitle: phase.threadTitle,
        modelSelection: phase.modelSelection,
        runtimeMode: phase.runtimeMode,
        interactionMode: phase.interactionMode,
        branch: phase.branch,
        worktreePath: phase.worktreePath,
        phaseCoordinatorThreadId: null,
        ownerThreadId:
          input.attempts.find((attempt) => attempt.phaseId === phase.phaseId)?.threadId ?? null,
        preparedWorktree: null,
        lastLeaseEpoch: 0,
        leaseHeartbeatAt: null,
        receiptIds: [],
      }),
    ),
    attempts: [...input.attempts],
    receipts: [],
    threadBindings: [
      {
        threadId: input.attachment.programCoordinatorThreadId,
        role: "program_coordinator",
        phaseId: null,
        attemptId: null,
      },
      {
        threadId: input.attachment.integrationCoordinatorThreadId,
        role: "integration_coordinator",
        phaseId: null,
        attemptId: null,
      },
    ],
    statusRail: [
      { stage: "plan", state: "settled", receiptId: null },
      { stage: "ready", state: "settled", receiptId: null },
      { stage: "execute", state: "active", receiptId: null },
      { stage: "review", state: "pending", receiptId: null },
      { stage: "ci", state: "pending", receiptId: null },
      { stage: "admit", state: "pending", receiptId: null },
      { stage: "advance", state: "pending", receiptId: null },
    ],
    activity: [
      {
        eventId: ProgramEventId.make(`program-event:${input.attachment.programId}:started`),
        kind: "program_started",
        message: "Program started with the deterministic Slice 1 driver.",
        receiptId: null,
        occurredAt: input.attachment.createdAt,
      },
    ],
    activeAgentCount: input.attempts.filter((attempt) => attempt.threadId !== null).length,
    goalCapability,
    lastEventAt: input.attachment.createdAt,
  };
}

export function acknowledgeProgramReceipts(
  projection: ProgramProjection,
  receiptIds: ReadonlyArray<string>,
  now: string,
): ProgramProjection {
  const ids = new Set(receiptIds);
  return {
    ...projection,
    receipts: projection.receipts.map((receipt) =>
      ids.has(receipt.receiptId) ? { ...receipt, acknowledged: true } : receipt,
    ) as ProgramProjection["receipts"],
    activity: appendProgramActivity(
      projection.activity,
      projection.receipts
        .filter((receipt) => ids.has(receipt.receiptId) && !receipt.acknowledged)
        .map((receipt) => ({
          eventId: ProgramEventId.make(`program-event:${receipt.receiptId}:acknowledged`),
          kind: "receipt_acknowledged" as const,
          message: `Receipt ${receipt.receiptId} was acknowledged by dirtyloops.`,
          receiptId: receipt.receiptId,
          occurredAt: now,
        })),
    ),
    lastEventAt: now,
  };
}

export function replayProgramProjection(events: ReadonlyArray<ProgramEvent>): ProgramProjection {
  const started = events.find((event) => event.type === "program.started");
  if (started === undefined || started.type !== "program.started") {
    throw new Error("A Program event stream must begin with program.started.");
  }
  let projection = started.payload.projection;
  for (const event of events) {
    switch (event.type) {
      case "program.started":
      case "program.decision-recorded":
        projection = event.payload.projection;
        break;
      case "program.receipt-recorded":
        projection = applyProgramReceipt(projection, event.payload, event.occurredAt);
        break;
      case "program.receipts-acknowledged":
        projection = acknowledgeProgramReceipts(
          projection,
          event.payload.receiptIds,
          event.occurredAt,
        );
        break;
      case "program.projection-saved":
        projection = event.payload;
        break;
      case "program.state-changed":
        projection = {
          ...projection,
          state: event.payload.to,
          terminal: isTerminalProgramState(event.payload.to),
          allowedCommands: allowedProgramCommands(event.payload.to),
          lastEventAt: event.occurredAt,
        };
        break;
      case "program.thread-bound":
        if (
          !projection.threadBindings.some(
            (binding) =>
              binding.threadId === event.payload.threadId && binding.role === event.payload.role,
          )
        ) {
          projection = {
            ...projection,
            threadBindings: [...projection.threadBindings, event.payload],
            lastEventAt: event.occurredAt,
          };
        }
        break;
      default:
        break;
    }
  }
  return projection;
}
