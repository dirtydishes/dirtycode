import { describe, expect, it } from "@effect/vitest";
import type { ProgramProjection } from "@t3tools/contracts";
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
  allowedCommands: ["pause", "stop"],
  phases: [
    {
      phaseId: "phase:arbitrary" as ProgramProjection["phases"][number]["phaseId"],
      title: "Arbitrary Phase",
      state: "running",
      dependencyIds: [],
      activeAttemptId:
        "attempt:implementation-fixture" as ProgramProjection["attempts"][number]["attemptId"],
      phaseCoordinatorTargetThreadId:
        "thread:phase-target" as ProgramProjection["threadBindings"][number]["threadId"],
      phaseCoordinatorThreadId:
        "thread:phase-coordinator" as ProgramProjection["threadBindings"][number]["threadId"],
      ownerThreadId: null,
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
});
