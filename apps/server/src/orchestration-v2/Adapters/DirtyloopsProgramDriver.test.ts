import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DirtyloopsDecision,
  OwnerResultId,
  PhaseCallbackId,
  ProgramEffectId,
  ProgramId,
  ProgramPhaseId,
  ProgramReceiptId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ProgramProjection,
  type ReconcileProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { makeDeterministicProgramDriver } from "./DeterministicProgramDriver.ts";
import {
  makeDirtyloopsProcessInvoker,
  makeDirtyloopsProgramDriver,
  resolveDirtyloopsDriverClosure,
} from "./DirtyloopsProgramDriver.ts";

const encodeDirtyloopsDecisionJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(DirtyloopsDecision),
);
const phaseId = ProgramPhaseId.make("agents-0ur.4");
const programBudgetLimits = {
  activeThreads: { used: 0, limit: 16 },
  nativeHelpers: { used: 0, limit: 8 },
  helperDepth: { used: 0, limit: 1 },
  providerTurns: { used: 0, limit: 200 },
  tokens: { used: 0, limit: 1_000_000 },
  costMilliUsd: { used: 0, limit: 100_000 },
  wallClockMinutes: { used: 0, limit: 480 },
  actions: { used: 0, limit: 1_000 },
  concurrentWorktrees: { used: 0, limit: 2 },
  cpuMillis: { used: 0, limit: 3_600_000 },
  memoryMiB: { used: 0, limit: 16_384 },
  diskMiB: { used: 0, limit: 102_400 },
  repairs: { used: 0, limit: 1 },
  retries: { used: 0, limit: 6 },
} as const;
const input = {
  attachment: {
    programId: ProgramId.make("agents-0ur"),
    repositoryId: "dirtydishes/agents",
    integrationRef: "refs/heads/main",
    programCoordinatorThreadId: ThreadId.make("thread:program"),
    integrationCoordinatorThreadId: ThreadId.make("thread:integration"),
    dirtyloopsGenerationId: `dirtyloops:${"a".repeat(64)}`,
    dirtyloopsAdapterDigest: `sha256:${"b".repeat(64)}`,
    t3EnvironmentId: "environment:test",
    createdAt: "2026-08-22T12:00:00.000Z",
  },
  requestId: ProgramRequestId.make("request:readonly"),
  observedProgramRevision: 2,
  observedProjection: {
    programId: ProgramId.make("agents-0ur"),
    revision: 2,
    title: "Dirtyloops 3.0",
    outcome: "Implement the accepted Program.",
    state: "running",
    terminal: false,
    attentionReason: null,
    certificationFailures: [],
    allowedCommands: ["pause", "stop"],
    sourceIdentity: null,
    repositorySnapshot: null,
    beadsRevision: null,
    graphDigest: null,
    phases: [],
    attempts: [],
    receipts: [],
    threadBindings: [
      {
        threadId: ThreadId.make("thread:program"),
        role: "program_coordinator",
        phaseId: null,
        attemptId: null,
      },
      {
        threadId: ThreadId.make("thread:integration"),
        role: "integration_coordinator",
        phaseId: null,
        attemptId: null,
      },
    ],
    statusRail: [],
    activity: [],
    deliberations: [],
    budgets: { ...programBudgetLimits, exhausted: [], dispatchAllowed: true },
    activeAgentCount: 0,
    goalCapability: { available: false, adapter: "unsupported", reason: "Not certified." },
    lastEventAt: "2026-08-22T12:00:00.000Z",
  },
  wakeCause: "manual",
  operatorIntent: null,
  occurredAt: "2026-08-22T12:05:00.000Z",
  receipts: [],
  ownerResults: [],
} satisfies ReconcileProgramInput;

