import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  OwnerResultId,
  PhaseCallbackId,
  PositiveInt,
  ProgramAttemptId,
  ProgramEffectId,
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
import { ProgramAttemptProviderPolicy } from "./programAttempt.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

const GitCommit = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const Sha256Digest = TrimmedNonEmptyString.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));
const DirtyloopsGeneration = TrimmedNonEmptyString.check(
  Schema.isPattern(/^dirtyloops:[a-f0-9]{64}$/),
);
const SymbolicBranchRef = TrimmedNonEmptyString.check(Schema.isPattern(/^refs\/heads\//));

export const ProgramState = Schema.Literals([
  "draft",
  "certifying",
  "ready",
  "running",
  "pausing",
  "paused",
  "attention_required",
  "stopping",
  "stopped",
  "completed",
]);
export type ProgramState = typeof ProgramState.Type;

export const ProgramPhaseState = Schema.Literals([
  "blocked",
  "ready",
  "reserved",
  "running",
  "candidate",
  "reviewing",
  "approved",
  "admitting",
  "integrated",
  "failed",
  "cancelled",
  "attention_required",
]);
export type ProgramPhaseState = typeof ProgramPhaseState.Type;

export const ProgramAttemptState = Schema.Literals([
  "launch_pending",
  "launch_delivering",
  "running",
  "cancel_pending",
  "cancel_delivering",
  "terminal_retained",
  "acknowledge_pending",
  "acknowledged",
]);
export type ProgramAttemptState = typeof ProgramAttemptState.Type;

export const AttemptTerminalKind = Schema.Literals([
  "succeeded",
  "failed",
  "cancelled",
  "t3_restart_interrupted",
  "launch_rejected",
  "identity_mismatch",
]);
export type AttemptTerminalKind = typeof AttemptTerminalKind.Type;

export const ProgramCommand = Schema.Literals([
  "pause",
  "resume",
  "stop",
  "steer",
  "request_replan",
]);
export type ProgramCommand = typeof ProgramCommand.Type;

export const ProgramDecisionCode = Schema.Literals([
  "accepted",
  "already_applied",
  "invalid_state",
  "program_not_found",
  "request_conflict",
  "lease_conflict",
  "unsupported_goal",
  "attachment_mismatch",
]);
export type ProgramDecisionCode = typeof ProgramDecisionCode.Type;

export const ProgramCommandDecision = Schema.Struct({
  status: Schema.Literals(["accepted", "rejected"]),
  code: ProgramDecisionCode,
  message: TrimmedNonEmptyString,
});
export type ProgramCommandDecision = typeof ProgramCommandDecision.Type;

export const EvidenceRef = Schema.Struct({
  kind: Schema.Literals(["thread", "commit", "check", "receipt", "log", "diff", "task"]),
  id: TrimmedNonEmptyString,
  label: Schema.optional(TrimmedNonEmptyString),
  href: Schema.optional(TrimmedNonEmptyString),
  digest: Schema.optional(TrimmedNonEmptyString),
});
export type EvidenceRef = typeof EvidenceRef.Type;

export const ProgramAttachment = Schema.Struct({
  programId: ProgramId,
  repositoryId: TrimmedNonEmptyString,
  integrationRef: TrimmedNonEmptyString,
  programCoordinatorThreadId: ThreadId,
  integrationCoordinatorThreadId: ThreadId,
  dirtyloopsGenerationId: TrimmedNonEmptyString,
  dirtyloopsAdapterDigest: TrimmedNonEmptyString,
  t3EnvironmentId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type ProgramAttachment = typeof ProgramAttachment.Type;

export const ProgramThreadBinding = Schema.Struct({
  threadId: ThreadId,
  role: Schema.Literals([
    "program_coordinator",
    "integration_coordinator",
    "phase_coordinator",
    "implementation_owner",
    "review_owner",
  ]),
  phaseId: Schema.NullOr(ProgramPhaseId),
  attemptId: Schema.NullOr(ProgramAttemptId),
});
export type ProgramThreadBinding = typeof ProgramThreadBinding.Type;

const EffectRequestIdentity = {
  programId: ProgramId,
  requestId: ProgramRequestId,
} as const;

export const PhaseCoordinatorLaunchIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  phaseId: ProgramPhaseId,
  programCoordinatorThreadId: ThreadId,
  phaseCoordinatorThreadId: ThreadId,
  projectId: ProjectId,
  threadTitle: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
});
export type PhaseCoordinatorLaunchIdentity = typeof PhaseCoordinatorLaunchIdentity.Type;

const PreparedWorktreePermitFields = {
  programId: ProgramId,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  leaseId: TrimmedNonEmptyString,
  leaseEpoch: PositiveInt,
  repositoryIdentity: TrimmedNonEmptyString,
  repositoryRoot: TrimmedNonEmptyString,
  gitCommonDir: TrimmedNonEmptyString,
  realPath: TrimmedNonEmptyString,
  expectedIntegrationHead: TrimmedNonEmptyString,
  integrationRef: SymbolicBranchRef,
  budgetIdentity: Sha256Digest,
  symbolicBranch: TrimmedNonEmptyString,
  startingCommit: TrimmedNonEmptyString,
  clean: Schema.Literal(true),
  declaredPaths: Schema.Array(TrimmedNonEmptyString),
  expiresAt: IsoDateTime,
} as const;

export const PreparedWorktreePermit = Schema.Struct(PreparedWorktreePermitFields);
export type PreparedWorktreePermit = typeof PreparedWorktreePermit.Type;

export const PreparedWorktreeIdentity = Schema.Struct({
  requestId: ProgramRequestId,
  ...PreparedWorktreePermitFields,
  ownerThreadId: ThreadId,
  projectId: ProjectId,
  ownerThreadTitle: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export type PreparedWorktreeIdentity = typeof PreparedWorktreeIdentity.Type;

export const OwnerAttemptIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  attemptId: ProgramAttemptId,
  ownerThreadId: ThreadId,
  preparedWorktree: PreparedWorktreeIdentity,
  prompt: TrimmedNonEmptyString,
  providerPolicy: ProgramAttemptProviderPolicy,
});
export type OwnerAttemptIdentity = typeof OwnerAttemptIdentity.Type;

export const OwnerResult = Schema.Struct({
  ownerResultId: OwnerResultId,
  programId: ProgramId,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  ownerThreadId: ThreadId,
  attemptId: ProgramAttemptId,
  ownerKind: Schema.Literals(["implementation", "review"]),
  terminalKind: AttemptTerminalKind,
  resultDigest: Sha256Digest,
  evidence: Schema.Array(EvidenceRef),
});
export type OwnerResult = typeof OwnerResult.Type;

export const OwnerResultAcknowledgement = Schema.Struct({
  kind: Schema.Literal("owner_result_acknowledgement"),
  ownerResultId: OwnerResultId,
  programId: ProgramId,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  ownerThreadId: ThreadId,
  attemptId: ProgramAttemptId,
  resultDigest: Sha256Digest,
  leaseId: TrimmedNonEmptyString,
  leaseEpoch: PositiveInt,
  accepted: Schema.Literal(true),
});
export type OwnerResultAcknowledgement = typeof OwnerResultAcknowledgement.Type;

export const OwnerResultIdentity = Schema.Struct({
  requestId: ProgramRequestId,
  ...OwnerResult.fields,
  leaseId: TrimmedNonEmptyString,
  leaseEpoch: PositiveInt,
  expiresAt: IsoDateTime,
});
export type OwnerResultIdentity = typeof OwnerResultIdentity.Type;

export const ReviewOwnerIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  candidateCommit: TrimmedNonEmptyString,
  reviewKind: Schema.Literals(["broad", "focused"]),
});
export type ReviewOwnerIdentity = typeof ReviewOwnerIdentity.Type;

