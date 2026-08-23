import {
  selectProgramWorkspaceWindow,
  type ProgramWorkspaceWindow,
} from "@t3tools/client-runtime/state/programs";
import type {
  EnvironmentId,
  ProgramBudgetDimension,
  ProgramId,
  ProgramProjection,
  ProgramState,
  ProgramSummary,
  ProgramTeamPolicy,
} from "@t3tools/contracts";

const MOBILE_PROGRAM_LIMITS = {
  phases: 20,
  attempts: 20,
  receipts: 20,
  activity: 8,
} as const;

const BUDGET_LABELS: Readonly<Record<ProgramBudgetDimension, string>> = {
  activeThreads: "Active threads",
  nativeHelpers: "Native helpers",
  helperDepth: "Helper depth",
  providerTurns: "Provider turns",
  tokens: "Tokens",
  costMilliUsd: "Cost (milli-USD)",
  wallClockMinutes: "Wall-clock minutes",
  actions: "Actions",
  concurrentWorktrees: "Concurrent worktrees",
  cpuMillis: "CPU milliseconds",
  memoryMiB: "Memory (MiB)",
  diskMiB: "Disk (MiB)",
  repairs: "Repairs",
  retries: "Retries",
};

const BUDGET_DIMENSIONS = Object.keys(BUDGET_LABELS) as ReadonlyArray<ProgramBudgetDimension>;

const EVALUATION_ARM_LABELS = {
  solo: "Solo",
  explicit_delegates: "Explicit delegates",
  native_collaborative: "Native collaborative",
  t3_cross_provider: "T3 cross-provider",
  layered_dirtyloops_t3: "Layered dirtyloops + T3",
} as const;

export const MOBILE_EVALUATION_GUIDANCE =
  "Speed alone does not rank these arms. Compare accepted outcomes, unsafe effects, recovery, and operator work together.";

export type MobileProgramOperatorCommand = "pause" | "resume" | "request_replan" | "stop";

export interface MobileProgramControl {
  readonly command: MobileProgramOperatorCommand;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly destructive: boolean;
}

export interface MobileProgramTeamRow {
  readonly attemptId: ProgramProjection["attempts"][number]["attemptId"];
  readonly modeLabel: string;
  readonly boundsLabel: string | null;
  readonly criteria: ReadonlyArray<string>;
}

export interface MobileProgramBudgetRow {
  readonly key: ProgramBudgetDimension;
  readonly label: string;
  readonly valueLabel: string;
  readonly exhausted: boolean;
}

export interface MobileProgramEvaluationRow {
  readonly evaluationId: string;
  readonly armLabel: string;
  readonly cohortId: string;
  readonly acceptedLabel: string;
  readonly timeLabel: string;
  readonly resourceLabel: string;
  readonly qualityLabel: string;
  readonly safetyLabel: string;
  readonly recoveryLabel: string;
  readonly throughputLabel: string;
}

export interface MobileProgramPresentation {
  readonly window: ProgramWorkspaceWindow;
  readonly controls: ReadonlyArray<MobileProgramControl>;
  readonly teamRows: ReadonlyArray<MobileProgramTeamRow>;
  readonly budgetRows: ReadonlyArray<MobileProgramBudgetRow>;
  readonly evaluationRows: ReadonlyArray<MobileProgramEvaluationRow>;
  readonly evaluationGuidance: string;
}

export interface MobileProgramIndexRow {
  readonly programId: ProgramId;
  readonly title: string;
  readonly stateLabel: string;
  readonly accessibilityLabel: string;
  readonly terminal: boolean;
  readonly phaseCount: number;
  readonly activeAgentCount: number;
  readonly route: {
    readonly environmentId: EnvironmentId;
    readonly programId: ProgramId;
  };
}

export interface MobileProgramIndexSection {
  readonly title: "Active Programs" | "Settled Programs";
  readonly rows: ReadonlyArray<MobileProgramIndexRow>;
}

export interface MobileProgramIndexPresentation {
  readonly sections: ReadonlyArray<MobileProgramIndexSection>;
  readonly count: number;
}

