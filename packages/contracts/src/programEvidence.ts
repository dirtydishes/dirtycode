import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProgramEventId,
  ProgramId,
  ProgramPhaseId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { EvidenceRef, GitCommit, Sha256Digest } from "./programIdentity.ts";

export const ProgramDeliberationState = Schema.Literals([
  "gathering",
  "proposing",
  "challenging",
  "rebutting",
  "judging",
  "synthesizing",
  "decided",
  "stopped",
]);
export type ProgramDeliberationState = typeof ProgramDeliberationState.Type;

export const ProgramDeliberationEventKind = Schema.Literals([
  "approach_proposed",
  "finding_recorded",
  "challenge_recorded",
  "rebuttal_recorded",
  "judgment_recorded",
  "dissent_recorded",
  "synthesis_recorded",
  "deliberation_stopped",
]);
export type ProgramDeliberationEventKind = typeof ProgramDeliberationEventKind.Type;

export const ProgramDeliberationEventPayload = Schema.Struct({
  deliberationId: TrimmedNonEmptyString,
  phaseId: Schema.NullOr(ProgramPhaseId),
  question: TrimmedNonEmptyString,
  criteria: Schema.Array(TrimmedNonEmptyString),
  participantThreadIds: Schema.Array(ThreadId),
  kind: ProgramDeliberationEventKind,
  state: ProgramDeliberationState,
  approachId: Schema.NullOr(TrimmedNonEmptyString),
  authorThreadId: Schema.NullOr(ThreadId),
  summary: TrimmedNonEmptyString,
  evidence: Schema.Array(EvidenceRef),
});
export type ProgramDeliberationEventPayload = typeof ProgramDeliberationEventPayload.Type;

export const ProgramDeliberationEntry = Schema.Struct({
  eventId: ProgramEventId,
  kind: ProgramDeliberationEventKind,
  state: ProgramDeliberationState,
  approachId: Schema.NullOr(TrimmedNonEmptyString),
  authorThreadId: Schema.NullOr(ThreadId),
  summary: TrimmedNonEmptyString,
  evidence: Schema.Array(EvidenceRef),
  occurredAt: IsoDateTime,
});
export type ProgramDeliberationEntry = typeof ProgramDeliberationEntry.Type;

export const ProgramDeliberationProjection = Schema.Struct({
  deliberationId: TrimmedNonEmptyString,
  programId: ProgramId,
  phaseId: Schema.NullOr(ProgramPhaseId),
  question: TrimmedNonEmptyString,
  criteria: Schema.Array(TrimmedNonEmptyString),
  participantThreadIds: Schema.Array(ThreadId),
  approachIds: Schema.Array(TrimmedNonEmptyString),
  state: ProgramDeliberationState,
  entries: Schema.Array(ProgramDeliberationEntry),
});
export type ProgramDeliberationProjection = typeof ProgramDeliberationProjection.Type;

export const ProgramBudgetDimension = Schema.Literals([
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
]);
export type ProgramBudgetDimension = typeof ProgramBudgetDimension.Type;

export const ProgramBudgetUsage = Schema.Struct({ used: NonNegativeInt, limit: PositiveInt });
export type ProgramBudgetUsage = typeof ProgramBudgetUsage.Type;

const ProgramBudgetFields = {
  activeThreads: ProgramBudgetUsage,
  nativeHelpers: ProgramBudgetUsage,
  helperDepth: ProgramBudgetUsage,
  providerTurns: ProgramBudgetUsage,
  tokens: ProgramBudgetUsage,
  costMilliUsd: ProgramBudgetUsage,
  wallClockMinutes: ProgramBudgetUsage,
  actions: ProgramBudgetUsage,
  concurrentWorktrees: ProgramBudgetUsage,
  cpuMillis: ProgramBudgetUsage,
  memoryMiB: ProgramBudgetUsage,
  diskMiB: ProgramBudgetUsage,
  repairs: ProgramBudgetUsage,
  retries: ProgramBudgetUsage,
} as const;

export const ProgramBudgetLimits = Schema.Struct(ProgramBudgetFields);
export type ProgramBudgetLimits = typeof ProgramBudgetLimits.Type;

export const LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS = {
  activeThreads: { used: 0, limit: 16 },
  nativeHelpers: { used: 0, limit: 1 },
  helperDepth: { used: 0, limit: 1 },
  providerTurns: { used: 0, limit: 200 },
  tokens: { used: 0, limit: 1_000_000 },
  costMilliUsd: { used: 0, limit: 100_000 },
  wallClockMinutes: { used: 0, limit: 480 },
  actions: { used: 0, limit: 1_000 },
  concurrentWorktrees: { used: 0, limit: 1 },
  cpuMillis: { used: 0, limit: 3_600_000 },
  memoryMiB: { used: 0, limit: 16_384 },
  diskMiB: { used: 0, limit: 102_400 },
  repairs: { used: 0, limit: 1 },
  retries: { used: 0, limit: 6 },
} satisfies ProgramBudgetLimits;

export const ProgramBudgetProjection = Schema.Struct({
  ...ProgramBudgetFields,
  measured: Schema.optional(Schema.Array(ProgramBudgetDimension)),
  exhausted: Schema.Array(ProgramBudgetDimension),
  dispatchAllowed: Schema.Boolean,
});
export type ProgramBudgetProjection = typeof ProgramBudgetProjection.Type;

export const ProgramEvaluationArm = Schema.Literals([
  "solo",
  "explicit_delegates",
  "native_collaborative",
  "t3_cross_provider",
  "layered_dirtyloops_t3",
]);
export type ProgramEvaluationArm = typeof ProgramEvaluationArm.Type;

export const ProgramEvaluationMetrics = Schema.Struct({
  tasks: NonNegativeInt,
  acceptedTasks: NonNegativeInt,
  elapsedMillis: NonNegativeInt,
  activeComputeMillis: NonNegativeInt,
  tokens: NonNegativeInt,
  costMilliUsd: NonNegativeInt,
  reviewRejections: NonNegativeInt,
  ciFailures: NonNegativeInt,
  duplicateEffects: NonNegativeInt,
  staleEffects: NonNegativeInt,
  injectedCrashes: NonNegativeInt,
  successfulRecoveries: NonNegativeInt,
  operatorInterventions: NonNegativeInt,
  postAdmissionDefects: NonNegativeInt,
  integratedPhases: NonNegativeInt,
  readyWorkLatencyMillis: NonNegativeInt,
});
export type ProgramEvaluationMetrics = typeof ProgramEvaluationMetrics.Type;

export const ProgramEvaluationReport = Schema.Struct({
  evaluationId: TrimmedNonEmptyString,
  cohortId: TrimmedNonEmptyString,
  arm: ProgramEvaluationArm,
  fixedInputsDigest: Sha256Digest,
  repositoryId: TrimmedNonEmptyString,
  startingCommit: GitCommit,
  taskSetDigest: Sha256Digest,
  metrics: ProgramEvaluationMetrics,
  evidence: Schema.Array(EvidenceRef),
});
export type ProgramEvaluationReport = typeof ProgramEvaluationReport.Type;
