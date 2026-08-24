import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  OwnerResultId,
  PhaseCallbackId,
  PositiveInt,
  ProgramAttemptId,
  ProgramEventId,
  ProgramId,
  ProgramPhaseId,
  ProjectId,
  ProgramReceiptId,
  ProgramRequestId,
  ProgramWakeId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProgramTeamPolicy } from "./programAttempt.ts";
import {
  AcceptedOperatorIntent,
  ProgramCommand,
  ProgramCommandDecision,
  ProgramDecisionCode,
} from "./programCommand.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";
import {
  AttemptTerminalKind,
  DirtyloopsGeneration,
  EvidenceRef,
  GitCommit,
  OwnerResult,
  PreparedWorktreeIdentity,
  PreparedWorktreePermit,
  ProgramAttachment,
  ProgramAttemptState,
  ProgramPhaseState,
  ProgramState,
  ProgramThreadBinding,
  Sha256Digest,
  SymbolicBranchRef,
} from "./programIdentity.ts";
import {
  ProgramEffect as ProgramEffectSchema,
  type ProgramEffect as ProgramEffectContract,
  RuntimeReceipt as RuntimeReceiptSchema,
  type RuntimeReceipt as RuntimeReceiptContract,
} from "./programEffects.ts";
import {
  LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
  ProgramBudgetLimits,
  ProgramBudgetProjection,
  ProgramDeliberationEventPayload,
  ProgramDeliberationProjection,
  ProgramEvaluationReport,
} from "./programEvidence.ts";

export const ProgramEffect = ProgramEffectSchema;
export type ProgramEffect = ProgramEffectContract;
export const RuntimeReceipt = RuntimeReceiptSchema;
export type RuntimeReceipt = RuntimeReceiptContract;
export * from "./programEvidence.ts";

export {
  AcceptedOperatorIntent,
  PauseProgramInput,
  ProgramCommand,
  ProgramCommandDecision,
  ProgramDecisionCode,
  ReadProgramInput,
  RequestReplanProgramInput,
  ResumeProgramInput,
  StopProgramInput,
} from "./programCommand.ts";
export {
  AttemptTerminalKind,
  EvidenceRef,
  GoalEffectIdentity,
  IntegrationAdmissionAcknowledgement,
  IntegrationAdmissionRequest,
  IntegrationAdmissionRequestIdentity,
  OwnerAttemptIdentity,
  OwnerResult,
  OwnerResultAcknowledgement,
  OwnerResultIdentity,
  PhaseCallback,
  PhaseCallbackAcknowledgement,
  PhaseCallbackIdentity,
  PhaseCoordinatorLaunchIdentity,
  PreparedWorktreeIdentity,
  PreparedWorktreePermit,
  ProgramAttachment,
  ProgramAttemptState,
  ProgramPhaseState,
  ProgramReviewDecision,
  ProgramState,
  ProgramThreadBinding,
  ReviewOwnerIdentity,
} from "./programIdentity.ts";

export const ProgramPhaseProjection = Schema.Struct({
  phaseId: ProgramPhaseId,
  title: TrimmedNonEmptyString,
  state: ProgramPhaseState,
  beadsStatus: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  dependencyIds: Schema.Array(ProgramPhaseId),
  blockedBy: Schema.Array(ProgramPhaseId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([] as Array<ProgramPhaseId>)),
  ),
  blockerPath: Schema.Array(ProgramPhaseId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([] as Array<ProgramPhaseId>)),
  ),
  budgets: Schema.NullOr(
    Schema.Struct({
      attempts: Schema.Struct({ used: NonNegativeInt, limit: PositiveInt }),
      wallClockMinutes: Schema.Struct({ used: NonNegativeInt, limit: PositiveInt }),
      tokens: Schema.Struct({ used: NonNegativeInt, limit: PositiveInt }),
    }),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  policy: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  activeAttemptId: Schema.NullOr(ProgramAttemptId),
  phaseCoordinatorTargetThreadId: ThreadId,
  projectId: ProjectId,
  threadTitle: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  phaseCoordinatorThreadId: Schema.NullOr(ThreadId),
  ownerThreadId: Schema.NullOr(ThreadId),
  preparedWorktree: Schema.NullOr(PreparedWorktreeIdentity).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  lastLeaseEpoch: NonNegativeInt.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  leaseHeartbeatAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  receiptIds: Schema.Array(ProgramReceiptId),
});
export type ProgramPhaseProjection = typeof ProgramPhaseProjection.Type;

