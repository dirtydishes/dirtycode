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
  ProgramReceiptId,
  ProgramRequestId,
  ProgramWakeId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

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
});
export type PhaseCoordinatorLaunchIdentity = typeof PhaseCoordinatorLaunchIdentity.Type;

export const PreparedWorktreeIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  ownerThreadId: ThreadId,
  leaseId: TrimmedNonEmptyString,
  leaseEpoch: PositiveInt,
  repositoryIdentity: TrimmedNonEmptyString,
  gitCommonDir: TrimmedNonEmptyString,
  realPath: TrimmedNonEmptyString,
  expectedIntegrationHead: TrimmedNonEmptyString,
  symbolicBranch: TrimmedNonEmptyString,
  startingCommit: TrimmedNonEmptyString,
  clean: Schema.Literal(true),
  declaredPaths: Schema.Array(TrimmedNonEmptyString),
  expiresAt: IsoDateTime,
});
export type PreparedWorktreeIdentity = typeof PreparedWorktreeIdentity.Type;

export const OwnerAttemptIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  attemptId: ProgramAttemptId,
  ownerThreadId: Schema.NullOr(ThreadId),
  preparedWorktree: PreparedWorktreeIdentity,
  providerPolicy: Schema.Record(Schema.String, Schema.Unknown),
});
export type OwnerAttemptIdentity = typeof OwnerAttemptIdentity.Type;

export const OwnerResultIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  ownerResultId: OwnerResultId,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  ownerThreadId: ThreadId,
  attemptId: ProgramAttemptId,
  ownerKind: Schema.Literals(["implementation", "review"]),
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
    kind: Schema.Literals(["launch_owner_attempt", "cancel_owner_attempt"]),
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
  dependencyIds: Schema.Array(ProgramPhaseId),
  activeAttemptId: Schema.NullOr(ProgramAttemptId),
  ownerThreadId: Schema.NullOr(ThreadId),
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

export const ProgramProjection = Schema.Struct({
  programId: ProgramId,
  revision: NonNegativeInt,
  title: TrimmedNonEmptyString,
  outcome: TrimmedNonEmptyString,
  state: ProgramState,
  terminal: Schema.Boolean,
  attentionReason: Schema.NullOr(TrimmedNonEmptyString),
  allowedCommands: Schema.Array(ProgramCommand),
  phases: Schema.Array(ProgramPhaseProjection),
  attempts: Schema.Array(ProgramAttemptProjection),
  receipts: Schema.Array(RuntimeReceipt),
  threadBindings: Schema.Array(ProgramThreadBinding),
  statusRail: Schema.Array(ProgramStatusRailItem),
  activity: Schema.Array(ProgramActivityItem),
  activeAgentCount: NonNegativeInt,
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
    }),
  ),
  driverKind: Schema.Literal("deterministic_fake"),
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

export const ReconcileProgramInput = Schema.Struct({
  attachment: ProgramAttachment,
  requestId: ProgramRequestId,
  observedProgramRevision: NonNegativeInt,
  wakeCause: ProgramWakeCause,
  receipts: Schema.Array(RuntimeReceipt),
});
export type ReconcileProgramInput = typeof ReconcileProgramInput.Type;

export const ProgramDriverDecision = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("effects"),
    programRevision: NonNegativeInt,
    projection: ProgramProjection,
    proposalId: TrimmedNonEmptyString,
    effects: Schema.Array(ProgramEffect),
  }),
  Schema.Struct({
    kind: Schema.Literal("wait"),
    programRevision: NonNegativeInt,
    projection: ProgramProjection,
    reason: TrimmedNonEmptyString,
    wakeConditions: Schema.Array(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("attention_required"),
    programRevision: NonNegativeInt,
    projection: ProgramProjection,
    reasonCode: TrimmedNonEmptyString,
    evidence: Schema.Array(EvidenceRef),
  }),
  Schema.Struct({
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
    type: Schema.Literal("program.thread-bound"),
    payload: ProgramThreadBinding,
  }),
]);
export type ProgramEvent = typeof ProgramEvent.Type;

export const ProgramStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: ProgramListSnapshot }),
  Schema.Struct({ kind: Schema.Literal("program.updated"), program: ProgramSummary }),
  Schema.Struct({ kind: Schema.Literal("program.removed"), programId: ProgramId }),
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
]);
export type ProgramStreamItem = typeof ProgramStreamItem.Type;

export const GoalCapability = Schema.Struct({
  available: Schema.Boolean,
  adapter: TrimmedNonEmptyString,
  reason: Schema.NullOr(TrimmedNonEmptyString),
});
export type GoalCapability = typeof GoalCapability.Type;

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
