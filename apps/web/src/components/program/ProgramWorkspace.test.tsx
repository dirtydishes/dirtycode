import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProgramEventId,
  ProgramRequestId,
  type ProgramProjection,
  ThreadId,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: (props: {
      readonly children: ReactNode;
      readonly className?: string;
      readonly params: { readonly environmentId: string; readonly threadId: string };
    }) => (
      <a
        className={props.className}
        href={`/${props.params.environmentId}/${props.params.threadId}`}
      >
        {props.children}
      </a>
    ),
  };
});

import { ProgramWorkspace } from "./ProgramWorkspace";
import { ProgramEvaluationComparison } from "./ProgramWorkspacePanels";

const testEnvironmentId = EnvironmentId.make("environment:program-ui");

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
        environmentId={testEnvironmentId}
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
    expect(html).toContain("Pausing Program…");
  });

  it("keeps the last projection visible while disclosing stale transport", () => {
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
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

  it("shows the integration coordinator, review evidence, and Admission stop accessibly", () => {
    const evidenceProjection: ProgramProjection = {
      ...projection,
      state: "attention_required",
      attentionReason:
        "dirtyloops Admission blocked: integration head moved (integration_head_moved).",
      allowedCommands: ["resume", "stop", "request_replan"],
      threadBindings: [
        {
          threadId: ThreadId.make("thread:integration-coordinator-visible"),
          role: "integration_coordinator",
          phaseId: null,
          attemptId: null,
        },
      ],
      receipts: [
        {
          receiptId: "receipt:review-evidence",
          kind: "acknowledge_owner_result",
          acknowledged: true,
          evidence: [
            {
              kind: "check",
              id: "ci:program:green",
              label: "CI gate",
              href: "https://ci.example.invalid/runs/program-green",
            },
            {
              kind: "commit",
              id: "a".repeat(40),
              label: "Reviewed candidate",
            },
          ],
        } as unknown as ProgramProjection["receipts"][number],
      ],
    };
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
        projection={evidenceProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("integration_head_moved");
    expect(html).toContain("Integration coordinator");
    expect(html).toContain("thread:integration-coordinator-visible");
    expect(html).toContain("CI gate");
    expect(html).toContain("ci:program:green");
    expect(html).toContain('href="https://ci.example.invalid/runs/program-green"');
    expect(html).toContain("Reviewed candidate");
  });

  it("routes known thread identities through the current T3 environment", () => {
    const environmentId = EnvironmentId.make("environment:program-ui");
    const integrationThreadId = ThreadId.make("thread:integration-coordinator-link");
    const evidenceThreadId = ThreadId.make("thread:review-evidence-link");
    const linkedProjection: ProgramProjection = {
      ...projection,
      threadBindings: [
        {
          threadId: integrationThreadId,
          role: "integration_coordinator",
          phaseId: null,
          attemptId: null,
        },
      ],
      receipts: [
        {
          receiptId: "receipt:thread-link-evidence",
          kind: "acknowledge_owner_result",
          acknowledged: true,
          evidence: [{ kind: "thread", id: evidenceThreadId, label: "Review thread" }],
        } as unknown as ProgramProjection["receipts"][number],
      ],
    };
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
        projection={linkedProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain(`href="/${environmentId}/${integrationThreadId}"`);
    expect(html).toContain(`href="/${environmentId}/${evidenceThreadId}"`);
  });

  it("does not turn a protocol-relative evidence target into a link", () => {
    const evidenceProjection: ProgramProjection = {
      ...projection,
      receipts: [
        {
          receiptId: "receipt:unsafe-evidence-target",
          kind: "acknowledge_owner_result",
          acknowledged: true,
          evidence: [
            {
              kind: "check",
              id: "ci:program:unsafe-target",
              label: "CI gate",
              href: "//attacker.example.invalid/evidence",
            },
          ],
        } as unknown as ProgramProjection["receipts"][number],
      ],
    };
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
        projection={evidenceProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain("ci:program:unsafe-target");
    expect(html).not.toContain('href="//attacker.example.invalid/evidence"');
  });

  it("distinguishes internal and external evidence controls", () => {
    const evidenceProjection: ProgramProjection = {
      ...projection,
      receipts: [
        {
          receiptId: "receipt:evidence-link-treatments",
          kind: "acknowledge_owner_result",
          acknowledged: true,
          evidence: [
            {
              kind: "check",
              id: "check:local",
              label: "Local evidence",
              href: "/evidence/local",
            },
            {
              kind: "check",
              id: "check:external",
              label: "External evidence",
              href: "https://ci.example.invalid/evidence/external",
            },
          ],
        } as unknown as ProgramProjection["receipts"][number],
      ],
    };
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
        projection={evidenceProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );
    const internal = html.match(/<a[^>]*href="\/evidence\/local"[^>]*>/)?.[0] ?? "";
    const external =
      html.match(/<a[^>]*href="https:\/\/ci\.example\.invalid\/evidence\/external"[^>]*>/)?.[0] ??
      "";

    expect(internal).not.toBe("");
    expect(internal).not.toContain('target="_blank"');
    expect(internal).toContain("pointer-coarse:min-h-11");
    expect(external).toContain('target="_blank"');
    expect(external).toContain("pointer-coarse:min-h-11");
    expect(html).toContain("lucide-external-link");
    expect(html).toContain("opens in a new tab");
  });

  it("offers the allowed Request replan command in an attention state", () => {
    const attentionProjection: ProgramProjection = {
      ...projection,
      state: "attention_required",
      attentionReason: "The integration head moved.",
      allowedCommands: ["resume", "request_replan", "stop"],
    };
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
        projection={attentionProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain("Request replan");
  });

  it("announces a pending replan in product language", () => {
    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
        projection={projection}
        commandPending="request_replan"
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain("Requesting a replan…");
    expect(html).not.toContain("request_replan");
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
        environmentId={testEnvironmentId}
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
        environmentId={testEnvironmentId}
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
          environmentId={testEnvironmentId}
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
        environmentId={testEnvironmentId}
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
        environmentId={testEnvironmentId}
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

  it("renders bounded topology, team, deliberation, and Program budget evidence", () => {
    const largeProjection: ProgramProjection = {
      ...projection,
      phases: Array.from({ length: 200 }, (_, index) => ({
        ...projection.phases[0]!,
        phaseId: `phase:${index}` as ProgramProjection["phases"][number]["phaseId"],
        title: `Phase ${index}`,
      })),
      attempts: Array.from({ length: 50 }, (_, index) => ({
        ...projection.attempts[0]!,
        attemptId: `attempt:${index}` as ProgramProjection["attempts"][number]["attemptId"],
        teamPolicy:
          index === 0
            ? {
                mode: "layered_hybrid" as const,
                maxHelpers: 4,
                maxConcurrent: 2,
                maxDepth: 1,
                maxRounds: 3,
                criteria: ["accepted tests pass"],
              }
            : { mode: "solo" as const },
      })),
      receipts: Array.from(
        { length: 3_000 },
        (_, index) =>
          ({
            receiptId: `receipt:${index}`,
            kind: "launch_owner_attempt",
            acknowledged: index < 2_990,
            evidence: [],
          }) as unknown as ProgramProjection["receipts"][number],
      ),
      activity: Array.from(
        { length: 120 },
        (_, index) =>
          ({
            eventId: `activity:${index}`,
            message: `Activity ${index}`,
            occurredAt: "2026-08-22T12:00:00.000Z",
          }) as ProgramProjection["activity"][number],
      ),
      deliberations: [
        {
          deliberationId: "deliberation:partition",
          programId: projection.programId,
          phaseId: projection.phases[0]!.phaseId,
          question: "How should we partition work?",
          criteria: ["accepted tests pass"],
          participantThreadIds: [ThreadId.make("thread:proposal")],
          approachIds: ["approach:conflict-safe"],
          state: "decided",
          entries: [
            {
              eventId: ProgramEventId.make("program-event:deliberation-decision"),
              kind: "synthesis_recorded",
              state: "decided",
              approachId: "approach:conflict-safe",
              authorThreadId: ThreadId.make("thread:proposal"),
              summary: "Use declared-path conflict checks.",
              evidence: [],
              occurredAt: "2026-08-22T12:00:00.000Z",
            },
          ],
        },
      ],
      budgets: {
        activeThreads: { used: 5, limit: 16 },
        nativeHelpers: { used: 4, limit: 8 },
        helperDepth: { used: 1, limit: 1 },
        providerTurns: { used: 18, limit: 200 },
        tokens: { used: 80_000, limit: 1_000_000 },
        costMilliUsd: { used: 2_500, limit: 100_000 },
        wallClockMinutes: { used: 42, limit: 480 },
        actions: { used: 12, limit: 1_000 },
        concurrentWorktrees: { used: 2, limit: 2 },
        cpuMillis: { used: 100, limit: 3_600_000 },
        memoryMiB: { used: 1_024, limit: 16_384 },
        diskMiB: { used: 200, limit: 102_400 },
        repairs: { used: 0, limit: 1 },
        retries: { used: 1, limit: 6 },
        exhausted: [],
        dispatchAllowed: true,
      },
    };

    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
        projection={largeProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain("Showing phases 1–50 of 200");
    expect(html).toContain(">Phase 0<");
    expect(html).toContain(">Phase 49<");
    expect(html).not.toContain(">Phase 50<");
    expect(html).toContain("Showing owner attempts 1–20 of 50");
    expect(html).toContain('aria-label="Previous phases"');
    expect(html).toContain('aria-label="Next phases"');
    expect(html).toContain("Layered hybrid");
    expect(html).toContain("4 helpers");
    expect(html).toContain("How should we partition work?");
    expect(html).toContain("Decided");
    expect(html).toContain("Actions 12 / 1,000");
    expect(html).toContain("3,000 total");
  });

  it("compares every evaluation arm without ranking speed as a winner", () => {
    const arms = [
      "solo",
      "explicit_delegates",
      "native_collaborative",
      "t3_cross_provider",
      "layered_dirtyloops_t3",
    ] as const;
    const evaluationProjection: ProgramProjection = {
      ...projection,
      evaluations: arms.map((arm, index) => ({
        evaluationId: `evaluation:web:${arm}`,
        cohortId: "cohort:web",
        arm,
        fixedInputsDigest: `sha256:${"a".repeat(64)}`,
        repositoryId: "dirtydishes/dirtycode",
        startingCommit: "1".repeat(40),
        taskSetDigest: `sha256:${"b".repeat(64)}`,
        metrics: {
          tasks: 12,
          acceptedTasks: 7 + index,
          elapsedMillis: 90_000 - index * 10_000,
          activeComputeMillis: 60_000 + index * 2_000,
          tokens: 50_000 + index * 1_000,
          costMilliUsd: 2_000 + index * 100,
          reviewRejections: index,
          ciFailures: 0,
          duplicateEffects: index === 4 ? 1 : 0,
          staleEffects: 0,
          injectedCrashes: 1,
          successfulRecoveries: 1,
          operatorInterventions: index,
          postAdmissionDefects: index === 4 ? 1 : 0,
          integratedPhases: 4,
          readyWorkLatencyMillis: 1_500 - index * 100,
        },
        evidence: [],
      })),
    };

    const html = renderToStaticMarkup(
      <ProgramWorkspace
        environmentId={testEnvironmentId}
        projection={evaluationProjection}
        commandPending={null}
        commandFeedback={null}
        transportState={null}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Program evaluation comparison"');
    expect(html).toContain("Solo");
    expect(html).toContain("Explicit delegates");
    expect(html).toContain("Native collaborative");
    expect(html).toContain("T3 cross-provider");
    expect(html).toContain("Layered dirtyloops + T3");
    expect(html).toContain("7 / 12");
    expect(html).toContain("11 / 12");
    expect(html).toContain("1 duplicate effect");
    expect(html).toContain("1 post-Admission defect");
    expect(html).toContain("Speed alone does not rank these arms.");
    expect(html.toLowerCase()).not.toContain("winner");
  });

  it("keeps evaluation arms visible in a keyboard-scrollable comparison", () => {
    const html = renderToStaticMarkup(
      <ProgramEvaluationComparison
        evaluations={[
          {
            evaluationId: "evaluation:scroll-proof",
            cohortId: "cohort:scroll-proof",
            arm: "solo",
            fixedInputsDigest: `sha256:${"a".repeat(64)}`,
            repositoryId: "dirtydishes/dirtycode",
            startingCommit: "1".repeat(40),
            taskSetDigest: `sha256:${"b".repeat(64)}`,
            metrics: {
              tasks: 1,
              acceptedTasks: 1,
              elapsedMillis: 1_000,
              activeComputeMillis: 900,
              tokens: 100,
              costMilliUsd: 10,
              reviewRejections: 0,
              ciFailures: 0,
              duplicateEffects: 0,
              staleEffects: 0,
              injectedCrashes: 0,
              successfulRecoveries: 0,
              operatorInterventions: 0,
              postAdmissionDefects: 0,
              integratedPhases: 1,
              readyWorkLatencyMillis: 100,
            },
            evidence: [],
          },
        ]}
      />,
    );

    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-describedby="program-evaluations-scroll-hint"');
    expect(html).toContain("Scroll horizontally to compare all metrics");
    expect(html).toContain("sticky left-0");
  });
});
