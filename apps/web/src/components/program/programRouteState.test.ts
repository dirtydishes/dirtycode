import { describe, expect, it } from "@effect/vitest";
import type { ProgramProjection } from "@t3tools/contracts";

import { newestProgramProjection, programTransportState } from "./programRouteState.ts";

const projection = (revision: number, state: ProgramProjection["state"]) =>
  ({ revision, state }) as ProgramProjection;

describe("Program route state", () => {
  it("uses a newer live revision even when an older command result is retained", () => {
    const detail = projection(1, "running");
    const command = projection(2, "paused");
    const live = projection(3, "running");

    expect(newestProgramProjection(detail, live, command)).toBe(live);
  });

  it("reports initial sync, stream failure, and successful reconnect", () => {
    expect(programTransportState({ connectionPhase: "connecting", synchronized: false })).toBe(
      "synchronizing",
    );
    expect(programTransportState({ connectionPhase: "backoff", synchronized: true })).toBe("stale");
    expect(programTransportState({ connectionPhase: "connected", synchronized: false })).toBe(
      "synchronizing",
    );
    expect(programTransportState({ connectionPhase: "connected", synchronized: true })).toBeNull();
  });
});
