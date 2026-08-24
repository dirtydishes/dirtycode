import {
  OwnerResultId,
  ProgramReviewDecision,
  type OwnerResult,
  type ProgramAttemptSnapshot,
  type ProgramId,
  type ProgramPhaseId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { sha256Digest } from "./ProgramIdentity.ts";

const REVIEW_RESULT_PREFIX = "DIRTYLOOPS_PROGRAM_REVIEW_RESULT ";
const decodeReviewDecision = Schema.decodeUnknownSync(ProgramReviewDecision);

function retainedReviewDecision(
  snapshot: ProgramAttemptSnapshot,
  ownerKind: OwnerResult["ownerKind"],
) {
  if (
    ownerKind !== "review" ||
    snapshot.attemptKind !== "review" ||
    snapshot.reviewId === null ||
    snapshot.reviewKind === null ||
    snapshot.candidateId === null
  ) {
    return undefined;
  }
  const marker = snapshot.terminalResult?.output
    ?.split("\n")
    .toReversed()
    .find((line) => line.startsWith(REVIEW_RESULT_PREFIX));
  if (marker === undefined) return undefined;
  try {
    const decision = decodeReviewDecision(JSON.parse(marker.slice(REVIEW_RESULT_PREFIX.length)));
    return decision.candidateCommit === snapshot.candidateId &&
      decision.reviewId === snapshot.reviewId &&
      decision.reviewKind === snapshot.reviewKind
      ? decision
      : undefined;
  } catch {
    return undefined;
  }
}

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
  const reviewDecision = retainedReviewDecision(input.snapshot, input.ownerKind);
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
    ...(reviewDecision === undefined ? {} : { reviewDecision }),
  };
}