const raw = {
  schemaVersion: 1,
  kind: "wait",
  decisionCode: "graph_snapshot",
  certificationFailures: [],
  programRevision: 3,
  programState: "running",
  operatorDecision: {
    status: "accepted",
    code: "accepted",
    message: "Program wake completed.",
  },
  reason: "Canonical graph compiled.",
  wakeConditions: ["beads_changed", "operator_intent"],
  graph: {
    programId: ProgramId.make("agents-0ur"),
    title: "Dirtyloops 3.0",
    outcome: "Implement the accepted Program.",
    beadsRevision: `sha256:${"c".repeat(64)}`,
    graphDigest: `sha256:${"d".repeat(64)}`,
    budgets: programBudgetLimits,
    phases: [
      {
        phaseId,
        title: "Mutable Phase",
        beadsStatus: "open",
        state: "blocked",
        dependencyIds: [ProgramPhaseId.make("agents-0ur.3")],
        blockedBy: [ProgramPhaseId.make("agents-0ur.3")],
        blockerPath: [phaseId, ProgramPhaseId.make("agents-0ur.3")],
        policy: {
          declaredPaths: [],
          admissionChecks: [],
          providerPolicy: { kind: "program_default" },
          retryPolicy: { maxAttempts: 3 },
          reviewPolicy: { kind: "independent" },
          teamPolicy: { kind: "solo" },
        },
        budgets: {
          attempts: { used: 0, limit: 3 },
          wallClockMinutes: { used: 0, limit: 60 },
          tokens: { used: 0, limit: 120000 },
        },
      },
    ],
    sourceIdentity: {
      sourceCommit: "e".repeat(40),
      sourceDigest: `sha256:${"a".repeat(64)}`,
      installedDigest: `sha256:${"a".repeat(64)}`,
      schemaGeneration: `sha256:${"1".repeat(64)}`,
      adapterDigest: `sha256:${"b".repeat(64)}`,
      generationId: `dirtyloops:${"a".repeat(64)}`,
      parity: "current",
    },
    repository: {
      repositoryId: "dirtydishes/agents",
      head: "3".repeat(40),
      gitCommonDir: "/repo/.git",
      symbolicRef: "refs/heads/main",
      integrationRef: "refs/heads/main",
    },
    receipts: [],
    observedAt: "2026-08-22T12:05:00.000Z",
  },
} satisfies DirtyloopsDecision;

const options = {
  projectId: ProjectId.make("project:agents"),
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-sol",
  },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
};
const rawPhase = raw.graph.phases[0]!;