export const ProgramAttemptProjection = Schema.Struct({
  attemptId: ProgramAttemptId,
  phaseId: Schema.NullOr(ProgramPhaseId),
  ownerKind: Schema.Literals(["implementation", "review"]),
  teamPolicy: Schema.optional(ProgramTeamPolicy),
  state: ProgramAttemptState,
  threadId: Schema.NullOr(ThreadId),
  terminalKind: Schema.NullOr(AttemptTerminalKind),
  ownerResultId: Schema.NullOr(OwnerResultId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  resultDigest: Schema.NullOr(Sha256Digest).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
});
export type ProgramAttemptProjection = typeof ProgramAttemptProjection.Type;

export const ProgramStatusRailItem = Schema.Struct({
  stage: Schema.Literals(["plan", "ready", "execute", "review", "ci", "admit", "advance"]),
  state: Schema.Literals(["pending", "active", "settled", "failed"]),
  receiptId: Schema.NullOr(ProgramReceiptId),
});
export type ProgramStatusRailItem = typeof ProgramStatusRailItem.Type;

export const ProgramActivityItem = Schema.Struct({
  eventId: ProgramEventId,
  kind: Schema.Literals([
    "program_started",
    "wake_enqueued",
    "wake_claimed",
    "decision_recorded",
    "effect_proposed",
    "receipt_recorded",
    "receipt_acknowledged",
    "state_changed",
    "thread_bound",
    "deliberation_recorded",
    "evaluation_recorded",
  ]),
  message: TrimmedNonEmptyString,
  receiptId: Schema.NullOr(ProgramReceiptId),
  occurredAt: IsoDateTime,
});
export type ProgramActivityItem = typeof ProgramActivityItem.Type;

export const GoalCapability = Schema.Struct({
  available: Schema.Boolean,
  adapter: TrimmedNonEmptyString,
  reason: Schema.NullOr(TrimmedNonEmptyString),
});
export type GoalCapability = typeof GoalCapability.Type;

export const ProgramSourceIdentity = Schema.Struct({
  sourceCommit: GitCommit,
  sourceDigest: Sha256Digest,
  installedDigest: Sha256Digest,
  schemaGeneration: Sha256Digest,
  adapterDigest: Sha256Digest,
  generationId: DirtyloopsGeneration,
  parity: Schema.Literals(["current", "stale"]),
});
export type ProgramSourceIdentity = typeof ProgramSourceIdentity.Type;

export const ProgramRepositorySnapshot = Schema.Struct({
  repositoryId: TrimmedNonEmptyString,
  head: GitCommit,
  gitCommonDir: TrimmedNonEmptyString,
  symbolicRef: SymbolicBranchRef,
  integrationRef: SymbolicBranchRef,
});
export type ProgramRepositorySnapshot = typeof ProgramRepositorySnapshot.Type;

export const DirtyloopsCertificationFailure = Schema.Literals([
  "repository_identity_mismatch",
  "integration_ref_mismatch",
  "dirtyloops_generation_mismatch",
  "dirtyloops_adapter_mismatch",
  "source_parity_stale",
]);
export type DirtyloopsCertificationFailure = typeof DirtyloopsCertificationFailure.Type;

export const ProgramProjection = Schema.Struct({
  programId: ProgramId,
  revision: NonNegativeInt,
  title: TrimmedNonEmptyString,
  outcome: TrimmedNonEmptyString,
  state: ProgramState,
  terminal: Schema.Boolean,
  attentionReason: Schema.NullOr(TrimmedNonEmptyString),
  certificationFailures: Schema.Array(DirtyloopsCertificationFailure).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([] as Array<DirtyloopsCertificationFailure>)),
  ),
  allowedCommands: Schema.Array(ProgramCommand),
  sourceIdentity: Schema.NullOr(ProgramSourceIdentity).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  repositorySnapshot: Schema.NullOr(ProgramRepositorySnapshot).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  beadsRevision: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  graphDigest: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  phases: Schema.Array(ProgramPhaseProjection),
  attempts: Schema.Array(ProgramAttemptProjection),
  receipts: Schema.Array(RuntimeReceipt),
  threadBindings: Schema.Array(ProgramThreadBinding),
  statusRail: Schema.Array(ProgramStatusRailItem),
  activity: Schema.Array(ProgramActivityItem),
  deliberations: Schema.optional(Schema.Array(ProgramDeliberationProjection)),
  budgets: Schema.optional(ProgramBudgetProjection),
  evaluations: Schema.optional(Schema.Array(ProgramEvaluationReport)),
  activeAgentCount: NonNegativeInt,
  goalCapability: GoalCapability,
  lastEventAt: IsoDateTime,
});
export type ProgramProjection = typeof ProgramProjection.Type;