export const PhaseCallbackIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  phaseCallbackId: PhaseCallbackId,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  programCoordinatorThreadId: ThreadId,
  sourceThreadId: ThreadId,
  nonce: TrimmedNonEmptyString,
});
export type PhaseCallbackIdentity = typeof PhaseCallbackIdentity.Type;

export const GoalEffectIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  goalThreadId: ThreadId,
  codexThreadId: TrimmedNonEmptyString,
  adapterGeneration: TrimmedNonEmptyString,
});
export type GoalEffectIdentity = typeof GoalEffectIdentity.Type;

export const ProgramEffect = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("launch_phase_coordinator"),
    effectId: ProgramEffectId,
    identity: PhaseCoordinatorLaunchIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literal("bind_prepared_worktree"),
    effectId: ProgramEffectId,
    identity: PreparedWorktreeIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literal("launch_owner_attempt"),
    effectId: ProgramEffectId,
    identity: OwnerAttemptIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literal("cancel_owner_attempt"),
    effectId: ProgramEffectId,
    identity: OwnerAttemptIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literal("acknowledge_owner_result"),
    effectId: ProgramEffectId,
    identity: OwnerResultIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literal("launch_review_owner"),
    effectId: ProgramEffectId,
    identity: ReviewOwnerIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literals(["deliver_phase_callback", "acknowledge_phase_callback"]),
    effectId: ProgramEffectId,
    identity: PhaseCallbackIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literals(["update_goal", "clear_goal"]),
    effectId: ProgramEffectId,
    identity: GoalEffectIdentity,
  }),
]);
export type ProgramEffect = typeof ProgramEffect.Type;

