import type { ProgramActivityItem, ProgramProjection, ProgramState } from "@t3tools/contracts";

const MAX_PROGRAM_ACTIVITY = 100;

export function appendProgramActivity(
  current: ReadonlyArray<ProgramActivityItem>,
  additions: ReadonlyArray<ProgramActivityItem>,
): ReadonlyArray<ProgramActivityItem> {
  return [...current, ...additions].slice(-MAX_PROGRAM_ACTIVITY);
}

export function allowedProgramCommands(state: ProgramState): ProgramProjection["allowedCommands"] {
  switch (state) {
    case "running":
      return ["pause", "stop", "steer", "request_replan"];
    case "paused":
      return ["resume", "stop", "request_replan"];
    case "attention_required":
      return ["resume", "stop", "request_replan"];
    default:
      return [];
  }
}

export function isTerminalProgramState(state: ProgramState): boolean {
  return state === "stopped" || state === "completed";
}
