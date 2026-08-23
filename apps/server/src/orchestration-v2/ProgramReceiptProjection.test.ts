import { describe, expect, it } from "@effect/vitest";
import {
  OwnerResultId,
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
  type RuntimeReceipt,
  type StartProgramInput,
} from "@t3tools/contracts";

import { applyProgramReceipt, makeInitialProgramProjection } from "./ProgramProjection.ts";

const programId = ProgramId.make("program:review-projection");
const phaseId = ProgramPhaseId.make("phase:review-projection");
const phaseCoordinatorThreadId = ThreadId.make("thread:review-phase-coordinator");
const implementationOwnerThreadId = ThreadId.make("thread:review-implementation-owner");
const reviewOwnerThreadId = ThreadId.make("thread:review-owner");
const attemptId = ProgramAttemptId.make("attempt:review-owner");
const projectId = ProjectId.make("project:review-projection");
const requestId = ProgramRequestId.make("request:review-projection");
const now = "2026-08-22T18:20:00.000Z";
const baseCommit = "1".repeat(40);
const candidateCommit = "2".repeat(40);
const providerPolicy = {
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-sol",
  },
  runtimeMode: "read-only" as const,
  interactionMode: "default" as const,
};
const startInput = {
  requestId,
  attachment: {
    programId,
    repositoryId: "dirtydishes/dirtycode",
    integrationRef: "refs/heads/main",
    programCoordinatorThreadId: ThreadId.make("thread:review-program-coordinator"),
    integrationCoordinatorThreadId: ThreadId.make("thread:review-integration-coordinator"),
    dirtyloopsGenerationId: `dirtyloops:${"3".repeat(64)}`,
    dirtyloopsAdapterDigest: `sha256:${"4".repeat(64)}`,
    t3EnvironmentId: "environment:review-projection",
    createdAt: now,
  },
  title: "Review projection",
  outcome: "Keep review separate from admission.",
  phases: [
    {
      phaseId,
      title: "Reviewed Phase",
      dependencyIds: [],
      phaseCoordinatorThreadId,
      projectId,
      threadTitle: "Review Phase coordinator",
      modelSelection: providerPolicy.modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "feat/program-runtime-shell",
      worktreePath: "/repo",
    },
  ],
  attempts: [],
  driverKind: "dirtyloops",
} satisfies StartProgramInput;
const preparedWorktree = {
  programId,
  requestId,
  phaseId,
  phaseCoordinatorThreadId,
  ownerThreadId: implementationOwnerThreadId,
  projectId,
  ownerThreadTitle: "Implementation owner",
  modelSelection: providerPolicy.modelSelection,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  leaseId: "lease:review-projection:1",
  leaseEpoch: 1,
  repositoryIdentity: "dirtydishes/dirtycode",
  repositoryRoot: "/repo",
  gitCommonDir: "/repo/.git",
  realPath: "/repo-worktrees/review",
  expectedIntegrationHead: baseCommit,
  integrationRef: "refs/heads/main",
  budgetIdentity: `sha256:${"5".repeat(64)}`,
  symbolicBranch: "dirtyloops/review-projection",
  startingCommit: baseCommit,
  clean: true as const,
  declaredPaths: ["apps/server"],
  expiresAt: "2099-08-22T18:20:00.000Z",
};