export const ProgramSummary = Schema.Struct({
  programId: ProgramId,
  title: TrimmedNonEmptyString,
  state: ProgramState,
  terminal: Schema.Boolean,
  phaseCount: NonNegativeInt,
  activeAgentCount: NonNegativeInt,
  lastEventAt: IsoDateTime,
});
export type ProgramSummary = typeof ProgramSummary.Type;

export function summarizeProgramProjection(projection: ProgramProjection): ProgramSummary {
  return {
    programId: projection.programId,
    title: projection.title,
    state: projection.state,
    terminal: projection.terminal,
    phaseCount: projection.phases.length,
    activeAgentCount: projection.activeAgentCount,
    lastEventAt: projection.lastEventAt,
  };
}

export const ProgramSnapshot = Schema.Struct({
  requestId: ProgramRequestId,
  decision: ProgramCommandDecision,
  projection: ProgramProjection,
});
export type ProgramSnapshot = typeof ProgramSnapshot.Type;

export const ProgramListSnapshot = Schema.Struct({
  schemaVersion: PositiveInt,
  programs: Schema.Array(ProgramSummary),
});
export type ProgramListSnapshot = typeof ProgramListSnapshot.Type;

export const ProgramWakeCause = Schema.Literals([
  "start",
  "manual",
  "restart",
  "effect_receipt",
  "driver_continue",
  "attempt_completed",
  "goal_changed",
  "operator_intent",
  "timer",
]);
export type ProgramWakeCause = typeof ProgramWakeCause.Type;

export const StartProgramInput = Schema.Struct({
  requestId: ProgramRequestId,
  attachment: ProgramAttachment,
  title: TrimmedNonEmptyString,
  outcome: TrimmedNonEmptyString,
  phases: Schema.Array(
    Schema.Struct({
      phaseId: ProgramPhaseId,
      title: TrimmedNonEmptyString,
      dependencyIds: Schema.Array(ProgramPhaseId),
      phaseCoordinatorThreadId: ThreadId,
      projectId: ProjectId,
      threadTitle: TrimmedNonEmptyString,
      modelSelection: ModelSelection,
      runtimeMode: RuntimeMode,
      interactionMode: ProviderInteractionMode,
      branch: Schema.NullOr(TrimmedNonEmptyString),
      worktreePath: Schema.NullOr(TrimmedNonEmptyString),
    }),
  ),
  attempts: Schema.Array(ProgramAttemptProjection),
  driverKind: Schema.Literals(["deterministic_fake", "dirtyloops"]),
});
export type StartProgramInput = typeof StartProgramInput.Type;

export const WakeProgramInput = Schema.Struct({
  programId: ProgramId,
  requestId: ProgramRequestId,
  cause: ProgramWakeCause,
});
export type WakeProgramInput = typeof WakeProgramInput.Type;

