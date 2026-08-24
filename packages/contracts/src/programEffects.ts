import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  OwnerResultId,
  PhaseCallbackId,
  ProgramEffectId,
  ProgramId,
  ProgramReceiptId,
  ProgramRequestId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  AttemptTerminalKind,
  EvidenceRef,
  GoalEffectIdentity,
  IntegrationAdmissionRequestIdentity,
  OwnerAttemptIdentity,
  OwnerResultIdentity,
  PhaseCallbackIdentity,
  PhaseCoordinatorLaunchIdentity,
  PreparedWorktreeIdentity,
  ReviewOwnerIdentity,
} from "./programIdentity.ts";

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
    kind: Schema.Literal("deliver_phase_callback"),
    effectId: ProgramEffectId,
    identity: PhaseCallbackIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literal("acknowledge_phase_callback"),
    effectId: ProgramEffectId,
    identity: PhaseCallbackIdentity,
  }),
  Schema.Struct({
    kind: Schema.Literal("deliver_integration_admission_request"),
    effectId: ProgramEffectId,
    identity: IntegrationAdmissionRequestIdentity,
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
    kind: Schema.Literal("deliver_integration_admission_request"),
    identity: IntegrationAdmissionRequestIdentity,
    result: Schema.Struct({
      integrationAdmissionRequestId: TrimmedNonEmptyString,
      nonce: TrimmedNonEmptyString,
    }),
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
