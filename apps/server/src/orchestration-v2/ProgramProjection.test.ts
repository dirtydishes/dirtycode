import { describe, expect, it } from "@effect/vitest";
import {
  ProgramEventId,
  ProgramId,
  ProgramPhaseId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ProgramEvent,
  type StartProgramInput,
} from "@t3tools/contracts";

import { makeInitialProgramProjection, replayProgramProjection } from "./ProgramProjection.ts";

const programId = ProgramId.make("program:deliberation-proof");
const phaseId = ProgramPhaseId.make("phase:deliberation-proof");
const requestId = ProgramRequestId.make("request:deliberation-proof");

const startInput = {
  requestId,
  attachment: {
    programId,
    repositoryId: "dirtydishes/dirtycode",
    integrationRef: "refs/heads/feat/program-runtime-shell",
    programCoordinatorThreadId: ThreadId.make("thread:program:deliberation-proof"),
    integrationCoordinatorThreadId: ThreadId.make("thread:integration:deliberation-proof"),
    dirtyloopsGenerationId: `dirtyloops:${"1".repeat(64)}`,
    dirtyloopsAdapterDigest: `sha256:${"2".repeat(64)}`,
    t3EnvironmentId: "environment:deliberation-proof",
    createdAt: "2026-08-23T06:00:00.000Z",
  },
  title: "Deliberation proof",
  outcome: "Keep coordination evidence separate from Admission.",
  phases: [
    {
      phaseId,
      title: "Compare approaches",
      dependencyIds: [],
      phaseCoordinatorThreadId: ThreadId.make("thread:phase:deliberation-proof"),
      projectId: ProjectId.make("project:deliberation-proof"),
      threadTitle: "Deliberation Phase coordinator",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-sol",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "feat/program-runtime-shell",
      worktreePath: "/home/delta/dev/dirtycode",
    },
  ],
  attempts: [],
  driverKind: "dirtyloops",
} satisfies StartProgramInput;

describe("ProgramProjection", () => {
  it("does not invent Program budget policy before dirtyloops projects it", () => {
    const initial = makeInitialProgramProjection(startInput, {
      available: false,
      adapter: "unsupported",
      reason: "Goal adapter certification is incomplete.",
    });

    expect(initial.budgets).toBeUndefined();
  });

  it("replays structured deliberation without changing Admission authority", () => {
    const initial = makeInitialProgramProjection(startInput, {
      available: false,
      adapter: "unsupported",
      reason: "Goal adapter certification is incomplete.",
    });
    const started = {
      eventId: ProgramEventId.make("program-event:deliberation:start"),
      programId,
      sequence: 1,
      revision: 0,
      requestId,
      occurredAt: "2026-08-23T06:00:00.000Z",
      type: "program.started",
      payload: { attachment: startInput.attachment, projection: initial },
    } satisfies ProgramEvent;
    const deliberation = {
      eventId: ProgramEventId.make("program-event:deliberation:proposal"),
      programId,
      sequence: 2,
      revision: 1,
      requestId,
      occurredAt: "2026-08-23T06:01:00.000Z",
      type: "program.deliberation-recorded",
      payload: {
        deliberationId: "deliberation:phase:deliberation-proof",
        phaseId,
        question: "Which conflict-free schedule should this Phase use?",
        criteria: ["correctness", "recovery"],
        participantThreadIds: [ThreadId.make("thread:proposal:one")],
        kind: "approach_proposed",
        state: "proposing",
        approachId: "approach:one",
        authorThreadId: ThreadId.make("thread:proposal:one"),
        summary: "Schedule the read-only analysis before the mutation lease.",
        evidence: [{ kind: "thread", id: "thread:proposal:one" }],
      },
    } as unknown as ProgramEvent;

    const replayed = replayProgramProjection([started, deliberation]);

    expect((replayed as { deliberations?: unknown }).deliberations).toEqual([
      {
        deliberationId: "deliberation:phase:deliberation-proof",
        programId,
        phaseId,
        question: "Which conflict-free schedule should this Phase use?",
        criteria: ["correctness", "recovery"],
        participantThreadIds: [ThreadId.make("thread:proposal:one")],
        approachIds: ["approach:one"],
        state: "proposing",
        entries: [
          {
            eventId: "program-event:deliberation:proposal",
            kind: "approach_proposed",
            state: "proposing",
            approachId: "approach:one",
            authorThreadId: ThreadId.make("thread:proposal:one"),
            summary: "Schedule the read-only analysis before the mutation lease.",
            evidence: [{ kind: "thread", id: "thread:proposal:one" }],
            occurredAt: "2026-08-23T06:01:00.000Z",
          },
        ],
      },
    ]);
    expect(replayed.state).toBe(initial.state);
    expect(replayed.revision).toBe(1);
    expect(replayed.allowedCommands).toEqual(initial.allowedCommands);
    expect(replayed.statusRail).toEqual(initial.statusRail);
  });
});
