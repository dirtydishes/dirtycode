import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  ProgramEffect,
  ProgramId,
  ProgramProjection,
  ProgramRequestId,
  RuntimeReceipt,
} from "./index.ts";

const decodeProjection = Schema.decodeUnknownSync(ProgramProjection);
const decodeEffect = Schema.decodeUnknownSync(ProgramEffect);
const decodeReceipt = Schema.decodeUnknownSync(RuntimeReceipt);

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
      allowedCommands: ["pause", "stop"],
      phases: [
        {
          phaseId: "phase:slice-1",
          title: "Fake Phase",
          state: "running",
          dependencyIds: [],
          activeAttemptId: "attempt:slice-1",
          phaseCoordinatorTargetThreadId: "thread:phase-coordinator",
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

  it("keeps T3 effects closed and excludes dirtyloops-owned operations", () => {
    const effect = decodeEffect({
      kind: "launch_phase_coordinator",
      effectId: "effect:launch-phase",
      identity: {
        programId: "program:slice-1",
        phaseId: "phase:slice-1",
        programCoordinatorThreadId: "thread:program-owner",
        phaseCoordinatorThreadId: "thread:phase-coordinator",
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
