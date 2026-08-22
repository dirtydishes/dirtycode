import { describe, expect, it } from "@effect/vitest";
import { ProgramId, type ProgramStreamItem, type ProgramSummary } from "@t3tools/contracts";

import { applyProgramStreamItem, EMPTY_PROGRAM_CLIENT_STATE } from "./programs.ts";

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

const stream = [
  { kind: "snapshot", snapshot: { schemaVersion: 1, programs: [initial] } },
  { kind: "synchronized" },
  {
    kind: "program.updated",
    program: { ...initial, state: "paused", activeAgentCount: 0 },
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
      program: initial,
    });
    const replaced = applyProgramStreamItem(stale, {
      kind: "snapshot",
      snapshot: { schemaVersion: 1, programs: [] },
    });
    const restored = applyProgramStreamItem(replaced, {
      kind: "program.updated",
      program: initial,
    });
    const removed = applyProgramStreamItem(restored, {
      kind: "program.removed",
      programId,
    });

    expect(replaced.programs.size).toBe(0);
    expect(removed.programs.size).toBe(0);
  });
});
