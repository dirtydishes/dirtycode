import { describe, expect, it } from "@effect/vitest";
import {
  ProgramAttemptId,
  ProgramId,
  ProgramPhaseId,
  ProjectId,
  RunId,
  ThreadId,
  type ProgramAttemptSnapshot,
} from "@t3tools/contracts";

import { makeProgramOwnerResult } from "./ProgramOwnerResult.ts";

describe("ProgramOwnerResult", () => {
  it("retains a candidate-bound review verdict and terminal CI state", () => {
    const candidateCommit = "2".repeat(40);
    const reviewId = `review:phase:review:${candidateCommit}:broad`;
    const snapshot = {
      attemptId: ProgramAttemptId.make("attempt:review-owner-result"),
      programId: "program:review-owner-result",
      taskId: "phase:review-owner-result",
      attemptKind: "review",
      candidateId: candidateCommit,
      reviewId,
      reviewKind: "broad",
      title: "Immutable candidate review",
      checkout: {
        repositoryRoot: "/repo",
        gitCommonDir: "/repo/.git",
        worktreePath: "/repo-worktrees/review",
        branch: "dirtyloops/review",
        startingCommit: "1".repeat(40),
      },
      projectId: ProjectId.make("project:review-owner-result"),
      threadId: ThreadId.make("thread:review-owner-result"),
      runId: RunId.make("run:review-owner-result"),
      state: "terminal",
      runStatus: "completed",
      terminalResult: {
        status: "completed",
        output: [
          "Review complete.",
          `DIRTYLOOPS_PROGRAM_REVIEW_RESULT ${JSON.stringify({
            candidateCommit,
            reviewId,
            reviewKind: "broad",
            verdict: "approved",
            findings: [],
            ciState: "ci-green",
            evidence: [
              { kind: "commit", id: candidateCommit },
              { kind: "check", id: "ci:review-owner-result" },
            ],
          })}`,
        ].join("\n"),
        failure: null,
        completedAt: "2026-08-22T18:30:00.000Z",
      },
      terminalAcknowledged: false,
    } satisfies ProgramAttemptSnapshot;

    const result = makeProgramOwnerResult({
      programId: ProgramId.make("program:review-owner-result"),
      phaseId: ProgramPhaseId.make("phase:review-owner-result"),
      phaseCoordinatorThreadId: ThreadId.make("thread:review-phase-coordinator"),
      ownerKind: "review",
      snapshot,
    });

    expect(result?.reviewDecision).toEqual({
      candidateCommit,
      reviewId,
      reviewKind: "broad",
      verdict: "approved",
      findings: [],
      ciState: "ci-green",
      evidence: [
        { kind: "commit", id: candidateCommit },
        { kind: "check", id: "ci:review-owner-result" },
      ],
    });
  });
});
