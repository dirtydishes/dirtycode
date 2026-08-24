import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  OwnerResultId,
  PhaseCallbackId,
  PositiveInt,
  ProgramAttemptId,
  ProgramId,
  ProgramPhaseId,
  ProjectId,
  ProgramRequestId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProgramAttemptProviderPolicy, ProgramTeamPolicy } from "./programAttempt.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

export const GitCommit = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-f0-9]{40}$/));
export const Sha256Digest = TrimmedNonEmptyString.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));
export const DirtyloopsGeneration = TrimmedNonEmptyString.check(
  Schema.isPattern(/^dirtyloops:[a-f0-9]{64}$/),
);
export const SymbolicBranchRef = TrimmedNonEmptyString.check(Schema.isPattern(/^refs\/heads\//));

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
  teamPolicy: ProgramTeamPolicy,
});
export type OwnerAttemptIdentity = typeof OwnerAttemptIdentity.Type;

export const ProgramReviewDecision = Schema.Struct({
  candidateCommit: GitCommit,
  reviewId: TrimmedNonEmptyString,
  reviewKind: Schema.Literals(["broad", "focused"]),
  verdict: Schema.Literals(["approved", "rejected"]),
  findings: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      message: TrimmedNonEmptyString,
    }),
  ),
  ciState: Schema.Literals([
    "ci-green",
    "ci-repaired-and-green",
    "ci-unavailable-with-evidence",
    "ci-blocked-with-cause",
  ]),
  evidence: Schema.Array(EvidenceRef),
});
export type ProgramReviewDecision = typeof ProgramReviewDecision.Type;

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
  reviewDecision: Schema.optional(ProgramReviewDecision),
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
  implementationOwnerResultId: OwnerResultId,
  attemptId: ProgramAttemptId,
  reviewOwnerThreadId: ThreadId,
  candidateId: TrimmedNonEmptyString,
  reviewId: TrimmedNonEmptyString,
  candidateCommit: TrimmedNonEmptyString,
  reviewKind: Schema.Literals(["broad", "focused"]),
  preparedWorktree: PreparedWorktreeIdentity,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  providerPolicy: ProgramAttemptProviderPolicy,
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
  ownerResultIds: Schema.Array(OwnerResultId),
  candidateCommit: Schema.NullOr(GitCommit),
  disposition: Schema.Literals(["approved", "failed", "cancelled"]),
  evidence: Schema.Array(EvidenceRef),
});
export type PhaseCallbackIdentity = typeof PhaseCallbackIdentity.Type;

export const PhaseCallback = Schema.Struct({
  kind: Schema.Literal("phase_callback"),
  ...PhaseCallbackIdentity.fields,
});
export type PhaseCallback = typeof PhaseCallback.Type;

export const PhaseCallbackAcknowledgement = Schema.Struct({
  kind: Schema.Literal("phase_callback_acknowledgement"),
  programId: ProgramId,
  phaseId: ProgramPhaseId,
  phaseCoordinatorThreadId: ThreadId,
  programCoordinatorThreadId: ThreadId,
  sourceThreadId: ThreadId,
  phaseCallbackId: PhaseCallbackId,
  nonce: TrimmedNonEmptyString,
  candidateCommit: Schema.NullOr(GitCommit),
  disposition: Schema.Literals(["approved", "failed", "cancelled"]),
  accepted: Schema.Literal(true),
});
export type PhaseCallbackAcknowledgement = typeof PhaseCallbackAcknowledgement.Type;

export const IntegrationAdmissionRequestIdentity = Schema.Struct({
  ...EffectRequestIdentity,
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
});
export type IntegrationAdmissionRequestIdentity = typeof IntegrationAdmissionRequestIdentity.Type;

export const IntegrationAdmissionRequest = Schema.Struct({
  kind: Schema.Literal("integration_admission_request"),
  ...IntegrationAdmissionRequestIdentity.fields,
});
export type IntegrationAdmissionRequest = typeof IntegrationAdmissionRequest.Type;

export const IntegrationAdmissionAcknowledgement = Schema.Struct({
  kind: Schema.Literal("integration_admission_acknowledgement"),
  ...IntegrationAdmissionRequestIdentity.fields,
  accepted: Schema.Literal(true),
});
export type IntegrationAdmissionAcknowledgement = typeof IntegrationAdmissionAcknowledgement.Type;

export const GoalEffectIdentity = Schema.Struct({
  ...EffectRequestIdentity,
  goalThreadId: ThreadId,
  codexThreadId: TrimmedNonEmptyString,
  adapterGeneration: TrimmedNonEmptyString,
});
export type GoalEffectIdentity = typeof GoalEffectIdentity.Type;