describe("ProgramReceiptProjection", () => {
  it("projects an immutable review Attempt without marking the candidate admitted", () => {
    const initial = makeInitialProgramProjection(startInput, {
      available: false,
      adapter: "unsupported",
      reason: "not under test",
    });
    const candidate = {
      ...initial,
      phases: initial.phases.map((phase) => ({
        ...phase,
        state: "candidate" as const,
        phaseCoordinatorThreadId,
        ownerThreadId: implementationOwnerThreadId,
        preparedWorktree,
      })),
    };
    const receipt = {
      receiptId: ProgramReceiptId.make("receipt:review-owner-launch"),
      programId,
      programRevision: 8,
      effectId: ProgramEffectId.make("effect:review-owner-launch"),
      requestId,
      kind: "launch_review_owner",
      status: "succeeded",
      resultDigest: `sha256:${"6".repeat(64)}`,
      evidence: [
        { kind: "thread", id: reviewOwnerThreadId },
        { kind: "commit", id: candidateCommit },
      ],
      createdAt: now,
      acknowledged: false,
      identity: {
        programId,
        requestId,
        phaseId,
        phaseCoordinatorThreadId,
        attemptId,
        reviewOwnerThreadId,
        candidateId: "candidate:review-projection",
        reviewId: "review:review-projection:broad",
        candidateCommit,
        reviewKind: "broad",
        preparedWorktree,
        projectId,
        title: "Immutable candidate review",
        prompt: "Review without editing.",
        providerPolicy,
      },
      result: {
        reviewOwnerThreadId,
        providerRunId: RunId.make("run:review-projection"),
      },
    } satisfies RuntimeReceipt;

    const projected = applyProgramReceipt(candidate, receipt, now);
    expect(projected.phases[0]?.state).toBe("reviewing");
    expect(projected.phases[0]?.activeAttemptId).toBe(attemptId);
    expect(projected.phases[0]?.ownerThreadId).toBe(reviewOwnerThreadId);
    expect(projected.attempts).toContainEqual({
      attemptId,
      phaseId,
      ownerKind: "review",
      state: "running",
      threadId: reviewOwnerThreadId,
      terminalKind: null,
      ownerResultId: null,
      resultDigest: null,
    });
    expect(projected.threadBindings).toContainEqual({
      threadId: reviewOwnerThreadId,
      role: "review_owner",
      phaseId,
      attemptId,
    });
    expect(projected.statusRail.find((item) => item.stage === "review")?.state).toBe("active");
    expect(projected.statusRail.find((item) => item.stage === "ci")?.state).toBe("pending");
    expect(projected.statusRail.find((item) => item.stage === "admit")?.state).toBe("pending");
    expect(projected.statusRail.find((item) => item.stage === "advance")?.state).toBe("pending");
  });

  it("settles review and CI without claiming Admission", () => {
    const initial = makeInitialProgramProjection(startInput, {
      available: false,
      adapter: "unsupported",
      reason: "not under test",
    });
    const reviewing = {
      ...initial,
      phases: initial.phases.map((phase) => ({
        ...phase,
        state: "reviewing" as const,
        phaseCoordinatorThreadId,
        ownerThreadId: reviewOwnerThreadId,
        activeAttemptId: attemptId,
        preparedWorktree,
      })),
      attempts: [
        {
          attemptId,
          phaseId,
          ownerKind: "review" as const,
          state: "terminal_retained" as const,
          threadId: reviewOwnerThreadId,
          terminalKind: "succeeded" as const,
          ownerResultId: null,
          resultDigest: null,
        },
      ],
      statusRail: initial.statusRail.map((item) =>
        item.stage === "review" ? { ...item, state: "active" as const } : item,
      ),
    };
    const ownerResultId = OwnerResultId.make(`owner-result:${attemptId}`);
    const resultDigest = `sha256:${"7".repeat(64)}`;
    const receipt = {
      receiptId: ProgramReceiptId.make("receipt:review-owner-acknowledgement"),
      programId,
      programRevision: 9,
      effectId: ProgramEffectId.make("effect:review-owner-acknowledgement"),
      requestId,
      kind: "acknowledge_owner_result",
      status: "succeeded",
      resultDigest: `sha256:${"8".repeat(64)}`,
      evidence: [
        { kind: "thread", id: reviewOwnerThreadId },
        { kind: "check", id: "ci:review-projection" },
      ],
      createdAt: now,
      acknowledged: false,
      identity: {
        requestId,
        ownerResultId,
        programId,
        phaseId,
        phaseCoordinatorThreadId,
        ownerThreadId: reviewOwnerThreadId,
        attemptId,
        ownerKind: "review",
        terminalKind: "succeeded",
        resultDigest,
        evidence: [
          { kind: "thread", id: reviewOwnerThreadId },
          { kind: "log", id: "run:review-projection" },
        ],
        reviewDecision: {
          candidateCommit,
          reviewId: "review:review-projection:broad",
          reviewKind: "broad",
          verdict: "approved",
          findings: [],
          ciState: "ci-green",
          evidence: [
            { kind: "commit", id: candidateCommit },
            { kind: "check", id: "ci:review-projection" },
          ],
        },
        leaseId: preparedWorktree.leaseId,
        leaseEpoch: preparedWorktree.leaseEpoch,
        expiresAt: preparedWorktree.expiresAt,
      },
      result: { ownerResultId },
    } satisfies RuntimeReceipt;

    const projected = applyProgramReceipt(reviewing, receipt, now);
    expect(projected.phases[0]?.state).toBe("approved");
    expect(projected.attempts[0]?.state).toBe("acknowledged");
    expect(projected.statusRail.find((item) => item.stage === "review")?.state).toBe("settled");
    expect(projected.statusRail.find((item) => item.stage === "ci")?.state).toBe("settled");
    expect(projected.statusRail.find((item) => item.stage === "admit")?.state).toBe("pending");
    expect(projected.statusRail.find((item) => item.stage === "advance")?.state).toBe("pending");

    const stoppedScenarios = [
      {
        suffix: "rejected",
        decision: {
          ...receipt.identity.reviewDecision!,
          verdict: "rejected" as const,
          findings: [{ id: "review:blocker", message: "The candidate has a blocker." }],
        },
        reason: "The immutable candidate review rejected this Phase.",
      },
      {
        suffix: "ci-blocked",
        decision: {
          ...receipt.identity.reviewDecision!,
          ciState: "ci-blocked-with-cause" as const,
        },
        reason: "The candidate CI state is ci-blocked-with-cause.",
      },
    ];
    for (const scenario of stoppedScenarios) {
      const stopped = applyProgramReceipt(
        reviewing,
        {
          ...receipt,
          receiptId: ProgramReceiptId.make(`receipt:review-owner-${scenario.suffix}`),
          effectId: ProgramEffectId.make(`effect:review-owner-${scenario.suffix}`),
          identity: {
            ...receipt.identity,
            reviewDecision: scenario.decision,
          },
        },
        now,
      );
      expect(stopped.state).toBe("attention_required");
      expect(stopped.attentionReason).toBe(scenario.reason);
      expect(stopped.phases[0]?.state).toBe("attention_required");
      expect(stopped.statusRail.find((item) => item.stage === "review")?.state).toBe("failed");
      expect(stopped.statusRail.find((item) => item.stage === "ci")?.state).toBe("failed");
      expect(stopped.statusRail.find((item) => item.stage === "admit")?.state).toBe("pending");
      expect(stopped.statusRail.find((item) => item.stage === "advance")?.state).toBe("pending");
    }
  });
});
