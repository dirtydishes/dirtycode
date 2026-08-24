import type {
  ProgramBudgetDimension,
  ProgramEvaluationArm,
  ProgramState,
} from "@t3tools/contracts";

export type ProgramStatusTone = "info" | "success" | "warning" | "danger" | "neutral";

export interface ProgramStatePresentation {
  readonly label: string;
  readonly tone: ProgramStatusTone;
  readonly busy: boolean;
}

const PROGRAM_STATE_PRESENTATION: Readonly<Record<ProgramState, ProgramStatePresentation>> = {
  draft: { label: "Draft", tone: "neutral", busy: false },
  ready: { label: "Ready", tone: "info", busy: false },
  running: { label: "Running", tone: "success", busy: true },
  pausing: { label: "Pausing", tone: "warning", busy: true },
  paused: { label: "Paused", tone: "warning", busy: false },
  attention_required: { label: "Needs attention", tone: "danger", busy: false },
  stopping: { label: "Stopping", tone: "neutral", busy: true },
  stopped: { label: "Stopped", tone: "neutral", busy: false },
  certifying: { label: "Certifying", tone: "info", busy: true },
  completed: { label: "Completed", tone: "success", busy: false },
};

export function programStatePresentation(state: ProgramState): ProgramStatePresentation {
  return PROGRAM_STATE_PRESENTATION[state];
}

export interface ProgramBudgetPresentation {
  readonly label: string;
  readonly compactLabel: string;
}

export const PROGRAM_BUDGET_PRESENTATION: Readonly<
  Record<ProgramBudgetDimension, ProgramBudgetPresentation>
> = {
  activeThreads: { label: "Active threads", compactLabel: "Active threads" },
  nativeHelpers: { label: "Native helpers", compactLabel: "Native helpers" },
  helperDepth: { label: "Helper depth", compactLabel: "Helper depth" },
  providerTurns: { label: "Provider turns", compactLabel: "Provider turns" },
  tokens: { label: "Tokens", compactLabel: "Tokens" },
  costMilliUsd: { label: "Cost (milli-USD)", compactLabel: "Cost, milli-USD" },
  wallClockMinutes: { label: "Wall-clock minutes", compactLabel: "Time, minutes" },
  actions: { label: "Actions", compactLabel: "Actions" },
  concurrentWorktrees: { label: "Concurrent worktrees", compactLabel: "Worktrees" },
  cpuMillis: { label: "CPU milliseconds", compactLabel: "CPU, ms" },
  memoryMiB: { label: "Memory (MiB)", compactLabel: "Memory, MiB" },
  diskMiB: { label: "Disk (MiB)", compactLabel: "Disk, MiB" },
  repairs: { label: "Repairs", compactLabel: "Repairs" },
  retries: { label: "Retries", compactLabel: "Retries" },
};

export const PROGRAM_BUDGET_DIMENSIONS = Object.freeze(
  Object.keys(PROGRAM_BUDGET_PRESENTATION) as ReadonlyArray<ProgramBudgetDimension>,
);

export const PROGRAM_EVALUATION_ARM_LABELS: Readonly<Record<ProgramEvaluationArm, string>> = {
  solo: "Solo",
  explicit_delegates: "Explicit delegates",
  native_collaborative: "Native collaborative",
  t3_cross_provider: "T3 cross-provider",
  layered_dirtyloops_t3: "Layered dirtyloops + T3",
};

export const PROGRAM_EVALUATION_GUIDANCE =
  "Speed alone does not rank these arms. Compare accepted outcomes, unsafe effects, recovery, and operator work together.";