export const RecordProgramEvaluationInput = Schema.Struct({
  programId: ProgramId,
  requestId: ProgramRequestId,
  report: ProgramEvaluationReport,
});
export type RecordProgramEvaluationInput = typeof RecordProgramEvaluationInput.Type;

export const RecordProgramDeliberationInput = Schema.Struct({
  programId: ProgramId,
  requestId: ProgramRequestId,
  payload: ProgramDeliberationEventPayload,
});
export type RecordProgramDeliberationInput = typeof RecordProgramDeliberationInput.Type;

export const ReconcileProgramInput = Schema.Struct({
  attachment: ProgramAttachment,
  requestId: ProgramRequestId,
  observedProgramRevision: NonNegativeInt,
  observedProjection: ProgramProjection,
  wakeCause: ProgramWakeCause,
  operatorIntent: Schema.NullOr(AcceptedOperatorIntent),
  occurredAt: IsoDateTime,
  receipts: Schema.Array(RuntimeReceipt),
  ownerResults: Schema.Array(OwnerResult).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([] as Array<OwnerResult>)),
  ),
});
export type ReconcileProgramInput = typeof ReconcileProgramInput.Type;

export const DirtyloopsGraphPhase = Schema.Struct({
  phaseId: ProgramPhaseId,
  title: TrimmedNonEmptyString,
  beadsStatus: TrimmedNonEmptyString,
  state: Schema.Literals(["blocked", "ready", "integrated"]),
  dependencyIds: Schema.Array(ProgramPhaseId),
  blockedBy: Schema.Array(ProgramPhaseId),
  blockerPath: Schema.Array(ProgramPhaseId),
  policy: Schema.Record(Schema.String, Schema.Unknown),
  budgets: Schema.Struct({
    attempts: Schema.Struct({ used: NonNegativeInt, limit: PositiveInt }),
    wallClockMinutes: Schema.Struct({ used: NonNegativeInt, limit: PositiveInt }),
    tokens: Schema.Struct({ used: NonNegativeInt, limit: PositiveInt }),
  }),
});
export type DirtyloopsGraphPhase = typeof DirtyloopsGraphPhase.Type;

