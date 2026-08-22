import { describe, expect, it } from "@effect/vitest";
import { ProgramRequestId, type ProgramProjection, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { ProgramWorkspace } from "./ProgramWorkspace";

const projection: ProgramProjection = {
  programId: "program:ui-proof" as ProgramProjection["programId"],
  revision: 4,
  title: "UI proof Program",
  outcome: "Show exact runtime identities.",
  state: "running",
  terminal: false,
  attentionReason: null,
  certificationFailures: [],
  allowedCommands: ["pause", "stop"],
  sourceIdentity: null,
  repositorySnapshot: null,
  beadsRevision: null,
  graphDigest: null,
  phases: [
    {
      phaseId: "phase:arbitrary" as ProgramProjection["phases"][number]["phaseId"],
      title: "Arbitrary Phase",
      state: "running",
      beadsStatus: null,
      dependencyIds: [],
      blockedBy: [],
      blockerPath: [],
      budgets: null,
      policy: null,
      activeAttemptId:
        "attempt:implementation-fixture" as ProgramProjection["attempts"][number]["attemptId"],
      phaseCoordinatorTargetThreadId:
        "thread:phase-target" as ProgramProjection["threadBindings"][number]["threadId"],
      projectId: "project:program-runtime" as ProgramProjection["phases"][number]["projectId"],
      threadTitle: "UI proof phase coordinator",
      modelSelection: {
        instanceId: "codex" as ProgramProjection["phases"][number]["modelSelection"]["instanceId"],
        model: "gpt-5.6-sol",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "feat/program-runtime-shell",
      worktreePath: "/home/delta/dev/dirtycode",
      phaseCoordinatorThreadId:
        "thread:phase-coordinator" as ProgramProjection["threadBindings"][number]["threadId"],
      ownerThreadId: null,
      preparedWorktree: null,
      lastLeaseEpoch: 0,
      leaseHeartbeatAt: null,
      receiptIds: [],
    },
  ],
  attempts: [
    {
      attemptId:
        "attempt:implementation-fixture" as ProgramProjection["attempts"][number]["attemptId"],
      phaseId: "phase:arbitrary" as ProgramProjection["phases"][number]["phaseId"],
      ownerKind: "implementation",
      state: "launch_pending",
      threadId: null,
      terminalKind: null,
      ownerResultId: null,
      resultDigest: null,
    },
  ],
  receipts: [],
  threadBindings: [],
  statusRail: [{ stage: "execute", state: "active", receiptId: null }],
  activity: [],
  activeAgentCount: 1,
  goalCapability: {
    available: false,
    adapter: "unsupported",
    reason: "Goal adapter failed certification.",
  },
  lastEventAt: "2026-08-22T12:00:00.000Z",
};

describe("ProgramWorkspace", () => {
  it("renders distinct coordinator and owner identities with stable command feedback", () => {
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        projection={projection}
        commandPending="pause"
        commandFeedback={{
          status: "rejected",
          code: "invalid_state",
          message: "pause is not allowed",
        }}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).not.toContain("<main");
    expect(html).toContain("thread:phase-coordinator");
    expect(html).toContain("No owner thread is bound.");
    expect(html).toContain("attempt:implementation-fixture");
    expect(html).toContain("invalid_state");
    expect(html).toContain("Goal adapter failed certification.");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("pause command in progress");
  });

  it("keeps the last projection visible while disclosing stale transport", () => {
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        projection={projection}
        commandPending={null}
        commandFeedback={null}
        transportState="stale"
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain("Live updates are disconnected");
    expect(html).toContain("UI proof Program");
    expect(html).toContain('role="status"');
  });

  it("renders prepared worktree and lease recovery identity for a mutable Phase", () => {
    const phase = projection.phases[0]!;
    const mutableProjection: ProgramProjection = {
      ...projection,
      phases: [
        {
          ...phase,
          ownerThreadId: ThreadId.make("thread:implementation-owner"),
          preparedWorktree: {
            programId: projection.programId,
            requestId: ProgramRequestId.make("request:bind-owner"),
            phaseId: phase.phaseId,
            phaseCoordinatorThreadId: phase.phaseCoordinatorThreadId!,
            ownerThreadId: ThreadId.make("thread:implementation-owner"),
            projectId: phase.projectId,
            ownerThreadTitle: "Slice 3 implementation owner",
            modelSelection: phase.modelSelection,
            runtimeMode: phase.runtimeMode,
            interactionMode: phase.interactionMode,
            leaseId: "lease:phase:arbitrary:7",
            leaseEpoch: 7,
            repositoryIdentity: "dirtydishes/dirtycode",
            repositoryRoot: "/home/delta/dev/dirtycode",
            gitCommonDir: "/home/delta/dev/dirtycode/.git",
            realPath: "/home/delta/dev/dirtycode-dirtyloops-worktrees/program/phase",
            expectedIntegrationHead: "a".repeat(40),
            integrationRef: "refs/heads/main",
            budgetIdentity:
              "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
            symbolicBranch: "dirtyloops/program/phase/attempt-1",
            startingCommit: "a".repeat(40),
            clean: true,
            declaredPaths: ["apps/server", "packages/contracts"],
            expiresAt: "2026-08-22T13:30:00.000Z",
          },
          lastLeaseEpoch: 7,
          leaseHeartbeatAt: "2026-08-22T13:10:00.000Z",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        projection={mutableProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Prepared worktree for Arbitrary Phase"');
    expect(html).toContain("/home/delta/dev/dirtycode-dirtyloops-worktrees/program/phase");
    expect(html).toContain("dirtyloops/program/phase/attempt-1");
    expect(html).toContain("Lease epoch 7");
    expect(html).toContain('dateTime="2026-08-22T13:10:00.000Z"');
    expect(html).toContain('dateTime="2026-08-22T13:30:00.000Z"');
    expect(html).toContain("Expired");
    expect(html).toContain('aria-label="Lease status: Expired"');
    expect(html).toContain("Worktree details");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("aaaaaaaaaaaa");
  });

  it("shows canonical blockers, budgets, and source parity for a read-only attachment", () => {
    const readOnlyProjection: ProgramProjection = {
      ...projection,
      sourceIdentity: {
        sourceCommit: "a".repeat(40),
        sourceDigest: `sha256:${"b".repeat(64)}`,
        installedDigest: `sha256:${"b".repeat(64)}`,
        schemaGeneration: `sha256:${"c".repeat(64)}`,
        adapterDigest: `sha256:${"d".repeat(64)}`,
        generationId: `dirtyloops:${"b".repeat(64)}`,
        parity: "current",
      },
      repositorySnapshot: {
        repositoryId: "dirtydishes/agents",
        head: "e".repeat(40),
        gitCommonDir: "/repo/.git",
        symbolicRef: "refs/heads/main",
        integrationRef: "refs/heads/main",
      },
      beadsRevision: `sha256:${"f".repeat(64)}`,
      graphDigest: `sha256:${"1".repeat(64)}`,
      phases: [
        {
          ...projection.phases[0]!,
          state: "blocked",
          beadsStatus: "open",
          dependencyIds: ["agents-0ur.3" as ProgramProjection["phases"][number]["phaseId"]],
          blockedBy: ["agents-0ur.3" as ProgramProjection["phases"][number]["phaseId"]],
          blockerPath: [
            "agents-0ur.4" as ProgramProjection["phases"][number]["phaseId"],
            "agents-0ur.3" as ProgramProjection["phases"][number]["phaseId"],
          ],
          budgets: {
            attempts: { used: 0, limit: 3 },
            wallClockMinutes: { used: 0, limit: 60 },
            tokens: { used: 0, limit: 120000 },
          },
        },
      ],
      attempts: [],
      activeAgentCount: 0,
    };
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        projection={readOnlyProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain("Source parity");
    expect(html).toContain("Current");
    expect(html).toContain("dirtydishes/agents");
    expect(html).toContain("Depends on agents-0ur.3");
    expect(html).toContain("Blocked by agents-0ur.3");
    expect(html).toContain("text-warning-foreground");
    expect(html).toContain("Blocker path");
    expect(html).toContain("agents-0ur.4 to agents-0ur.3");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Integration ref");
    expect(html).toContain("Symbolic ref");
    expect(html).toContain("Observed HEAD");
    expect(html).toContain("e".repeat(40));
    expect(html).toContain("Attempts 0 / 3");
    expect(html).toContain("Time 0 / 60 min");
    expect(html).toContain("Tokens 0 / 120,000");
    expect(html).toContain("No owner attempt is retained.");

    const unblockedProjection: ProgramProjection = {
      ...readOnlyProjection,
      phases: [
        {
          ...readOnlyProjection.phases[0]!,
          state: "ready",
          blockedBy: [],
          blockerPath: [],
        },
      ],
    };
    for (const current of [unblockedProjection, readOnlyProjection, unblockedProjection]) {
      const transitionHtml = renderToStaticMarkup(
        <ProgramWorkspace
          projection={current}
          commandPending={null}
          commandFeedback={null}
          transportState={null}
          onCommand={() => undefined}
        />,
      );
      expect(transitionHtml).toContain('aria-label="Blocker status for Arbitrary Phase"');
      expect(transitionHtml).toContain('aria-live="polite"');
    }
    const unblockedHtml = renderToStaticMarkup(
      <ProgramWorkspace
        projection={unblockedProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );
    expect(unblockedHtml).toContain("No blockers.");
    expect(unblockedHtml).not.toContain("Blocked by agents-0ur.3");

    const staleHtml = renderToStaticMarkup(
      <ProgramWorkspace
        projection={{
          ...readOnlyProjection,
          state: "attention_required",
          attentionReason: "installed dirtyloops skill does not match source",
          sourceIdentity: { ...readOnlyProjection.sourceIdentity!, parity: "stale" },
        }}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );
    expect(staleHtml).toContain('role="alert"');
    expect(staleHtml).toContain("Mutable work is blocked until parity is restored.");
  });
});
