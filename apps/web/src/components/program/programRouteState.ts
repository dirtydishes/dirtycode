import type { ProgramProjection } from "@t3tools/contracts";

export type ProgramTransportState = "synchronizing" | "stale" | null;

export function newestProgramProjection(
  ...candidates: ReadonlyArray<ProgramProjection | null | undefined>
): ProgramProjection | null {
  return candidates.reduce<ProgramProjection | null>(
    (newest, candidate) =>
      candidate !== null &&
      candidate !== undefined &&
      (newest === null || candidate.revision >= newest.revision)
        ? candidate
        : newest,
    null,
  );
}

export function programTransportState(input: {
  readonly connectionPhase:
    | "available"
    | "offline"
    | "connecting"
    | "connected"
    | "backoff"
    | "blocked";
  readonly synchronized: boolean;
}): ProgramTransportState {
  if (input.connectionPhase === "connected") {
    return input.synchronized ? null : "synchronizing";
  }
  return input.synchronized ? "stale" : "synchronizing";
}
