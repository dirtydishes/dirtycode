import {
  OwnerResultId,
  type OwnerResult,
  type ProgramAttemptSnapshot,
  type ProgramId,
  type ProgramPhaseId,
  type ThreadId,
} from "@t3tools/contracts";

import { sha256Digest } from "./ProgramIdentity.ts";

export function digestProgramAttemptResult(
  result: NonNullable<ProgramAttemptSnapshot["terminalResult"]>,
) {
  return sha256Digest(result);
}

function terminalKind(
  result: NonNullable<ProgramAttemptSnapshot["terminalResult"]>,
): OwnerResult["terminalKind"] {
  if (result.status === "completed") return "succeeded";
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "interrupted" && result.failure?.code === "t3_restart_interrupted") {
    return "t3_restart_interrupted";
  }
  return "failed";
}

export function makeProgramOwnerResult(input: {
  readonly programId: ProgramId;
  readonly phaseId: ProgramPhaseId;
  readonly phaseCoordinatorThreadId: ThreadId;
  readonly ownerKind: OwnerResult["ownerKind"];
  readonly snapshot: ProgramAttemptSnapshot;
}): OwnerResult | null {
  const result = input.snapshot.terminalResult;
  if (result === null) return null;
  return {
    ownerResultId: OwnerResultId.make(`owner-result:${input.snapshot.attemptId}`),
    programId: input.programId,
    phaseId: input.phaseId,
    phaseCoordinatorThreadId: input.phaseCoordinatorThreadId,
    ownerThreadId: input.snapshot.threadId,
    attemptId: input.snapshot.attemptId,
    ownerKind: input.ownerKind,
    terminalKind: terminalKind(result),
    resultDigest: digestProgramAttemptResult(result),
    evidence: [
      { kind: "thread", id: input.snapshot.threadId },
      { kind: "log", id: input.snapshot.runId, label: "Retained ProgramAttempt result" },
    ],
  };
}
