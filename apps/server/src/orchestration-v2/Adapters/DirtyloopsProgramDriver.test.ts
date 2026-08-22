import { describe, expect, it } from "@effect/vitest";
import {
  ProgramId,
  ProgramPhaseId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type DirtyloopsReadOnlyDecision,
  type ProgramProjection,
  type ReconcileProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makeDeterministicProgramDriver } from "./DeterministicProgramDriver.ts";
import { makeDirtyloopsReadOnlyProgramDriver } from "./DirtyloopsProgramDriver.ts";

const phaseId = ProgramPhaseId.make("agents-0ur.4");
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
    activeAgentCount: 0,
    goalCapability: { available: false, adapter: "unsupported", reason: "Not certified." },
    lastEventAt: "2026-08-22T12:00:00.000Z",
  },
  wakeCause: "manual",
  operatorIntent: null,
  occurredAt: "2026-08-22T12:05:00.000Z",
  receipts: [],
} satisfies ReconcileProgramInput;

const raw = {
  schemaVersion: 1,
  kind: "wait",
  decisionCode: "readonly_snapshot",
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
      sourceDigest: `sha256:${"f".repeat(64)}`,
      installedDigest: `sha256:${"f".repeat(64)}`,
      schemaGeneration: `sha256:${"1".repeat(64)}`,
      adapterDigest: `sha256:${"2".repeat(64)}`,
      generationId: `dirtyloops:${"f".repeat(64)}`,
      parity: "current",
    },
    repository: {
      repositoryId: "dirtydishes/agents",
      head: "3".repeat(40),
      gitCommonDir: "/repo/.git",
      symbolicRef: "refs/heads/main",
    },
    receipts: [],
    observedAt: "2026-08-22T12:05:00.000Z",
  },
} satisfies DirtyloopsReadOnlyDecision;

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
  it.effect("maps a validated canonical graph without proposing a T3 effect", () =>
    Effect.gen(function* () {
      const driver = makeDirtyloopsReadOnlyProgramDriver({
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
            receiptIds: [],
          },
        ],
      };
      const fake = yield* makeDeterministicProgramDriver().reconcile({
        ...input,
        observedProjection: fixtureProjection,
      });
      const real = yield* makeDirtyloopsReadOnlyProgramDriver({
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
});