const ReceiptBase = {
  receiptId: ProgramReceiptId,
  programId: ProgramId,
  programRevision: NonNegativeInt,
  effectId: ProgramEffectId,
  requestId: ProgramRequestId,
  status: Schema.Literals(["succeeded", "failed", "ambiguous"]),
  resultDigest: TrimmedNonEmptyString,
  evidence: Schema.Array(EvidenceRef),
  createdAt: IsoDateTime,
  acknowledged: Schema.Boolean,
} as const;

export const RuntimeReceipt = Schema.Union([
  Schema.Struct({
    ...ReceiptBase,
    kind: Schema.Literal("launch_phase_coordinator"),
    identity: PhaseCoordinatorLaunchIdentity,
    result: Schema.Struct({ phaseCoordinatorThreadId: ThreadId }),
  }),
  Schema.Struct({
    ...ReceiptBase,
    kind: Schema.Literal("bind_prepared_worktree"),
    identity: PreparedWorktreeIdentity,
    result: Schema.Struct({ ownerThreadId: ThreadId, verifiedAt: IsoDateTime }),
  }),
  Schema.Struct({
    ...ReceiptBase,
    kind: Schema.Literal("launch_owner_attempt"),
    identity: OwnerAttemptIdentity,
    result: Schema.Struct({ ownerThreadId: ThreadId, providerRunId: TrimmedNonEmptyString }),
  }),
  Schema.Struct({
    ...ReceiptBase,
    kind: Schema.Literal("cancel_owner_attempt"),
    identity: OwnerAttemptIdentity,
    result: Schema.Struct({ terminalKind: AttemptTerminalKind }),
  }),
  Schema.Struct({
    ...ReceiptBase,
    kind: Schema.Literal("acknowledge_owner_result"),
    identity: OwnerResultIdentity,
    result: Schema.Struct({ ownerResultId: OwnerResultId }),
  }),
  Schema.Struct({
    ...ReceiptBase,
    kind: Schema.Literal("launch_review_owner"),
    identity: ReviewOwnerIdentity,
    result: Schema.Struct({ reviewOwnerThreadId: ThreadId, providerRunId: TrimmedNonEmptyString }),
  }),
  Schema.Struct({
    ...ReceiptBase,
    kind: Schema.Literals(["deliver_phase_callback", "acknowledge_phase_callback"]),
    identity: PhaseCallbackIdentity,
    result: Schema.Struct({ phaseCallbackId: PhaseCallbackId, nonce: TrimmedNonEmptyString }),
  }),
  Schema.Struct({
    ...ReceiptBase,
    kind: Schema.Literals(["update_goal", "clear_goal"]),
    identity: GoalEffectIdentity,
    result: Schema.Struct({
      goalThreadId: ThreadId,
      goalRevision: TrimmedNonEmptyString,
    }),
  }),
]);
export type RuntimeReceipt = typeof RuntimeReceipt.Type;

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

const ProgramMutationInput = Schema.Struct({
  programId: ProgramId,
  requestId: ProgramRequestId,
});
export const PauseProgramInput = ProgramMutationInput;
export type PauseProgramInput = typeof PauseProgramInput.Type;
export const ResumeProgramInput = ProgramMutationInput;
export type ResumeProgramInput = typeof ResumeProgramInput.Type;
export const StopProgramInput = Schema.Struct({
  ...ProgramMutationInput.fields,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type StopProgramInput = typeof StopProgramInput.Type;
export const ReadProgramInput = Schema.Struct({ programId: ProgramId });
export type ReadProgramInput = typeof ReadProgramInput.Type;

export const AcceptedOperatorIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pause") }),
  Schema.Struct({ kind: Schema.Literal("resume") }),
  Schema.Struct({ kind: Schema.Literal("stop"), reason: Schema.optional(TrimmedNonEmptyString) }),
]);
export type AcceptedOperatorIntent = typeof AcceptedOperatorIntent.Type;

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
  }),
  Schema.Struct({
    kind: Schema.Literal("acknowledge_owner_result"),
    phaseId: ProgramPhaseId,
    ownerResult: OwnerResult,
    leaseId: TrimmedNonEmptyString,
    leaseEpoch: PositiveInt,
    expiresAt: IsoDateTime,
  }),
]);
export type DirtyloopsProgramAction = typeof DirtyloopsProgramAction.Type;

export const DirtyloopsDecision = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literals(["wait", "effects"]),
  decisionCode: Schema.Literals(["graph_snapshot", "recertification_required", "mutable_phase"]),
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
