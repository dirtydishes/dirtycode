import { describe, expect, it } from "@effect/vitest";
import {
  DirtyloopsDecision,
  OwnerResultId,
  PhaseCallbackId,
  ProgramAttemptId,
  ProgramEffectId,
  ProgramPhaseId,
  ProgramReceiptId,
  ProgramRequestId,
  ThreadId,
  type ProgramProjection,
  type ReconcileProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makeDirtyloopsProgramDriver } from "./DirtyloopsProgramDriver.ts";

import {
  input,
  options,
  phaseId,
  programBudgetLimits,
  raw,
  rawPhase,
} from "./DirtyloopsProgramDriver.testkit.ts";

describe("DirtyloopsProgramDriver decision translation", () => {
  it.effect("maps a validated canonical graph without proposing a T3 effect", () =>
    Effect.gen(function* () {
      const driver = makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed(raw),
      });
      const decision = yield* driver.reconcile(input);

      expect(decision.kind).toBe("wait");
      expect(decision.projection.phases).toHaveLength(1);
      expect(decision.projection.phases[0]).toMatchObject({
        phaseId,
        blockedBy: ["agents-0ur.3"],
        blockerPath: ["agents-0ur.4", "agents-0ur.3"],
        phaseCoordinatorThreadId: null,
        ownerThreadId: null,
      });
      expect(decision.projection.attempts).toEqual([]);
      expect(decision.projection.threadBindings).toEqual(input.observedProjection.threadBindings);
      expect(decision.projection.sourceIdentity?.parity).toBe("current");
    }),
  );

  it.effect("projects canonical Program-wide limits and observed use", () =>
    Effect.gen(function* () {
      const limits = { ...programBudgetLimits, actions: { used: 0, limit: 2 } };
      const observed = {
        ...limits,
        actions: { used: 2, limit: 2 },
        concurrentWorktrees: { used: 1, limit: 2 },
        exhausted: ["actions" as const],
        dispatchAllowed: false,
      };
      const exhaustedRaw = {
        ...raw,
        decisionCode: "budget_exhausted",
        programState: "attention_required",
        reason: "dirtyloops Program budget exhausted: actions. New dispatch is blocked.",
        graph: { ...raw.graph, budgets: limits },
      } as unknown as DirtyloopsDecision;
      const budgetInput = {
        ...input,
        observedProjection: { ...input.observedProjection, budgets: observed },
      } as ReconcileProgramInput;
      const driver = makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed(exhaustedRaw),
      });

      const decision = yield* driver.reconcile(budgetInput);

      expect(decision.kind).toBe("wait");
      expect(decision.projection.state).toBe("attention_required");
      expect(decision.projection.attentionReason).toContain("actions");
      expect((decision.projection as ProgramProjection & { budgets: unknown }).budgets).toEqual({
        ...observed,
        exhausted: ["actions"],
        dispatchAllowed: false,
      });
    }),
  );

  it.effect(
    "launches immutable review from the acknowledged implementation Attempt after the terminal result is no longer observable",
    () =>
      Effect.gen(function* () {
        const candidateCommit = "4".repeat(40);
        const phaseCoordinatorThreadId = ThreadId.make("thread:phase:review-handoff");
        const ownerThreadId = ThreadId.make("thread:owner:review-handoff");
        const attemptId = ProgramAttemptId.make("attempt:review-handoff:implementation");
        const implementationOwnerResultId = OwnerResultId.make(
          "owner-result:review-handoff:implementation",
        );
        const preparedWorktree = {
          programId: input.attachment.programId,
          requestId: input.requestId,
          phaseId,
          phaseCoordinatorThreadId,
          ownerThreadId,
          projectId: options.projectId,
          ownerThreadTitle: `Dirtyloops Phase ${phaseId} implementation owner`,
          modelSelection: options.modelSelection,
          runtimeMode: options.runtimeMode,
          interactionMode: options.interactionMode,
          leaseId: "lease:review-handoff:1",
          leaseEpoch: 1,
          repositoryIdentity: input.attachment.repositoryId,
          repositoryRoot: "/repo",
          gitCommonDir: "/repo/.git",
          realPath: "/repo/worktrees/review-handoff",
          expectedIntegrationHead: raw.graph.repository.head,
          integrationRef: input.attachment.integrationRef,
          budgetIdentity: `sha256:${"9".repeat(64)}`,
          symbolicBranch: "dirtyloops/agents-0ur/review-handoff",
          startingCommit: raw.graph.repository.head,
          clean: true as const,
          declaredPaths: ["apps/server"],
          expiresAt: "2026-08-22T13:00:00.000Z",
        };
        const observedProjection: ProgramProjection = {
          ...input.observedProjection,
          repositorySnapshot: raw.graph.repository,
          phases: [
            {
              phaseId,
              title: rawPhase.title,
              state: "candidate",
              beadsStatus: "in_progress",
              dependencyIds: [],
              blockedBy: [],
              blockerPath: [],
              budgets: rawPhase.budgets,
              policy: rawPhase.policy,
              activeAttemptId: attemptId,
              phaseCoordinatorTargetThreadId: phaseCoordinatorThreadId,
              projectId: options.projectId,
              threadTitle: `Dirtyloops Phase ${phaseId} coordinator`,
              modelSelection: options.modelSelection,
              runtimeMode: options.runtimeMode,
              interactionMode: options.interactionMode,
              branch: preparedWorktree.symbolicBranch,
              worktreePath: preparedWorktree.realPath,
              phaseCoordinatorThreadId,
              ownerThreadId,
              preparedWorktree,
              lastLeaseEpoch: 1,
              leaseHeartbeatAt: input.occurredAt,
              receiptIds: [],
            },
          ],
          attempts: [
            {
              attemptId,
              phaseId,
              ownerKind: "implementation",
              state: "acknowledged",
              threadId: ownerThreadId,
              terminalKind: "succeeded",
              ownerResultId: implementationOwnerResultId,
              resultDigest: `sha256:${"8".repeat(64)}`,
            },
          ],
        };
        const reviewAttemptId = ProgramAttemptId.make(
          `attempt:dirtyloops:${phaseId}:review:broad:${candidateCommit}`,
        );
        const decision = yield* makeDirtyloopsProgramDriver({
          ...options,
          invoke: () =>
            Effect.succeed({
              ...raw,
              kind: "effects",
              decisionCode: "mutable_phase",
              action: {
                kind: "launch_review_owner",
                phaseId,
                implementationOwnerResultId,
                attemptId: reviewAttemptId,
                reviewOwnerThreadId: ThreadId.make("thread:review-handoff"),
                candidateId: candidateCommit,
                reviewId: `review:${phaseId}:${candidateCommit}:broad`,
                candidateCommit,
                reviewKind: "broad",
                prompt: "Review the exact immutable candidate.",
              },
              graph: {
                ...raw.graph,
                phases: [
                  {
                    ...rawPhase,
                    state: "ready",
                    dependencyIds: [],
                    blockedBy: [],
                    blockerPath: [],
                  },
                ],
              },
            }),
        }).reconcile({ ...input, observedProjection, ownerResults: [] });

        expect(decision.kind).toBe("effects");
        if (decision.kind !== "effects") return;
        expect(decision.effects).toHaveLength(1);
        expect(decision.effects[0]).toMatchObject({
          kind: "launch_review_owner",
          identity: {
            candidateCommit,
            implementationOwnerResultId,
            phaseCoordinatorThreadId,
          },
        });
      }),
  );

  it.effect("maps the integration coordinator request to one typed message effect", () =>
    Effect.gen(function* () {
      const phaseCoordinatorThreadId = ThreadId.make("thread:phase:integration-request");
      const candidateCommit = "4".repeat(40);
      const callbackId = PhaseCallbackId.make("phase-callback:integration-request");
      const callbackNonce = `nonce:${"7".repeat(64)}`;
      const integrationAdmissionNonce = `nonce:${"8".repeat(64)}`;
      const preparedWorktree = {
        programId: input.attachment.programId,
        requestId: ProgramRequestId.make("request:prepared-integration-request"),
        phaseId,
        phaseCoordinatorThreadId,
        ownerThreadId: ThreadId.make("thread:owner:integration-request"),
        projectId: options.projectId,
        ownerThreadTitle: "Implementation owner",
        modelSelection: options.modelSelection,
        runtimeMode: options.runtimeMode,
        interactionMode: options.interactionMode,
        leaseId: "lease:integration-request:1",
        leaseEpoch: 1,
        repositoryIdentity: "dirtydishes/agents",
        repositoryRoot: "/repo",
        gitCommonDir: "/repo/.git",
        realPath: "/repo/worktrees/integration-request",
        expectedIntegrationHead: raw.graph.repository.head,
        integrationRef: input.attachment.integrationRef,
        budgetIdentity: `sha256:${"9".repeat(64)}`,
        symbolicBranch: "dirtyloops/agents-0ur/integration-request",
        startingCommit: raw.graph.repository.head,
        clean: true as const,
        declaredPaths: ["skills/dirtyloops"],
        expiresAt: "2026-08-22T13:00:00.000Z",
      };
      const callbackReceipt = {
        receiptId: ProgramReceiptId.make("receipt:integration-request-callback"),
        programId: input.attachment.programId,
        programRevision: 2,
        effectId: ProgramEffectId.make("effect:integration-request-callback"),
        requestId: input.requestId,
        kind: "acknowledge_phase_callback" as const,
        status: "succeeded" as const,
        resultDigest: `sha256:${"6".repeat(64)}`,
        evidence: [{ kind: "commit" as const, id: candidateCommit }],
        createdAt: input.occurredAt,
        acknowledged: true,
        identity: {
          programId: input.attachment.programId,
          requestId: input.requestId,
          phaseCallbackId: callbackId,
          phaseId,
          phaseCoordinatorThreadId,
          programCoordinatorThreadId: input.attachment.programCoordinatorThreadId,
          sourceThreadId: phaseCoordinatorThreadId,
          nonce: callbackNonce,
          ownerResultIds: [OwnerResultId.make("owner-result:integration-review")],
          candidateCommit,
          disposition: "approved" as const,
          evidence: [{ kind: "commit" as const, id: candidateCommit }],
        },
        result: { phaseCallbackId: callbackId, nonce: callbackNonce },
      };
      const observedProjection: ProgramProjection = {
        ...input.observedProjection,
        repositorySnapshot: raw.graph.repository,
        phases: [
          {
            phaseId,
            title: "Approved Phase",
            state: "reviewing",
            beadsStatus: "in_progress",
            dependencyIds: [],
            blockedBy: [],
            blockerPath: [],
            budgets: rawPhase.budgets,
            policy: rawPhase.policy,
            activeAttemptId: null,
            phaseCoordinatorTargetThreadId: phaseCoordinatorThreadId,
            projectId: options.projectId,
            threadTitle: `Dirtyloops Phase ${phaseId} coordinator`,
            modelSelection: options.modelSelection,
            runtimeMode: options.runtimeMode,
            interactionMode: options.interactionMode,
            branch: null,
            worktreePath: null,
            phaseCoordinatorThreadId,
            ownerThreadId: preparedWorktree.ownerThreadId,
            preparedWorktree,
            lastLeaseEpoch: 1,
            leaseHeartbeatAt: null,
            receiptIds: [callbackReceipt.receiptId],
          },
        ],
        receipts: [callbackReceipt],
        statusRail: [
          { stage: "plan", state: "settled", receiptId: null },
          { stage: "ready", state: "settled", receiptId: null },
          { stage: "execute", state: "settled", receiptId: null },
          { stage: "review", state: "active", receiptId: callbackReceipt.receiptId },
          { stage: "ci", state: "pending", receiptId: null },
          { stage: "admit", state: "pending", receiptId: null },
          { stage: "advance", state: "pending", receiptId: null },
        ],
      };
      const action = {
        kind: "deliver_integration_admission_request" as const,
        integrationAdmissionRequestId: `integration-admission-request:${input.attachment.programId}:${phaseId}:${candidateCommit}`,
        phaseId,
        programCoordinatorThreadId: input.attachment.programCoordinatorThreadId,
        integrationCoordinatorThreadId: input.attachment.integrationCoordinatorThreadId,
        sourceThreadId: input.attachment.programCoordinatorThreadId,
        phaseCallbackId: callbackId,
        phaseCallbackNonce: callbackNonce,
        candidateCommit,
        expectedParent: raw.graph.repository.head,
        integrationRef: input.attachment.integrationRef,
        leaseId: preparedWorktree.leaseId,
        leaseEpoch: preparedWorktree.leaseEpoch,
        expiresAt: preparedWorktree.expiresAt,
        integrationAdmissionNonce,
      };
      const decision = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () =>
          Effect.succeed({
            ...raw,
            kind: "effects",
            decisionCode: "mutable_phase",
            action,
            graph: {
              ...raw.graph,
              phases: [
                { ...rawPhase, state: "ready", dependencyIds: [], blockedBy: [], blockerPath: [] },
              ],
            },
          }),
      }).reconcile({ ...input, observedProjection });

      expect(decision.kind).toBe("effects");
      if (decision.kind !== "effects") return;
      const { kind: _kind, ...actionIdentity } = action;
      expect(decision.effects).toHaveLength(1);
      expect(decision.effects[0]).toMatchObject({
        kind: "deliver_integration_admission_request",
        identity: {
          programId: input.attachment.programId,
          requestId: input.requestId,
          ...actionIdentity,
        },
      });
      expect(decision.projection.phases[0]?.state).toBe("approved");
      expect(decision.projection.statusRail.find((item) => item.stage === "review")?.state).toBe(
        "settled",
      );
      expect(decision.projection.statusRail.find((item) => item.stage === "ci")?.state).toBe(
        "settled",
      );
    }),
  );

  it.effect("waits for the next canonical graph before projecting Admission", () =>
    Effect.gen(function* () {
      const nextPhaseId = ProgramPhaseId.make("agents-0ur.5");
      const phaseCoordinatorThreadId = ThreadId.make("thread:phase:agents-0ur.4");
      const candidateCommit = "4".repeat(40);
      const preparedCommit = "5".repeat(40);
      const phase = {
        phaseId,
        title: "Admitted Phase",
        state: "approved" as const,
        beadsStatus: "in_progress",
        dependencyIds: [],
        blockedBy: [],
        blockerPath: [],
        budgets: rawPhase.budgets,
        policy: rawPhase.policy,
        activeAttemptId: null,
        phaseCoordinatorTargetThreadId: phaseCoordinatorThreadId,
        projectId: options.projectId,
        threadTitle: `Dirtyloops Phase ${phaseId} coordinator`,
        modelSelection: options.modelSelection,
        runtimeMode: options.runtimeMode,
        interactionMode: options.interactionMode,
        branch: null,
        worktreePath: null,
        phaseCoordinatorThreadId,
        ownerThreadId: null,
        preparedWorktree: null,
        lastLeaseEpoch: 1,
        leaseHeartbeatAt: null,
        receiptIds: [],
      };
      const nextPhase = {
        ...phase,
        phaseId: nextPhaseId,
        title: "Next Phase",
        state: "blocked" as const,
        beadsStatus: "open",
        dependencyIds: [phaseId],
        blockedBy: [phaseId],
        blockerPath: [nextPhaseId, phaseId],
        phaseCoordinatorTargetThreadId: ThreadId.make(`thread:dirtyloops-phase:${nextPhaseId}`),
        phaseCoordinatorThreadId: null,
        lastLeaseEpoch: 0,
      };
      const callbackReceipt = {
        receiptId: ProgramReceiptId.make("receipt:admission-callback-ack"),
        programId: input.attachment.programId,
        programRevision: 2,
        effectId: ProgramEffectId.make("effect:admission-callback-ack"),
        requestId: input.requestId,
        kind: "acknowledge_phase_callback" as const,
        status: "succeeded" as const,
        resultDigest: `sha256:${"6".repeat(64)}` as const,
        evidence: [{ kind: "commit" as const, id: candidateCommit }],
        createdAt: input.occurredAt,
        acknowledged: true,
        identity: {
          programId: input.attachment.programId,
          requestId: input.requestId,
          phaseCallbackId: PhaseCallbackId.make("phase-callback:agents-0ur:agents-0ur.4"),
          phaseId,
          phaseCoordinatorThreadId,
          programCoordinatorThreadId: input.attachment.programCoordinatorThreadId,
          sourceThreadId: phaseCoordinatorThreadId,
          nonce: `nonce:${"7".repeat(64)}`,
          ownerResultIds: [OwnerResultId.make("owner-result:admission-review")],
          candidateCommit,
          disposition: "approved" as const,
          evidence: [{ kind: "commit" as const, id: candidateCommit }],
        },
        result: {
          phaseCallbackId: PhaseCallbackId.make("phase-callback:agents-0ur:agents-0ur.4"),
          nonce: `nonce:${"7".repeat(64)}`,
        },
      };
      const observedProjection: ProgramProjection = {
        ...input.observedProjection,
        repositorySnapshot: raw.graph.repository,
        phases: [phase, nextPhase],
        receipts: [callbackReceipt],
        statusRail: [
          { stage: "plan", state: "settled", receiptId: null },
          { stage: "ready", state: "settled", receiptId: null },
          { stage: "execute", state: "settled", receiptId: null },
          { stage: "review", state: "settled", receiptId: null },
          { stage: "ci", state: "settled", receiptId: null },
          { stage: "admit", state: "pending", receiptId: null },
          { stage: "advance", state: "pending", receiptId: null },
        ],
      };
      const admission = {
        ...raw,
        kind: "wait",
        decisionCode: "admission_complete",
        action: {
          kind: "admission_complete",
          admissionId: `admission:${phaseId}`,
          phaseId,
          integrationCoordinatorThreadId: input.attachment.integrationCoordinatorThreadId,
          integrationRef: input.attachment.integrationRef,
          expectedParent: raw.graph.repository.head,
          candidateCommit,
          preparedCommit,
          refUpdated: true,
          beadsTaskId: phaseId,
          beadsClosed: true,
          evidence: [
            { kind: "commit", id: preparedCommit },
            { kind: "task", id: phaseId },
          ],
        },
        graph: {
          ...raw.graph,
          phases: [
            { ...rawPhase, state: "ready", dependencyIds: [], blockedBy: [], blockerPath: [] },
            {
              ...rawPhase,
              phaseId: nextPhaseId,
              title: "Next Phase",
              state: "blocked",
              dependencyIds: [phaseId],
              blockedBy: [phaseId],
              blockerPath: [nextPhaseId, phaseId],
            },
          ],
        },
      };
      const freshGraph = {
        ...raw,
        programRevision: raw.programRevision + 1,
        kind: "wait" as const,
        decisionCode: "graph_snapshot" as const,
        action: { kind: "wait" as const },
        graph: {
          ...raw.graph,
          repository: { ...raw.graph.repository, head: preparedCommit },
          phases: [
            {
              ...rawPhase,
              state: "integrated" as const,
              beadsStatus: "closed",
              dependencyIds: [],
              blockedBy: [],
              blockerPath: [],
            },
            {
              ...rawPhase,
              phaseId: nextPhaseId,
              title: "Next Phase",
              state: "ready" as const,
              beadsStatus: "open",
              dependencyIds: [phaseId],
              blockedBy: [],
              blockerPath: [],
            },
          ],
        },
      };
      let invocation = 0;
      const driver = makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed(invocation++ === 0 ? admission : freshGraph),
      });
      const decision = yield* driver.reconcile({ ...input, observedProjection });

      expect(decision.kind).toBe("wait");
      expect(decision.projection.repositorySnapshot?.head).toBe(raw.graph.repository.head);
      expect(decision.projection.phases.find((item) => item.phaseId === phaseId)).toMatchObject({
        state: "approved",
      });
      expect(decision.projection.phases.find((item) => item.phaseId === nextPhaseId)).toMatchObject(
        { state: "blocked", blockedBy: [phaseId], blockerPath: [nextPhaseId, phaseId] },
      );

      const refreshed = yield* driver.reconcile({
        ...input,
        observedProjection: decision.projection,
      });
      expect(refreshed.projection.repositorySnapshot?.head).toBe(preparedCommit);
      expect(refreshed.projection.phases.find((item) => item.phaseId === phaseId)).toMatchObject({
        state: "integrated",
        beadsStatus: "closed",
      });
      expect(
        refreshed.projection.phases.find((item) => item.phaseId === nextPhaseId),
      ).toMatchObject({ state: "ready", blockedBy: [], blockerPath: [] });
    }),
  );

  it.effect("projects an Admission policy block without a T3 mutation effect", () =>
    Effect.gen(function* () {
      const phaseCoordinatorThreadId = ThreadId.make("thread:phase:admission-blocked");
      const candidateCommit = "4".repeat(40);
      const phase = {
        phaseId,
        title: "Blocked Admission Phase",
        state: "approved" as const,
        beadsStatus: "in_progress",
        dependencyIds: [],
        blockedBy: [],
        blockerPath: [],
        budgets: rawPhase.budgets,
        policy: rawPhase.policy,
        activeAttemptId: null,
        phaseCoordinatorTargetThreadId: phaseCoordinatorThreadId,
        projectId: options.projectId,
        threadTitle: `Dirtyloops Phase ${phaseId} coordinator`,
        modelSelection: options.modelSelection,
        runtimeMode: options.runtimeMode,
        interactionMode: options.interactionMode,
        branch: null,
        worktreePath: null,
        phaseCoordinatorThreadId,
        ownerThreadId: null,
        preparedWorktree: null,
        lastLeaseEpoch: 1,
        leaseHeartbeatAt: null,
        receiptIds: [],
      };
      const callbackReceipt = {
        receiptId: ProgramReceiptId.make("receipt:blocked-admission-callback"),
        programId: input.attachment.programId,
        programRevision: 2,
        effectId: ProgramEffectId.make("effect:blocked-admission-callback"),
        requestId: input.requestId,
        kind: "acknowledge_phase_callback" as const,
        status: "succeeded" as const,
        resultDigest: `sha256:${"6".repeat(64)}` as const,
        evidence: [{ kind: "commit" as const, id: candidateCommit }],
        createdAt: input.occurredAt,
        acknowledged: true,
        identity: {
          programId: input.attachment.programId,
          requestId: input.requestId,
          phaseCallbackId: PhaseCallbackId.make("phase-callback:blocked-admission"),
          phaseId,
          phaseCoordinatorThreadId,
          programCoordinatorThreadId: input.attachment.programCoordinatorThreadId,
          sourceThreadId: phaseCoordinatorThreadId,
          nonce: `nonce:${"7".repeat(64)}`,
          ownerResultIds: [OwnerResultId.make("owner-result:blocked-admission")],
          candidateCommit,
          disposition: "approved" as const,
          evidence: [{ kind: "commit" as const, id: candidateCommit }],
        },
        result: {
          phaseCallbackId: PhaseCallbackId.make("phase-callback:blocked-admission"),
          nonce: `nonce:${"7".repeat(64)}`,
        },
      };
      const observedProjection: ProgramProjection = {
        ...input.observedProjection,
        repositorySnapshot: raw.graph.repository,
        phases: [phase],
        receipts: [callbackReceipt],
        statusRail: [
          { stage: "plan", state: "settled", receiptId: null },
          { stage: "ready", state: "settled", receiptId: null },
          { stage: "execute", state: "settled", receiptId: null },
          { stage: "review", state: "settled", receiptId: null },
          { stage: "ci", state: "settled", receiptId: null },
          { stage: "admit", state: "active", receiptId: null },
          { stage: "advance", state: "pending", receiptId: null },
        ],
      };
      const blocked = {
        ...raw,
        kind: "wait",
        decisionCode: "admission_blocked",
        programState: "attention_required",
        reason:
          "dirtyloops Admission blocked: integration head moved before Admission (integration_head_moved).",
        wakeConditions: ["beads_changed", "operator_intent"],
        action: {
          kind: "admission_blocked",
          admissionId: `admission:${phaseId}`,
          phaseId,
          integrationCoordinatorThreadId: input.attachment.integrationCoordinatorThreadId,
          integrationRef: input.attachment.integrationRef,
          expectedParent: raw.graph.repository.head,
          candidateCommit,
          preparedCommit: "5".repeat(40),
          refUpdated: false,
          beadsTaskId: phaseId,
          beadsClosed: false,
          finding: {
            id: "integration_head_moved",
            message: "integration head moved before Admission",
            evidence: {
              expectedParent: raw.graph.repository.head,
              actualHead: "8".repeat(40),
            },
          },
        },
        graph: {
          ...raw.graph,
          phases: [
            { ...rawPhase, state: "ready", dependencyIds: [], blockedBy: [], blockerPath: [] },
          ],
        },
      };
      const decision = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed(blocked),
      }).reconcile({ ...input, observedProjection });

      expect(decision.kind).toBe("wait");
      expect(decision.projection.state).toBe("attention_required");
      expect(decision.projection.attentionReason).toContain("integration_head_moved");
      expect(decision.projection.repositorySnapshot?.head).toBe(raw.graph.repository.head);
      expect(decision.projection.phases[0]?.state).toBe("attention_required");
      expect(decision.projection.statusRail.find((item) => item.stage === "review")?.state).toBe(
        "settled",
      );
      expect(decision.projection.statusRail.find((item) => item.stage === "ci")?.state).toBe(
        "settled",
      );
      expect(decision.projection.statusRail.find((item) => item.stage === "admit")?.state).toBe(
        "failed",
      );
      expect(decision.projection.statusRail.find((item) => item.stage === "advance")?.state).toBe(
        "failed",
      );
      expect(decision.projection.allowedCommands).toEqual(["resume", "stop", "request_replan"]);
    }),
  );
});