function readableIdentifier(identifier: string): string {
  const words = identifier.replaceAll("_", " ");
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function programStateLabel(state: ProgramState): string {
  return readableIdentifier(state);
}

function programIndexRow(
  environmentId: EnvironmentId,
  summary: ProgramSummary,
): MobileProgramIndexRow {
  const stateLabel = programStateLabel(summary.state);
  return {
    programId: summary.programId,
    title: summary.title,
    stateLabel,
    accessibilityLabel: `${summary.title}, ${stateLabel}, ${summary.phaseCount} phase${summary.phaseCount === 1 ? "" : "s"}, ${summary.activeAgentCount} active agent${summary.activeAgentCount === 1 ? "" : "s"}`,
    terminal: summary.terminal,
    phaseCount: summary.phaseCount,
    activeAgentCount: summary.activeAgentCount,
    route: { environmentId, programId: summary.programId },
  };
}

export function buildMobileProgramIndexPresentation(
  environmentId: EnvironmentId,
  programs: ReadonlyMap<ProgramId, ProgramSummary>,
): MobileProgramIndexPresentation {
  const rows = [...programs.values()]
    .sort((left, right) => right.lastEventAt.localeCompare(left.lastEventAt))
    .map((summary) => programIndexRow(environmentId, summary));
  const active = rows.filter((row) => !row.terminal);
  const settled = rows.filter((row) => row.terminal);
  return {
    sections: [
      ...(active.length > 0 ? [{ title: "Active Programs" as const, rows: active }] : []),
      ...(settled.length > 0 ? [{ title: "Settled Programs" as const, rows: settled }] : []),
    ],
    count: rows.length,
  };
}

function teamBounds(policy: Exclude<ProgramTeamPolicy, { readonly mode: "solo" }>): string {
  const common = `${policy.maxHelpers} helpers, ${policy.maxConcurrent} concurrent, depth ${policy.maxDepth}`;
  return policy.mode === "layered_hybrid" ? `${common}, ${policy.maxRounds} rounds` : common;
}

function teamRow(attempt: ProgramProjection["attempts"][number]): MobileProgramTeamRow | null {
  const policy = attempt.teamPolicy;
  if (policy === undefined) return null;
  return {
    attemptId: attempt.attemptId,
    modeLabel: readableIdentifier(policy.mode),
    boundsLabel: policy.mode === "solo" ? null : teamBounds(policy),
    criteria: policy.mode === "layered_hybrid" ? policy.criteria : [],
  };
}

const CONTROL_BY_COMMAND: Readonly<Record<MobileProgramOperatorCommand, MobileProgramControl>> = {
  pause: {
    command: "pause",
    label: "Pause",
    accessibilityLabel: "Pause Program",
    destructive: false,
  },
  resume: {
    command: "resume",
    label: "Resume",
    accessibilityLabel: "Resume Program",
    destructive: false,
  },
  request_replan: {
    command: "request_replan",
    label: "Request replan",
    accessibilityLabel: "Request Program replan",
    destructive: false,
  },
  stop: {
    command: "stop",
    label: "Stop",
    accessibilityLabel: "Stop Program",
    destructive: true,
  },
};

function isMobileOperatorCommand(command: string): command is MobileProgramOperatorCommand {
  return (
    command === "pause" ||
    command === "resume" ||
    command === "request_replan" ||
    command === "stop"
  );
}

function pluralized(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}

function secondsLabel(milliseconds: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(milliseconds / 1_000)} s`;
}

function milliUsdLabel(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(value / 1_000);
}

export function buildMobileProgramPresentation(
  projection: ProgramProjection,
): MobileProgramPresentation {
  const window = selectProgramWorkspaceWindow(projection, {
    phaseOffset: 0,
    phaseLimit: MOBILE_PROGRAM_LIMITS.phases,
    attemptOffset: 0,
    attemptLimit: MOBILE_PROGRAM_LIMITS.attempts,
    receiptOffset: Math.max(0, projection.receipts.length - MOBILE_PROGRAM_LIMITS.receipts),
    receiptLimit: MOBILE_PROGRAM_LIMITS.receipts,
    activityOffset: 0,
    activityLimit: MOBILE_PROGRAM_LIMITS.activity,
  });

  const exhausted = new Set(projection.budgets?.exhausted ?? []);
  return {
    window,
    controls: projection.allowedCommands
      .filter(isMobileOperatorCommand)
      .map((command) => CONTROL_BY_COMMAND[command]),
    teamRows: window.attempts.items.flatMap((attempt) => {
      const row = teamRow(attempt);
      return row === null ? [] : [row];
    }),
    budgetRows:
      projection.budgets === undefined
        ? []
        : BUDGET_DIMENSIONS.map((key) => ({
            key,
            label: BUDGET_LABELS[key],
            valueLabel: `${projection.budgets?.[key].used.toLocaleString("en-US")} / ${projection.budgets?.[key].limit.toLocaleString("en-US")}`,
            exhausted: exhausted.has(key),
          })),
    evaluationRows: (projection.evaluations ?? []).map((evaluation) => {
      const metrics = evaluation.metrics;
      return {
        evaluationId: evaluation.evaluationId,
        armLabel: EVALUATION_ARM_LABELS[evaluation.arm],
        cohortId: evaluation.cohortId,
        acceptedLabel: `${metrics.acceptedTasks.toLocaleString("en-US")} / ${metrics.tasks.toLocaleString("en-US")} accepted`,
        timeLabel: `${secondsLabel(metrics.elapsedMillis)} elapsed · ${secondsLabel(metrics.activeComputeMillis)} compute`,
        resourceLabel: `${metrics.tokens.toLocaleString("en-US")} tokens · ${milliUsdLabel(metrics.costMilliUsd)}`,
        qualityLabel: `${pluralized(metrics.reviewRejections, "review rejection")} · ${pluralized(metrics.ciFailures, "CI failure")}`,
        safetyLabel: `${pluralized(metrics.duplicateEffects, "duplicate effect")} · ${pluralized(metrics.staleEffects, "stale effect")} · ${pluralized(metrics.postAdmissionDefects, "post-Admission defect")}`,
        recoveryLabel: `${metrics.successfulRecoveries.toLocaleString("en-US")} / ${metrics.injectedCrashes.toLocaleString("en-US")} crash recoveries · ${pluralized(metrics.operatorInterventions, "operator intervention")}`,
        throughputLabel: `${pluralized(metrics.integratedPhases, "integrated Phase")} · ${secondsLabel(metrics.readyWorkLatencyMillis)} ready latency`,
      };
    }),
    evaluationGuidance: MOBILE_EVALUATION_GUIDANCE,
  };
}