describe("DirtyloopsProgramDriver", () => {
  it.effect("binds the executable to one regular file inside the installed skill closure", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-dirtyloops-closure-",
      });
      const installedRoot = path.join(fixtureRoot, "installed");
      const driverPath = path.join(installedRoot, "scripts", "program-driver.mjs");
      const outsidePath = path.join(fixtureRoot, "outside-driver.mjs");
      yield* fileSystem.makeDirectory(path.dirname(driverPath), { recursive: true });
      yield* fileSystem.writeFileString(driverPath, "export {};\n");
      yield* fileSystem.writeFileString(outsidePath, "export {};\n");

      const resolved = yield* resolveDirtyloopsDriverClosure(installedRoot);
      expect(resolved).toEqual({ installedSkillRoot: installedRoot, driverPath });

      yield* fileSystem.remove(driverPath);
      yield* fileSystem.symlink(outsidePath, driverPath);
      const result = yield* Effect.result(resolveDirtyloopsDriverClosure(installedRoot));
      assert(Result.isFailure(result));
      expect(result.failure.reason).toContain("installed dirtyloops closure");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("pins a canonical installed root when a configured alias is retargeted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-dirtyloops-root-alias-",
      });
      const firstRoot = path.join(fixtureRoot, "first");
      const secondRoot = path.join(fixtureRoot, "second");
      const aliasRoot = path.join(fixtureRoot, "installed");
      for (const root of [firstRoot, secondRoot]) {
        yield* fileSystem.makeDirectory(path.join(root, "scripts"), { recursive: true });
        yield* fileSystem.writeFileString(
          path.join(root, "scripts", "program-driver.mjs"),
          "export {};\n",
        );
      }
      yield* fileSystem.symlink(firstRoot, aliasRoot);

      const resolved = yield* resolveDirtyloopsDriverClosure(aliasRoot);
      yield* fileSystem.remove(aliasRoot);
      yield* fileSystem.symlink(secondRoot, aliasRoot);

      expect(resolved).toEqual({
        installedSkillRoot: firstRoot,
        driverPath: path.join(firstRoot, "scripts", "program-driver.mjs"),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

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

  it.effect("runs the same Phase graph contract through fake and real driver seams", () =>
    Effect.gen(function* () {
      const targetThreadId = ThreadId.make(`thread:dirtyloops-phase:${phaseId}`);
      const fixtureProjection: ProgramProjection = {
        ...input.observedProjection,
        phases: [
          {
            phaseId,
            title: rawPhase.title,
            state: "blocked",
            beadsStatus: null,
            dependencyIds: rawPhase.dependencyIds,
            blockedBy: [],
            blockerPath: [],
            budgets: null,
            policy: null,
            activeAttemptId: null,
            phaseCoordinatorTargetThreadId: targetThreadId,
            projectId: options.projectId,
            threadTitle: `Dirtyloops Phase ${phaseId} coordinator`,
            modelSelection: options.modelSelection,
            runtimeMode: options.runtimeMode,
            interactionMode: options.interactionMode,
            branch: null,
            worktreePath: null,
            phaseCoordinatorThreadId: null,
            ownerThreadId: null,
            preparedWorktree: null,
            lastLeaseEpoch: 0,
            leaseHeartbeatAt: null,
            receiptIds: [],
          },
        ],
      };
      const fake = yield* makeDeterministicProgramDriver().reconcile({
        ...input,
        observedProjection: fixtureProjection,
      });
      const real = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed(raw),
      }).reconcile(input);

      expect(
        real.projection.phases.map(({ phaseId, title, dependencyIds }) => ({
          phaseId,
          title,
          dependencyIds,
        })),
      ).toEqual(
        fake.projection.phases.map(({ phaseId, title, dependencyIds }) => ({
          phaseId,
          title,
          dependencyIds,
        })),
      );
      expect(real.kind).toBe("wait");
      expect(fake.kind).toBe("effects");
    }),
  );

  it.effect("rejects a successful decision whose certified attachment identity differs", () =>
    Effect.gen(function* () {
      const mismatches: ReadonlyArray<DirtyloopsDecision> = [
        {
          ...raw,
          graph: {
            ...raw.graph,
            repository: { ...raw.graph.repository, repositoryId: "wrong/repository" },
          },
        },
        {
          ...raw,
          graph: {
            ...raw.graph,
            repository: { ...raw.graph.repository, symbolicRef: "refs/heads/wrong" },
          },
        },
        {
          ...raw,
          graph: {
            ...raw.graph,
            sourceIdentity: {
              ...raw.graph.sourceIdentity,
              generationId: `dirtyloops:${"9".repeat(64)}`,
            },
          },
        },
        {
          ...raw,
          graph: {
            ...raw.graph,
            sourceIdentity: {
              ...raw.graph.sourceIdentity,
              adapterDigest: `sha256:${"8".repeat(64)}`,
            },
          },
        },
      ];

      for (const mismatch of mismatches) {
        const error = yield* makeDirtyloopsProgramDriver({
          ...options,
          invoke: () => Effect.succeed(mismatch),
        })
          .reconcile(input)
          .pipe(Effect.flip);
        expect(error.reason).toContain("certification failures do not match");
      }
    }),
  );

  it.effect(
    "rejects a prepared-worktree permit with a foreign integration ref or budget identity",
    () =>
      Effect.gen(function* () {
        const phaseCoordinatorThreadId = ThreadId.make("thread:phase:agents-0ur.4");
        const observedProjection: ProgramProjection = {
          ...input.observedProjection,
          repositorySnapshot: raw.graph.repository,
          phases: [
            {
              phaseId,
              title: rawPhase.title,
              state: "running",
              beadsStatus: rawPhase.beadsStatus,
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
              lastLeaseEpoch: 0,
              leaseHeartbeatAt: null,
              receiptIds: [],
            },
          ],
        };
        const permit = {
          programId: input.attachment.programId,
          phaseId,
          phaseCoordinatorThreadId,
          leaseId: "lease:agents-0ur:agents-0ur.4:1",
          leaseEpoch: 1,
          repositoryIdentity: input.attachment.repositoryId,
          repositoryRoot: "/repo",
          gitCommonDir: "/repo/.git",
          realPath: "/repo-worktrees/agents-0ur.4",
          expectedIntegrationHead: raw.graph.repository.head,
          integrationRef: input.attachment.integrationRef,
          budgetIdentity: "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
          symbolicBranch: "dirtyloops/agents-0ur/agents-0ur.4/attempt-1",
          startingCommit: raw.graph.repository.head,
          clean: true,
          declaredPaths: [],
          expiresAt: "2026-08-22T13:05:00.000Z",
        } as const;
        const mutableDecision = {
          ...raw,
          kind: "effects",
          decisionCode: "mutable_phase",
          action: {
            kind: "bind_prepared_worktree",
            phaseId,
            ownerThreadId: ThreadId.make("thread:owner:agents-0ur.4"),
            permit,
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
        } satisfies DirtyloopsDecision;

        for (const mismatchedPermit of [
          { ...permit, integrationRef: "refs/heads/foreign" as const },
          { ...permit, budgetIdentity: `sha256:${"9".repeat(64)}` as const },
        ]) {
          const failure = yield* makeDirtyloopsProgramDriver({
            ...options,
            invoke: () =>
              Effect.succeed({
                ...mutableDecision,
                action: { ...mutableDecision.action, permit: mismatchedPermit },
              }),
          })
            .reconcile({ ...input, observedProjection })
            .pipe(Effect.flip);
          expect(failure.reason).toContain("worktree permit does not match");
        }
      }),
  );

  it.effect("persists a typed stale-parity process decision as attention-required state", () =>
    Effect.gen(function* () {
      const stale: DirtyloopsDecision = {
        ...raw,
        decisionCode: "recertification_required",
        certificationFailures: ["source_parity_stale"],
        programState: "attention_required",
        reason: "installed dirtyloops skill does not match source. Mutable work is blocked.",
        wakeConditions: ["source_parity_restored", "operator_intent"],
        graph: {
          ...raw.graph,
          sourceIdentity: {
            ...raw.graph.sourceIdentity,
            sourceDigest: `sha256:${"7".repeat(64)}`,
            parity: "stale",
          },
        },
      };
      const output = yield* encodeDirtyloopsDecisionJson(stale);
      const outputBase64 = Buffer.from(output).toString("base64");
      const invoke = yield* makeDirtyloopsProcessInvoker({
        executable: process.execPath,
        args: [
          "-e",
          `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(Buffer.from("${outputBase64}", "base64")))`,
        ],
        cwd: process.cwd(),
      });
      const decision = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke,
      }).reconcile(input);

      expect(decision.projection.state).toBe("attention_required");
      expect(decision.projection.attentionReason).toContain("does not match source");
      expect(decision.projection.certificationFailures).toEqual(["source_parity_stale"]);
      expect(decision.projection.sourceIdentity?.parity).toBe("stale");
      expect(decision.projection.attempts).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("persists a typed repository mismatch instead of treating it as a process error", () =>
    Effect.gen(function* () {
      const mismatch: DirtyloopsDecision = {
        ...raw,
        decisionCode: "recertification_required",
        certificationFailures: ["repository_identity_mismatch"],
        programState: "attention_required",
        reason:
          "repository identity does not match the Program attachment. Mutable work is blocked.",
        wakeConditions: ["attachment_changed", "operator_intent"],
        graph: {
          ...raw.graph,
          repository: { ...raw.graph.repository, repositoryId: "wrong/repository" },
        },
      };
      const decision = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed(mismatch),
      }).reconcile(input);

      expect(decision.projection.state).toBe("attention_required");
      expect(decision.projection.attentionReason).toContain("repository identity");
      expect(decision.projection.repositorySnapshot?.repositoryId).toBe("wrong/repository");
      expect(decision.projection.allowedCommands).toEqual(["stop"]);

      const illegalStop = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed({ ...mismatch, programState: "stopped" }),
      })
        .reconcile(input)
        .pipe(Effect.flip);
      expect(illegalStop.reason).toContain("failed certification transition");

      const stoppedProjection: ProgramProjection = {
        ...input.observedProjection,
        state: "stopped",
        terminal: true,
        allowedCommands: [],
      };
      const retainedStop = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed({ ...mismatch, programState: "stopped" }),
      }).reconcile({ ...input, observedProjection: stoppedProjection });
      expect(retainedStop.projection.state).toBe("stopped");

      const acceptedStop = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () =>
          Effect.succeed({
            ...mismatch,
            programState: "stopped",
            operatorDecision: {
              status: "accepted",
              code: "accepted",
              message: "Program stopped.",
            },
          }),
      }).reconcile({
        ...input,
        operatorIntent: { kind: "stop" },
      });
      expect(acceptedStop.projection.state).toBe("stopped");
      expect(acceptedStop.projection.certificationFailures).toEqual([
        "repository_identity_mismatch",
      ]);
    }),
  );

  it.effect("bounds repeated read-only decision activity", () =>
    Effect.gen(function* () {
      const driver = makeDirtyloopsProgramDriver({
        ...options,
        invoke: (current) =>
          Effect.succeed({
            ...raw,
            programRevision: current.observedProgramRevision + 1,
            graph: { ...raw.graph, observedAt: current.occurredAt },
          }),
      });
      let projection: ProgramProjection = input.observedProjection;
      for (let revision = 0; revision < 150; revision += 1) {
        const decision = yield* driver.reconcile({
          ...input,
          observedProgramRevision: projection.revision,
          observedProjection: projection,
          occurredAt: `2026-08-22T12:${String(revision % 60).padStart(2, "0")}:00.000Z`,
        });
        projection = decision.projection;
      }

      expect(projection.activity).toHaveLength(100);
      expect(projection.activity.at(-1)?.message).toBe("Canonical graph compiled.");
    }),
  );

  it.live("allows combined Admission checks beyond the legacy 15-second limit", () =>
    Effect.gen(function* () {
      const output = yield* encodeDirtyloopsDecisionJson(raw);
      const outputBase64 = Buffer.from(output).toString("base64");
      const invoke = yield* makeDirtyloopsProcessInvoker({
        executable: process.execPath,
        args: [
          "-e",
          `process.stdin.resume(); process.stdin.on("end", () => setTimeout(() => process.stdout.write(Buffer.from("${outputBase64}", "base64")), 15500))`,
        ],
        cwd: process.cwd(),
      });

      const result = yield* invoke(input);
      expect(result).toEqual(raw);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("bounds child output in bytes and classifies process failures", () =>
    Effect.gen(function* () {
      const invoke = (
        source: string,
        extra: {
          readonly maxStdoutBytes?: number;
          readonly maxStderrBytes?: number;
          readonly timeoutMillis?: number;
        } = {},
      ) =>
        makeDirtyloopsProcessInvoker({
          executable: process.execPath,
          args: ["-e", source],
          cwd: process.cwd(),
          maxStdoutBytes: 5,
          maxStderrBytes: 5,
          ...extra,
        }).pipe(
          Effect.flatMap((run) => run(input)),
          Effect.result,
          Effect.map((result) => {
            assert(Result.isFailure(result));
            return result.failure;
          }),
        );

      expect((yield* invoke('process.stdout.write("123456")')).reason).toContain(
        "stdout exceeded 5 bytes",
      );
      expect((yield* invoke('process.stderr.write("123456")')).reason).toContain(
        "stderr exceeded 5 bytes",
      );
      expect((yield* invoke('process.stdout.write("ééé")')).reason).toContain(
        "stdout exceeded 5 bytes",
      );
      expect(
        (yield* invoke('process.stdout.write("not-json")', { maxStdoutBytes: 64 })).reason,
      ).toContain("process invocation failed");
      expect(
        (yield* invoke('process.stderr.write("nope"); process.exit(7)', {
          maxStderrBytes: 64,
        })).reason,
      ).toContain("exited with 7: nope");
      expect(
        (yield* invoke("setTimeout(() => undefined, 1000)", { timeoutMillis: 20 })).reason,
      ).toContain("process invocation failed");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
