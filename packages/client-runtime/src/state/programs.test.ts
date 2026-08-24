import { describe, expect, it } from "@effect/vitest";
import {
  ProgramId,
  type ProgramProjection,
  type ProgramStreamItem,
  type ProgramSummary,
} from "@t3tools/contracts";

import {
  applyProgramStreamItem,
  EMPTY_PROGRAM_CLIENT_STATE,
  selectProgramWorkspaceWindow,
} from "./programs.ts";

const programId = ProgramId.make("program:shared-client");
const initial = {
  programId,
  title: "Shared Program",
  state: "running",
  terminal: false,
  phaseCount: 1,
  activeAgentCount: 1,
  lastEventAt: "2026-08-22T12:00:00.000Z",
} satisfies ProgramSummary;

const projection = {
  programId,
  revision: 2,
  title: initial.title,
  outcome: "Keep deep identities on the live stream.",
  state: "paused",
  terminal: false,
  attentionReason: null,
  certificationFailures: [],
  allowedCommands: ["resume", "stop"],
  sourceIdentity: null,
  repositorySnapshot: null,
  beadsRevision: null,
  graphDigest: null,
  phases: [
    {
      phaseId: "phase:shared-client" as ProgramProjection["phases"][number]["phaseId"],
      title: "Shared phase",
      state: "running",
      beadsStatus: null,
      dependencyIds: [],
      blockedBy: [],
      blockerPath: [],
      budgets: null,
      policy: null,
      activeAttemptId:
        "attempt:shared-client" as ProgramProjection["attempts"][number]["attemptId"],
      phaseCoordinatorTargetThreadId:
        "thread:phase-target" as ProgramProjection["phases"][number]["phaseCoordinatorTargetThreadId"],
      projectId: "project:shared-client" as ProgramProjection["phases"][number]["projectId"],
      threadTitle: "Shared phase coordinator",
      modelSelection: {
        instanceId: "codex" as ProgramProjection["phases"][number]["modelSelection"]["instanceId"],
        model: "gpt-5.6-sol",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      phaseCoordinatorThreadId:
        "thread:phase-target" as ProgramProjection["phases"][number]["phaseCoordinatorThreadId"],
      ownerThreadId: null,
      preparedWorktree: null,
      lastLeaseEpoch: 0,
      leaseHeartbeatAt: null,
      receiptIds: [],
    },
  ],
  attempts: [
    {
      attemptId: "attempt:shared-client" as ProgramProjection["attempts"][number]["attemptId"],
      phaseId: "phase:shared-client" as ProgramProjection["attempts"][number]["phaseId"],
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
  statusRail: [],
  activity: [],
  activeAgentCount: 0,
  goalCapability: { available: false, adapter: "unsupported", reason: "Not certified." },
  lastEventAt: "2026-08-22T12:01:00.000Z",
} satisfies ProgramProjection;

const stream = [
  { kind: "snapshot", snapshot: { schemaVersion: 1, programs: [initial] } },
  { kind: "synchronized" },
  {
    kind: "program.updated",
    projection,
  },
] satisfies ReadonlyArray<ProgramStreamItem>;

describe("Program client projection", () => {
  it("gives two clients the same durable Program identity and latest state", () => {
    const project = () => stream.reduce(applyProgramStreamItem, EMPTY_PROGRAM_CLIENT_STATE);

    const firstClient = project();
    const secondClient = project();

    expect([...firstClient.programs.keys()]).toEqual([programId]);
    expect([...secondClient.programs.keys()]).toEqual([programId]);
    expect(firstClient.programs.get(programId)).toEqual(secondClient.programs.get(programId));
    expect(firstClient.projections.get(programId)).toEqual(secondClient.projections.get(programId));
    expect(firstClient.projections.get(programId)?.phases[0]?.phaseId).toBe("phase:shared-client");
    expect(firstClient.projections.get(programId)?.attempts[0]?.attemptId).toBe(
      "attempt:shared-client",
    );
    expect(firstClient.programs.get(programId)).toMatchObject({
      state: "paused",
      activeAgentCount: 0,
    });
    expect(firstClient.synchronized).toBe(true);
    expect(secondClient.synchronized).toBe(true);
  });

  it("replaces stale snapshots and removes terminally deleted Programs", () => {
    const stale = applyProgramStreamItem(EMPTY_PROGRAM_CLIENT_STATE, {
      kind: "program.updated",
      projection,
    });
    const replaced = applyProgramStreamItem(stale, {
      kind: "snapshot",
      snapshot: { schemaVersion: 1, programs: [] },
    });
    const restored = applyProgramStreamItem(replaced, {
      kind: "program.updated",
      projection,
    });
    const removed = applyProgramStreamItem(restored, {
      kind: "program.removed",
      programId,
    });

    expect(replaced.programs.size).toBe(0);
    expect(replaced.projections.size).toBe(0);
    expect(removed.programs.size).toBe(0);
    expect(removed.projections.size).toBe(0);
  });

  it("does not move backward when an older live projection arrives late", () => {
    const current = applyProgramStreamItem(EMPTY_PROGRAM_CLIENT_STATE, {
      kind: "program.updated",
      projection,
    });
    const stale = applyProgramStreamItem(current, {
      kind: "program.updated",
      projection: { ...projection, revision: projection.revision - 1, state: "running" },
    });

    expect(stale).toBe(current);
    expect(stale.projections.get(programId)?.revision).toBe(projection.revision);
    expect(stale.projections.get(programId)?.state).toBe("paused");
  });

  it("resets synchronization until a reconnect snapshot finishes", () => {
    const connected = stream.reduce(applyProgramStreamItem, EMPTY_PROGRAM_CLIENT_STATE);
    const reconnecting = applyProgramStreamItem(connected, {
      kind: "snapshot",
      snapshot: { schemaVersion: 1, programs: [initial] },
    });
    const updated = applyProgramStreamItem(reconnecting, {
      kind: "program.updated",
      projection: { ...projection, revision: projection.revision + 1 },
    });
    const synchronized = applyProgramStreamItem(updated, { kind: "synchronized" });

    expect(connected.synchronized).toBe(true);
    expect(reconnecting.synchronized).toBe(false);
    expect(updated.synchronized).toBe(false);
    expect(synchronized.synchronized).toBe(true);
  });

  it("bounds a large Program view without discarding durable state", () => {
    const largeProjection: ProgramProjection = {
      ...projection,
      phases: Array.from({ length: 200 }, (_, index) => ({
        ...projection.phases[0]!,
        phaseId: `phase:${index}` as ProgramProjection["phases"][number]["phaseId"],
      })),
      attempts: Array.from({ length: 50 }, (_, index) => ({
        ...projection.attempts[0]!,
        attemptId: `attempt:${index}` as ProgramProjection["attempts"][number]["attemptId"],
      })),
      receipts: Array.from(
        { length: 3_000 },
        (_, index) => ({ receiptId: `receipt:${index}` }) as ProgramProjection["receipts"][number],
      ),
      activity: Array.from(
        { length: 120 },
        (_, index) => ({ eventId: `activity:${index}` }) as ProgramProjection["activity"][number],
      ),
    };

    const view = selectProgramWorkspaceWindow(largeProjection, {
      phaseOffset: 190,
      phaseLimit: 20,
      attemptOffset: 0,
      attemptLimit: 50,
      receiptOffset: 2_990,
      receiptLimit: 25,
      activityOffset: 0,
      activityLimit: 12,
    });

    expect(view.phases.items.map((phase) => phase.phaseId)).toEqual([
      "phase:190",
      "phase:191",
      "phase:192",
      "phase:193",
      "phase:194",
      "phase:195",
      "phase:196",
      "phase:197",
      "phase:198",
      "phase:199",
    ]);
    expect(view.attempts.items).toHaveLength(20);
    expect(view.receipts.items.map((receipt) => receipt.receiptId)).toEqual([
      "receipt:2990",
      "receipt:2991",
      "receipt:2992",
      "receipt:2993",
      "receipt:2994",
      "receipt:2995",
      "receipt:2996",
      "receipt:2997",
      "receipt:2998",
      "receipt:2999",
    ]);
    expect(view.activity.items.map((item) => item.eventId)).toEqual([
      "activity:119",
      "activity:118",
      "activity:117",
      "activity:116",
      "activity:115",
      "activity:114",
      "activity:113",
      "activity:112",
      "activity:111",
      "activity:110",
      "activity:109",
      "activity:108",
    ]);
    expect({
      phases: view.phases.total,
      attempts: view.attempts.total,
      receipts: view.receipts.total,
      activity: view.activity.total,
    }).toEqual({ phases: 200, attempts: 50, receipts: 3_000, activity: 120 });
    expect({
      phases: largeProjection.phases.length,
      attempts: largeProjection.attempts.length,
      receipts: largeProjection.receipts.length,
      activity: largeProjection.activity.length,
    }).toEqual({ phases: 200, attempts: 50, receipts: 3_000, activity: 120 });
  });
});
