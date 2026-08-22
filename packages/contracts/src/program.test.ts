import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  DirtyloopsReadOnlyDecision,
  ProgramEffect,
  ProgramId,
  ProgramProjection,
  ProgramRequestId,
  RuntimeReceipt,
} from "./index.ts";

const decodeProjection = Schema.decodeUnknownSync(ProgramProjection);
const decodeEffect = Schema.decodeUnknownSync(ProgramEffect);
const decodeReceipt = Schema.decodeUnknownSync(RuntimeReceipt);
const decodeDirtyloopsDecision = Schema.decodeUnknownSync(DirtyloopsReadOnlyDecision);

describe("Program contracts", () => {
  it("decodes one projection with stable Program, Phase, Attempt, and receipt identities", () => {
    const projection = decodeProjection({
      programId: "program:slice-1",
      revision: 3,
      title: "Recoverable Program shell",
      outcome: "Prove restart recovery without claiming admission.",
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
          phaseId: "phase:slice-1",
          title: "Fake Phase",
          state: "running",
          beadsStatus: null,
          dependencyIds: [],
          blockedBy: [],
          blockerPath: [],
          budgets: null,
          policy: null,
          activeAttemptId: "attempt:slice-1",
          phaseCoordinatorTargetThreadId: "thread:phase-coordinator",
          projectId: "project:program-runtime",
          threadTitle: "Slice 1 phase coordinator",
          modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "feat/program-runtime-shell",
          worktreePath: "/home/delta/dev/dirtycode",
          phaseCoordinatorThreadId: "thread:phase-coordinator",
          ownerThreadId: "thread:implementation-owner",
          receiptIds: ["receipt:launch-phase"],
        },
      ],
      attempts: [
        {
          attemptId: "attempt:slice-1",
          phaseId: "phase:slice-1",
          ownerKind: "implementation",
          state: "running",
          threadId: "thread:implementation-owner",
          terminalKind: null,
        },
      ],
      receipts: [
        {
          receiptId: "receipt:launch-phase",
          programId: "program:slice-1",
          programRevision: 2,
          effectId: "effect:launch-phase",
          requestId: "request:start",
          kind: "launch_phase_coordinator",
          status: "succeeded",
          resultDigest: "sha256:launch-phase",
          evidence: [],
          createdAt: "2026-08-22T12:00:00.000Z",
          acknowledged: false,
          identity: {
            programId: "program:slice-1",
            phaseId: "phase:slice-1",
            programCoordinatorThreadId: "thread:program-owner",
            phaseCoordinatorThreadId: "thread:phase-coordinator",
            projectId: "project:program-runtime",
            threadTitle: "Slice 1 phase coordinator",
            modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: "feat/program-runtime-shell",
            worktreePath: "/home/delta/dev/dirtycode",
            requestId: "request:start",
          },
          result: { phaseCoordinatorThreadId: "thread:phase-coordinator" },
        },
      ],
      threadBindings: [
        {
          threadId: "thread:program-owner",
          role: "program_coordinator",
          phaseId: null,
          attemptId: null,
        },
        {
          threadId: "thread:phase-coordinator",
          role: "phase_coordinator",
          phaseId: "phase:slice-1",
          attemptId: null,
        },
      ],
      statusRail: [
        { stage: "plan", state: "settled", receiptId: null },
        { stage: "execute", state: "active", receiptId: "receipt:launch-phase" },
      ],
      activity: [
        {
          eventId: "program-event:receipt",
          kind: "receipt_recorded",
          message: "Phase coordinator launch completed.",
          receiptId: "receipt:launch-phase",
          occurredAt: "2026-08-22T12:00:00.000Z",
        },
      ],
      activeAgentCount: 1,
      goalCapability: {
        available: false,
        adapter: "unsupported",
        reason: "Codex Goal is not certified.",
      },
      lastEventAt: "2026-08-22T12:00:00.000Z",
    });

    expect(projection.programId).toBe(ProgramId.make("program:slice-1"));
    expect(projection.phases[0]?.activeAttemptId).toBe("attempt:slice-1");
    expect(projection.receipts[0]?.receiptId).toBe("receipt:launch-phase");
  });

  it("decodes the typed read-only dirtyloops graph crossing the process boundary", () => {
    const decision = decodeDirtyloopsDecision({
      schemaVersion: 1,
      kind: "wait",
      decisionCode: "readonly_snapshot",
      certificationFailures: [],
      programRevision: 4,
      programState: "running",
      operatorDecision: {
        status: "accepted",
        code: "accepted",
        message: "Program wake completed.",
      },
      reason: "Canonical graph compiled.",
      wakeConditions: ["beads_changed", "operator_intent"],
      graph: {
        programId: "agents-0ur",
        title: "Dirtyloops 3.0",
        outcome: "Implement the accepted Program.",
        beadsRevision: `sha256:${"a".repeat(64)}`,
        graphDigest: `sha256:${"b".repeat(64)}`,
        phases: [
          {
            phaseId: "agents-0ur.4",
            title: "Mutable Phase",
            beadsStatus: "open",
            state: "blocked",
            dependencyIds: ["agents-0ur.3"],
            blockedBy: ["agents-0ur.3"],
            blockerPath: ["agents-0ur.4", "agents-0ur.3"],
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
          sourceCommit: "c".repeat(40),
          sourceDigest: `sha256:${"d".repeat(64)}`,
          installedDigest: `sha256:${"d".repeat(64)}`,
          schemaGeneration: `sha256:${"e".repeat(64)}`,
          adapterDigest: `sha256:${"f".repeat(64)}`,
          generationId: `dirtyloops:${"d".repeat(64)}`,
          parity: "current",
        },
        repository: {
          repositoryId: "dirtydishes/agents",
          head: "1".repeat(40),
          gitCommonDir: "/repo/.git",
          symbolicRef: "refs/heads/main",
          integrationRef: "refs/heads/main",
        },
        receipts: [],
        observedAt: "2026-08-22T12:00:00.000Z",
      },
    });

    expect(decision.graph.phases[0]?.blockerPath).toEqual(["agents-0ur.4", "agents-0ur.3"]);
    expect(decision.graph.sourceIdentity.parity).toBe("current");
    expect(() =>
      decodeDirtyloopsDecision({
        ...decision,
        graph: {
          ...decision.graph,
          sourceIdentity: { ...decision.graph.sourceIdentity, sourceDigest: "not-a-digest" },
        },
      }),
    ).toThrow();
  });

  it("keeps T3 effects closed and excludes dirtyloops-owned operations", () => {
    const effect = decodeEffect({
      kind: "launch_phase_coordinator",
      effectId: "effect:launch-phase",
      identity: {
        programId: "program:slice-1",
        phaseId: "phase:slice-1",
        programCoordinatorThreadId: "thread:program-owner",
        phaseCoordinatorThreadId: "thread:phase-coordinator",
        projectId: "project:program-runtime",
        threadTitle: "Slice 1 phase coordinator",
        modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "feat/program-runtime-shell",
        worktreePath: "/home/delta/dev/dirtycode",
        requestId: "request:start",
      },
    });

    expect(effect.kind).toBe("launch_phase_coordinator");
    expect(() =>
      decodeEffect({
        kind: "run_admission",
        effectId: "effect:forbidden",
        identity: {},
      }),
    ).toThrow();
  });

  it("requires the result and identity that belong to the receipt kind", () => {
    const receipt = decodeReceipt({
      receiptId: "receipt:goal",
      programId: "program:slice-1",
      programRevision: 4,
      effectId: "effect:goal",
      requestId: "request:goal",
      kind: "update_goal",
      status: "succeeded",
      resultDigest: "sha256:goal",
      evidence: [],
      createdAt: "2026-08-22T12:00:00.000Z",
      acknowledged: false,
      identity: {
        programId: "program:slice-1",
        goalThreadId: "thread:program-owner",
        codexThreadId: "codex-thread:program-owner",
        adapterGeneration: "unsupported:v1",
        requestId: ProgramRequestId.make("request:goal"),
      },
      result: {
        goalThreadId: "thread:program-owner",
        goalRevision: "goal-revision:1",
      },
    });

    expect(receipt.kind).toBe("update_goal");
    expect(() =>
      decodeReceipt({
        ...receipt,
        result: { phaseCoordinatorThreadId: "thread:wrong-result" },
      }),
    ).toThrow();
  });
});
