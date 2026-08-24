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
const implementationOwnerResultId = OwnerResultId.make(
  "owner-result:review-projection:implementation",
);
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
  it("projects the exact bounded team policy for the accountable owner", () => {
    const initial = makeInitialProgramProjection(startInput, {
      available: false,
      adapter: "unsupported",
      reason: "not under test",
    });
    const teamPolicy = {
      mode: "layered_hybrid" as const,
      maxHelpers: 4,
      maxConcurrent: 2,
      maxDepth: 1,
      maxRounds: 3,
      criteria: ["accepted tests pass"],
    };
    const receipt = {
      receiptId: ProgramReceiptId.make("receipt:implementation-owner-launch"),
      programId,
      programRevision: 2,
      effectId: ProgramEffectId.make("effect:implementation-owner-launch"),
      requestId,
      kind: "launch_owner_attempt",
      status: "succeeded",
      resultDigest: `sha256:${"6".repeat(64)}`,
      evidence: [{ kind: "thread", id: implementationOwnerThreadId }],
      createdAt: now,
      acknowledged: false,
      identity: {
        programId,
        requestId,
        phaseId,
        phaseCoordinatorThreadId,
        attemptId,
        ownerThreadId: implementationOwnerThreadId,
        preparedWorktree,
        prompt: "Own the Phase and keep every helper subordinate.",
        providerPolicy: {
          ...providerPolicy,
          runtimeMode: "full-access",
        },
        teamPolicy,
      },
      result: {
        ownerThreadId: implementationOwnerThreadId,
        providerRunId: RunId.make("run:implementation-owner"),
      },
    } satisfies RuntimeReceipt;

    const projected = applyProgramReceipt(initial, receipt, now);

    expect(projected.attempts).toHaveLength(1);
    expect(projected.attempts[0]?.threadId).toBe(implementationOwnerThreadId);
    expect(projected.attempts[0]?.teamPolicy).toEqual({
      mode: "layered_hybrid",
      maxHelpers: 4,
      maxConcurrent: 2,
      maxDepth: 1,
      maxRounds: 3,
      criteria: ["accepted tests pass"],
    });
    expect(projected.phases[0]?.ownerThreadId).toBe(implementationOwnerThreadId);
  });

  it("moves a failed implementation OwnerResult to attention_required with a replan command", () => {
    const initial = makeInitialProgramProjection(startInput, {
      available: false,
      adapter: "unsupported",
      reason: "not under test",
    });
    const ownerResultId = OwnerResultId.make("owner-result:failed-implementation");
    const resultDigest = `sha256:${"7".repeat(64)}`;
    const running = {
      ...initial,
      state: "running" as const,
      allowedCommands: ["pause", "stop"] as const,
      phases: initial.phases.map((phase) => ({
        ...phase,
        state: "running" as const,
        phaseCoordinatorThreadId,
        ownerThreadId: implementationOwnerThreadId,
        activeAttemptId: attemptId,
        preparedWorktree,
      })),
      attempts: [
        {
          attemptId,
          phaseId,
          ownerKind: "implementation" as const,
          state: "terminal_retained" as const,
          threadId: implementationOwnerThreadId,
          terminalKind: "failed" as const,
          ownerResultId: null,
          resultDigest: null,
        },
      ],
    };
    const receipt = {
      receiptId: ProgramReceiptId.make("receipt:failed-implementation-acknowledgement"),
      programId,
      programRevision: 4,
      effectId: ProgramEffectId.make("effect:failed-implementation-acknowledgement"),
      requestId,
      kind: "acknowledge_owner_result",
      status: "succeeded",
      resultDigest: `sha256:${"8".repeat(64)}`,
      evidence: [{ kind: "thread", id: implementationOwnerThreadId }],
      createdAt: now,
      acknowledged: false,
      identity: {
        requestId,
        ownerResultId,
        programId,
        phaseId,
        phaseCoordinatorThreadId,
        ownerThreadId: implementationOwnerThreadId,
        attemptId,
        ownerKind: "implementation",
        terminalKind: "failed",
        resultDigest,
        evidence: [
          { kind: "thread", id: implementationOwnerThreadId },
          { kind: "log", id: RunId.make("run:failed-implementation") },
        ],
        leaseId: preparedWorktree.leaseId,
        leaseEpoch: preparedWorktree.leaseEpoch,
        expiresAt: preparedWorktree.expiresAt,
      },
      result: { ownerResultId },
    } satisfies RuntimeReceipt;

    const projected = applyProgramReceipt(running, receipt, now);

    expect(projected.phases[0]?.state).toBe("failed");
    expect(projected.state).toBe("attention_required");
    expect(projected.attentionReason).toBe(
      "Implementation owner failed; operator replan required.",
    );
    expect(projected.allowedCommands).toContain("request_replan");
  });

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
        implementationOwnerResultId,
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

  it("retains review decisions without evaluating dirtyloops policy", () => {
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
    expect(projected.state).toBe("running");
    expect(projected.attentionReason).toBeNull();
    expect(projected.phases[0]?.state).toBe("reviewing");
    expect(projected.attempts[0]?.state).toBe("acknowledged");
    expect(projected.statusRail.find((item) => item.stage === "review")?.state).toBe("active");
    expect(projected.statusRail.find((item) => item.stage === "ci")?.state).toBe("pending");
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
      },
      {
        suffix: "ci-blocked",
        decision: {
          ...receipt.identity.reviewDecision!,
          ciState: "ci-blocked-with-cause" as const,
        },
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
      expect(stopped.state).toBe("running");
      expect(stopped.attentionReason).toBeNull();
      expect(stopped.phases[0]?.state).toBe("reviewing");
      expect(stopped.attempts[0]?.state).toBe("acknowledged");
      expect(stopped.statusRail.find((item) => item.stage === "review")?.state).toBe("active");
      expect(stopped.statusRail.find((item) => item.stage === "ci")?.state).toBe("pending");
      expect(stopped.statusRail.find((item) => item.stage === "admit")?.state).toBe("pending");
      expect(stopped.statusRail.find((item) => item.stage === "advance")?.state).toBe("pending");
    }
  });
});
