import type {
  ProgramAttemptSnapshot,
  ProgramBudgetDimension,
  ProgramProjection,
} from "@t3tools/contracts";

const PROGRAM_BUDGET_DIMENSIONS = [
  "activeThreads",
  "nativeHelpers",
  "helperDepth",
  "providerTurns",
  "tokens",
  "costMilliUsd",
  "wallClockMinutes",
  "actions",
  "concurrentWorktrees",
  "cpuMillis",
  "memoryMiB",
  "diskMiB",
  "repairs",
  "retries",
] as const satisfies ReadonlyArray<ProgramBudgetDimension>;

export function withMeasuredProgramBudgets(
  projection: ProgramProjection,
  attempts: ReadonlyArray<ProgramAttemptSnapshot>,
  now: string,
  createdAt: string,
): ProgramProjection {
  if (projection.budgets === undefined) return projection;
  const measuredAttempts = attempts.filter((attempt) => attempt.runtimeUsage !== undefined);
  const activeAttempts = measuredAttempts.filter((attempt) => attempt.state === "active");
  const activeThreads = activeAttempts.reduce(
    (used, attempt) => used + (attempt.runtimeUsage?.activeThreads ?? 0),
    0,
  );
  const nativeHelpers = activeAttempts.reduce(
    (used, attempt) => used + (attempt.runtimeUsage?.nativeHelpers ?? 0),
    0,
  );
  const helperDepth = activeAttempts.reduce(
    (used, attempt) => Math.max(used, attempt.runtimeUsage?.helperDepth ?? 0),
    0,
  );
  const providerTurns = measuredAttempts.reduce(
    (used, attempt) => used + (attempt.runtimeUsage?.providerTurns ?? 0),
    0,
  );
  const attemptWallClockMinutes = measuredAttempts.reduce(
    (used, attempt) => Math.max(used, attempt.runtimeUsage?.wallClockMinutes ?? 0),
    0,
  );
  const programWallClockMinutes = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(createdAt)) / 60_000),
  );
  const wallClockMinutes = Math.max(attemptWallClockMinutes, programWallClockMinutes);
  const actions = projection.receipts.length;
  const terminalPhaseStates = new Set<string>(["integrated", "failed", "cancelled"]);
  const concurrentWorktrees = projection.phases.filter(
    (phase) => phase.preparedWorktree !== null && !terminalPhaseStates.has(phase.state),
  ).length;
  const attemptHistoryByPhase = new Map<
    string,
    { implementationCount: number; failedReviewSinceImplementation: boolean }
  >();
  let repairs = 0;
  let retries = 0;
  for (const attempt of projection.attempts) {
    if (attempt.phaseId === null) continue;
    const history = attemptHistoryByPhase.get(attempt.phaseId) ?? {
      implementationCount: 0,
      failedReviewSinceImplementation: false,
    };
    if (attempt.ownerKind === "review") {
      attemptHistoryByPhase.set(attempt.phaseId, {
        ...history,
        failedReviewSinceImplementation:
          history.failedReviewSinceImplementation || attempt.terminalKind === "failed",
      });
      continue;
    }
    if (history.implementationCount > 0) {
      if (history.failedReviewSinceImplementation) repairs += 1;
      else retries += 1;
    }
    attemptHistoryByPhase.set(attempt.phaseId, {
      implementationCount: history.implementationCount + 1,
      failedReviewSinceImplementation: false,
    });
  }
  const reportedTokens = measuredAttempts.flatMap((attempt) =>
    attempt.runtimeUsage?.tokens === null || attempt.runtimeUsage?.tokens === undefined
      ? []
      : [attempt.runtimeUsage.tokens],
  );
  const reportedCost = measuredAttempts.flatMap((attempt) =>
    attempt.runtimeUsage?.costMilliUsd === null || attempt.runtimeUsage?.costMilliUsd === undefined
      ? []
      : [attempt.runtimeUsage.costMilliUsd],
  );
  const reportedCpu = measuredAttempts.flatMap((attempt) =>
    attempt.runtimeUsage?.cpuMillis === null || attempt.runtimeUsage?.cpuMillis === undefined
      ? []
      : [attempt.runtimeUsage.cpuMillis],
  );
  const reportedMemory = measuredAttempts.flatMap((attempt) =>
    attempt.runtimeUsage?.memoryMiB === null || attempt.runtimeUsage?.memoryMiB === undefined
      ? []
      : [attempt.runtimeUsage.memoryMiB],
  );
  const diskByWorktree = new Map<string, number>();
  for (const attempt of measuredAttempts) {
    const diskMiB = attempt.runtimeUsage?.diskMiB;
    if (diskMiB === null || diskMiB === undefined) continue;
    diskByWorktree.set(
      attempt.checkout.worktreePath,
      Math.max(diskByWorktree.get(attempt.checkout.worktreePath) ?? 0, diskMiB),
    );
  }
  const reportedDisk = [...diskByWorktree.values()];
  const budgets = {
    ...projection.budgets,
    activeThreads: { ...projection.budgets.activeThreads, used: activeThreads },
    nativeHelpers: { ...projection.budgets.nativeHelpers, used: nativeHelpers },
    helperDepth: { ...projection.budgets.helperDepth, used: helperDepth },
    providerTurns: { ...projection.budgets.providerTurns, used: providerTurns },
    wallClockMinutes: { ...projection.budgets.wallClockMinutes, used: wallClockMinutes },
    actions: { ...projection.budgets.actions, used: actions },
    concurrentWorktrees: {
      ...projection.budgets.concurrentWorktrees,
      used: concurrentWorktrees,
    },
    repairs: { ...projection.budgets.repairs, used: repairs },
    retries: { ...projection.budgets.retries, used: retries },
    ...(reportedTokens.length > 0
      ? {
          tokens: {
            ...projection.budgets.tokens,
            used: reportedTokens.reduce((used, tokens) => used + tokens, 0),
          },
        }
      : {}),
    ...(reportedCost.length > 0
      ? {
          costMilliUsd: {
            ...projection.budgets.costMilliUsd,
            used: reportedCost.reduce((used, cost) => used + cost, 0),
          },
        }
      : {}),
    ...(reportedCpu.length > 0
      ? {
          cpuMillis: {
            ...projection.budgets.cpuMillis,
            used: reportedCpu.reduce((used, cpuMillis) => used + cpuMillis, 0),
          },
        }
      : {}),
    ...(reportedMemory.length > 0
      ? {
          memoryMiB: {
            ...projection.budgets.memoryMiB,
            used: reportedMemory.reduce((used, memoryMiB) => used + memoryMiB, 0),
          },
        }
      : {}),
    ...(reportedDisk.length > 0
      ? {
          diskMiB: {
            ...projection.budgets.diskMiB,
            used: reportedDisk.reduce((used, diskMiB) => used + diskMiB, 0),
          },
        }
      : {}),
  };
  const measured: ReadonlyArray<ProgramBudgetDimension> = [
    "activeThreads",
    "nativeHelpers",
    "helperDepth",
    "providerTurns",
    "wallClockMinutes",
    "actions",
    "concurrentWorktrees",
    "repairs",
    "retries",
    ...(reportedTokens.length > 0 ? (["tokens"] as const) : []),
    ...(reportedCost.length > 0 ? (["costMilliUsd"] as const) : []),
    ...(reportedCpu.length > 0 ? (["cpuMillis"] as const) : []),
    ...(reportedMemory.length > 0 ? (["memoryMiB"] as const) : []),
    ...(reportedDisk.length > 0 ? (["diskMiB"] as const) : []),
  ];
  const exhausted = PROGRAM_BUDGET_DIMENSIONS.filter(
    (dimension) => budgets[dimension].used >= budgets[dimension].limit,
  );
  return {
    ...projection,
    phases: projection.phases.map((phase) => {
      if (phase.budgets === null) return phase;
      const phaseAttempts = attempts.filter((attempt) => attempt.taskId === phase.phaseId);
      const phaseTokens = phaseAttempts.flatMap((attempt) =>
        attempt.runtimeUsage?.tokens === null || attempt.runtimeUsage?.tokens === undefined
          ? []
          : [attempt.runtimeUsage.tokens],
      );
      const phaseWallClockMinutes = phaseAttempts.reduce(
        (used, attempt) => Math.max(used, attempt.runtimeUsage?.wallClockMinutes ?? 0),
        0,
      );
      return {
        ...phase,
        budgets: {
          attempts: { ...phase.budgets.attempts, used: phaseAttempts.length },
          wallClockMinutes: {
            ...phase.budgets.wallClockMinutes,
            used: phaseWallClockMinutes,
          },
          tokens: {
            ...phase.budgets.tokens,
            used:
              phaseTokens.length === 0
                ? phase.budgets.tokens.used
                : phaseTokens.reduce((used, tokens) => used + tokens, 0),
          },
        },
      };
    }),
    budgets: {
      ...budgets,
      measured: [...new Set([...(projection.budgets.measured ?? []), ...measured])],
      exhausted,
      dispatchAllowed: exhausted.length === 0,
    },
  };
}