export const DirtyloopsProgramAction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("wait") }),
  Schema.Struct({
    kind: Schema.Literal("launch_phase_coordinator"),
    phaseId: ProgramPhaseId,
  }),
  Schema.Struct({
    kind: Schema.Literal("bind_prepared_worktree"),
    phaseId: ProgramPhaseId,
    ownerThreadId: ThreadId,
    permit: PreparedWorktreePermit,
  }),
  Schema.Struct({
    kind: Schema.Literals(["launch_owner_attempt", "cancel_owner_attempt"]),
    phaseId: ProgramPhaseId,
    ownerThreadId: ThreadId,
    attemptId: ProgramAttemptId,
    permit: PreparedWorktreePermit,
    prompt: TrimmedNonEmptyString,
    teamPolicy: ProgramTeamPolicy,
  }),
  Schema.Struct({
    kind: Schema.Literal("acknowledge_owner_result"),
    phaseId: ProgramPhaseId,
    ownerResult: OwnerResult,
    leaseId: TrimmedNonEmptyString,
    leaseEpoch: PositiveInt,
    expiresAt: IsoDateTime,
  }),
  Schema.Struct({
    kind: Schema.Literal("launch_review_owner"),
    phaseId: ProgramPhaseId,
    implementationOwnerResultId: OwnerResultId,
    attemptId: ProgramAttemptId,
    reviewOwnerThreadId: ThreadId,
    candidateId: TrimmedNonEmptyString,
    reviewId: TrimmedNonEmptyString,
    candidateCommit: GitCommit,
    reviewKind: Schema.Literals(["broad", "focused"]),
    prompt: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literals(["deliver_phase_callback", "acknowledge_phase_callback"]),
    phaseCallbackId: PhaseCallbackId,
    phaseId: ProgramPhaseId,
    phaseCoordinatorThreadId: ThreadId,
    programCoordinatorThreadId: ThreadId,
    sourceThreadId: ThreadId,
    nonce: TrimmedNonEmptyString,
    ownerResultIds: Schema.Array(OwnerResultId),
    candidateCommit: Schema.NullOr(GitCommit),
    disposition: Schema.Literals(["approved", "failed", "cancelled"]),
    evidence: Schema.Array(EvidenceRef),
  }),
  Schema.Struct({
    kind: Schema.Literal("deliver_integration_admission_request"),
    integrationAdmissionRequestId: TrimmedNonEmptyString,
    phaseId: ProgramPhaseId,
    programCoordinatorThreadId: ThreadId,
    integrationCoordinatorThreadId: ThreadId,
    sourceThreadId: ThreadId,
    phaseCallbackId: PhaseCallbackId,
    phaseCallbackNonce: TrimmedNonEmptyString,
    candidateCommit: GitCommit,
    expectedParent: GitCommit,
    integrationRef: SymbolicBranchRef,
    leaseId: TrimmedNonEmptyString,
    leaseEpoch: PositiveInt,
    expiresAt: IsoDateTime,
    integrationAdmissionNonce: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("admission_complete"),
    admissionId: TrimmedNonEmptyString,
    phaseId: ProgramPhaseId,
    integrationCoordinatorThreadId: ThreadId,
    integrationRef: SymbolicBranchRef,
    expectedParent: GitCommit,
    candidateCommit: GitCommit,
    preparedCommit: GitCommit,
    refUpdated: Schema.Literal(true),
    beadsTaskId: TrimmedNonEmptyString,
    beadsClosed: Schema.Literal(true),
    evidence: Schema.Array(EvidenceRef),
  }),
  Schema.Struct({
    kind: Schema.Literal("admission_blocked"),
    admissionId: TrimmedNonEmptyString,
    phaseId: ProgramPhaseId,
    integrationCoordinatorThreadId: ThreadId,
    integrationRef: SymbolicBranchRef,
    expectedParent: GitCommit,
    candidateCommit: GitCommit,
    preparedCommit: Schema.NullOr(GitCommit),
    refUpdated: Schema.Boolean,
    beadsTaskId: TrimmedNonEmptyString,
    beadsClosed: Schema.Boolean,
    finding: Schema.Struct({
      id: TrimmedNonEmptyString,
      message: TrimmedNonEmptyString,
      evidence: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  }),
]);
export type DirtyloopsProgramAction = typeof DirtyloopsProgramAction.Type;

export const DirtyloopsDecision = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literals(["wait", "effects"]),
  decisionCode: Schema.Literals([
    "graph_snapshot",
    "recertification_required",
    "mutable_phase",
    "admission_complete",
    "admission_blocked",
    "budget_exhausted",
  ]),
  action: Schema.optional(DirtyloopsProgramAction),
  certificationFailures: Schema.Array(DirtyloopsCertificationFailure),
  programRevision: NonNegativeInt,
  programState: ProgramState,
  operatorDecision: ProgramCommandDecision,
  reason: TrimmedNonEmptyString,
  wakeConditions: Schema.Array(TrimmedNonEmptyString),
  graph: Schema.Struct({
    programId: ProgramId,
    title: TrimmedNonEmptyString,
    outcome: TrimmedNonEmptyString,
    beadsRevision: Sha256Digest,
    graphDigest: Sha256Digest,
    budgets: ProgramBudgetLimits.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS)),
    ),
    phases: Schema.Array(DirtyloopsGraphPhase),
    sourceIdentity: ProgramSourceIdentity,
    repository: ProgramRepositorySnapshot,
    receipts: Schema.Array(RuntimeReceipt),
    observedAt: IsoDateTime,
  }),
});
export type DirtyloopsDecision = typeof DirtyloopsDecision.Type;

const ProgramDriverDecisionBase = {
  operatorDecision: ProgramCommandDecision,
} as const;

