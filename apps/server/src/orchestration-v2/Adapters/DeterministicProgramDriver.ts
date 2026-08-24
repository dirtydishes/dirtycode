import {
  type ProgramCommandDecision,
  type ProgramDriverDecision,
  ProgramEffectId,
  type ProgramProjection,
  type ProgramState,
  type ReconcileProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { DirtyloopsProgramDriver } from "../ProgramDriver.ts";
import { allowedProgramCommands, isTerminalProgramState } from "../ProgramProjection.ts";

const accepted = (message: string): ProgramCommandDecision => ({
  status: "accepted",
  code: "accepted",
  message,
});

const rejected = (message: string): ProgramCommandDecision => ({
  status: "rejected",
  code: "invalid_state",
  message,
});

function withState(
  projection: ProgramProjection,
  state: ProgramState,
  occurredAt: string,
): ProgramProjection {
  return {
    ...projection,
    state,
    terminal: isTerminalProgramState(state),
    attentionReason: state === "attention_required" ? projection.attentionReason : null,
    allowedCommands: allowedProgramCommands(state),
    lastEventAt: occurredAt,
  };
}

function operatorDecision(input: ReconcileProgramInput): ProgramDriverDecision | null {
  const intent = input.operatorIntent;
  if (intent === null) return null;
  const current = input.observedProjection;
  const revision = input.observedProgramRevision + 1;
  const base = { ...current, revision, lastEventAt: input.occurredAt };
  const invalid = (message: string): ProgramDriverDecision => ({
    kind: "wait",
    programRevision: revision,
    projection: base,
    operatorDecision: rejected(message),
    reason: message,
    wakeConditions: ["operator_intent"],
  });

  switch (intent.kind) {
    case "pause":
      return current.state === "running"
        ? {
            kind: "wait",
            programRevision: revision,
            projection: withState(base, "paused", input.occurredAt),
            operatorDecision: accepted("Program paused at a safe boundary."),
            reason: "The Program is paused.",
            wakeConditions: ["operator_intent"],
          }
        : invalid(`pause is not allowed while the Program is ${current.state}.`);
    case "resume":
      return current.state === "paused" || current.state === "attention_required"
        ? {
            kind: "wait",
            programRevision: revision,
            projection: withState(base, "running", input.occurredAt),
            operatorDecision: accepted("Program resumed."),
            reason: "The Program is ready for its next wake.",
            wakeConditions: ["effect_receipt", "operator_intent"],
          }
        : invalid(`resume is not allowed while the Program is ${current.state}.`);
    case "request_replan":
      return current.state === "attention_required"
        ? {
            kind: "wait",
            programRevision: revision,
            projection: withState(base, "attention_required", input.occurredAt),
            operatorDecision: accepted("Program replan requested."),
            reason: "The Program remains stopped for replanning.",
            wakeConditions: ["operator_intent"],
          }
        : invalid(`request_replan is not allowed while the Program is ${current.state}.`);
    case "stop":
      return current.state === "running" ||
        current.state === "paused" ||
        current.state === "attention_required"
        ? {
            kind: "wait",
            programRevision: revision,
            projection: withState(base, "stopped", input.occurredAt),
            operatorDecision: accepted("Program stopped."),
            reason: intent.reason ?? "The operator stopped the Program.",
            wakeConditions: [],
          }
        : invalid(`stop is not allowed while the Program is ${current.state}.`);
  }
}

export function makeDeterministicProgramDriver(): DirtyloopsProgramDriver {
  return {
    reconcile: (input) =>
      Effect.sync(() => {
        const command = operatorDecision(input);
        if (command !== null) return command;

        const revision = input.observedProgramRevision + 1;
        const projection = {
          ...input.observedProjection,
          revision,
          lastEventAt: input.occurredAt,
        };
        const acceptedWake = accepted("Program wake completed.");
        if (projection.state === "paused") {
          return {
            kind: "wait",
            programRevision: revision,
            projection,
            operatorDecision: acceptedWake,
            reason: "The Program remains paused across recovery.",
            wakeConditions: ["operator_intent"],
          } satisfies ProgramDriverDecision;
        }
        if (projection.state === "attention_required") {
          return {
            kind: "attention_required",
            programRevision: revision,
            projection,
            operatorDecision: acceptedWake,
            reasonCode: "attention_retained",
            evidence: [],
          } satisfies ProgramDriverDecision;
        }
        if (projection.terminal) {
          return {
            kind: "wait",
            programRevision: revision,
            projection,
            operatorDecision: acceptedWake,
            reason: "The Program is terminal.",
            wakeConditions: [],
          } satisfies ProgramDriverDecision;
        }

        const phase = projection.phases.find(
          (candidate) => candidate.phaseCoordinatorThreadId === null,
        );
        const retained =
          phase === undefined
            ? undefined
            : input.receipts.find(
                (receipt) =>
                  receipt.kind === "launch_phase_coordinator" &&
                  receipt.identity.phaseId === phase.phaseId,
              );
        if (retained !== undefined && retained.status !== "succeeded") {
          return {
            kind: "attention_required",
            programRevision: revision,
            projection: {
              ...projection,
              state: "attention_required",
              attentionReason: `Effect ${retained.effectId} returned ${retained.status}.`,
              allowedCommands: allowedProgramCommands("attention_required"),
            },
            operatorDecision: acceptedWake,
            reasonCode: `effect_${retained.status}`,
            evidence: retained.evidence,
          } satisfies ProgramDriverDecision;
        }
        if (phase === undefined || retained !== undefined) {
          return {
            kind: "wait",
            programRevision: revision,
            projection,
            operatorDecision: acceptedWake,
            reason: "The deterministic fake effect is retained.",
            wakeConditions: ["operator_intent"],
          } satisfies ProgramDriverDecision;
        }

        return {
          kind: "effects",
          programRevision: revision,
          projection,
          operatorDecision: acceptedWake,
          proposalId: `proposal:${input.attachment.programId}:${revision}`,
          effects: [
            {
              kind: "launch_phase_coordinator",
              effectId: ProgramEffectId.make(
                `effect:${input.attachment.programId}:${phase.phaseId}:${revision}:launch_phase_coordinator`,
              ),
              identity: {
                programId: input.attachment.programId,
                phaseId: phase.phaseId,
                programCoordinatorThreadId: input.attachment.programCoordinatorThreadId,
                phaseCoordinatorThreadId: phase.phaseCoordinatorTargetThreadId,
                projectId: phase.projectId,
                threadTitle: phase.threadTitle,
                modelSelection: phase.modelSelection,
                runtimeMode: phase.runtimeMode,
                interactionMode: phase.interactionMode,
                branch: phase.branch,
                worktreePath: phase.worktreePath,
                requestId: input.requestId,
              },
            },
          ],
        } satisfies ProgramDriverDecision;
      }),
  };
}