export const ProgramDriverDecision = Schema.Union([
  Schema.Struct({
    ...ProgramDriverDecisionBase,
    kind: Schema.Literal("effects"),
    programRevision: NonNegativeInt,
    projection: ProgramProjection,
    proposalId: TrimmedNonEmptyString,
    effects: Schema.Array(ProgramEffect),
  }),
  Schema.Struct({
    ...ProgramDriverDecisionBase,
    kind: Schema.Literal("wait"),
    programRevision: NonNegativeInt,
    projection: ProgramProjection,
    reason: TrimmedNonEmptyString,
    wakeConditions: Schema.Array(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    ...ProgramDriverDecisionBase,
    kind: Schema.Literal("attention_required"),
    programRevision: NonNegativeInt,
    projection: ProgramProjection,
    reasonCode: TrimmedNonEmptyString,
    evidence: Schema.Array(EvidenceRef),
  }),
  Schema.Struct({
    ...ProgramDriverDecisionBase,
    kind: Schema.Literal("complete"),
    programRevision: NonNegativeInt,
    projection: ProgramProjection,
    evidence: Schema.Array(EvidenceRef),
  }),
]);
export type ProgramDriverDecision = typeof ProgramDriverDecision.Type;

const ProgramEventEnvelope = {
  eventId: ProgramEventId,
  programId: ProgramId,
  sequence: PositiveInt,
  revision: NonNegativeInt,
  requestId: ProgramRequestId,
  occurredAt: IsoDateTime,
} as const;

export const ProgramEvent = Schema.Union([
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.started"),
    payload: Schema.Struct({ attachment: ProgramAttachment, projection: ProgramProjection }),
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.wake-enqueued"),
    payload: Schema.Struct({ wakeId: ProgramWakeId, cause: ProgramWakeCause }),
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.wake-claimed"),
    payload: Schema.Struct({
      wakeId: ProgramWakeId,
      epoch: PositiveInt,
      workerId: TrimmedNonEmptyString,
    }),
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.decision-recorded"),
    payload: ProgramDriverDecision,
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.effect-proposed"),
    payload: ProgramEffect,
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.receipt-recorded"),
    payload: RuntimeReceipt,
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.receipts-acknowledged"),
    payload: Schema.Struct({ receiptIds: Schema.Array(ProgramReceiptId) }),
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.state-changed"),
    payload: Schema.Struct({
      from: ProgramState,
      to: ProgramState,
      decisionCode: ProgramDecisionCode,
    }),
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.projection-saved"),
    payload: ProgramProjection,
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.thread-bound"),
    payload: ProgramThreadBinding,
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.deliberation-recorded"),
    payload: ProgramDeliberationEventPayload,
  }),
  Schema.Struct({
    ...ProgramEventEnvelope,
    type: Schema.Literal("program.evaluation-recorded"),
    payload: ProgramEvaluationReport,
  }),
]);
export type ProgramEvent = typeof ProgramEvent.Type;

export const ProgramStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: ProgramListSnapshot }),
  Schema.Struct({ kind: Schema.Literal("program.updated"), projection: ProgramProjection }),
  Schema.Struct({ kind: Schema.Literal("program.removed"), programId: ProgramId }),
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
]);
export type ProgramStreamItem = typeof ProgramStreamItem.Type;

export const PROGRAM_WS_METHODS = {
  subscribe: "programs.subscribe",
} as const;

export class ProgramRpcError extends Schema.TaggedErrorClass<ProgramRpcError>()("ProgramRpcError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const GoalRef = Schema.Struct({
  goalThreadId: ThreadId,
  codexThreadId: TrimmedNonEmptyString,
  programId: ProgramId,
  adapterGeneration: TrimmedNonEmptyString,
});
export type GoalRef = typeof GoalRef.Type;

export const GoalSnapshot = Schema.Struct({
  ref: GoalRef,
  objective: TrimmedNonEmptyString,
  status: Schema.Literals(["active", "complete", "blocked"]),
  revision: TrimmedNonEmptyString,
});
export type GoalSnapshot = typeof GoalSnapshot.Type;
