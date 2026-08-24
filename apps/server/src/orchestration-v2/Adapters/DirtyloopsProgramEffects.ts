import {
  type DirtyloopsProgramAction,
  ProgramEffectId,
  type ProgramEffect,
  type ReconcileProgramInput,
} from "@t3tools/contracts";

import { ProgramDriverError } from "../ProgramDriver.ts";
import { sha256Digest } from "../ProgramIdentity.ts";

const budgetIdentity = sha256Digest;

function permitMatches(
  action: Extract<
    DirtyloopsProgramAction,
    {
      readonly kind: "bind_prepared_worktree" | "launch_owner_attempt" | "cancel_owner_attempt";
    }
  >,
  phase: ReconcileProgramInput["observedProjection"]["phases"][number],
  input: ReconcileProgramInput,
): boolean {
  const permit = action.permit;
  return (
    permit.programId === input.attachment.programId &&
    permit.phaseId === phase.phaseId &&
    permit.phaseCoordinatorThreadId === phase.phaseCoordinatorThreadId &&
    permit.repositoryIdentity === input.attachment.repositoryId &&
    permit.expectedIntegrationHead === input.observedProjection.repositorySnapshot?.head &&
    permit.integrationRef === input.attachment.integrationRef &&
    phase.budgets !== null &&
    permit.budgetIdentity === budgetIdentity(phase.budgets)
  );
}

type EffectAction = Exclude<
  DirtyloopsProgramAction,
  { readonly kind: "wait" | "admission_complete" | "admission_blocked" }
>;
type PhaseProjection = ReconcileProgramInput["observedProjection"]["phases"][number];

interface TranslationContext {
  readonly input: ReconcileProgramInput;
  readonly projection: ReconcileProgramInput["observedProjection"];
  readonly phase: PhaseProjection;
  readonly effectId: ProgramEffectId;
}

function launchPhaseCoordinatorEffect(
  action: Extract<EffectAction, { readonly kind: "launch_phase_coordinator" }>,
  context: TranslationContext,
): ProgramEffect | ProgramDriverError {
  const { input, phase, effectId } = context;
  if (phase.phaseCoordinatorThreadId !== null) {
    return new ProgramDriverError({
      reason: "driver tried to relaunch a bound Phase coordinator",
    });
  }
  return {
    kind: action.kind,
    effectId,
    identity: {
      programId: input.attachment.programId,
      phaseId: phase.phaseId,
      programCoordinatorThreadId: input.attachment.programCoordinatorThreadId,
      phaseCoordinatorThreadId: phase.phaseCoordinatorTargetThreadId,
      projectId: phase.projectId,
      threadTitle: phase.threadTitle,
      modelSelection: phase.modelSelection,
      runtimeMode: phase.runtimeMode,
      interactionMode: phase.interactionMode,
      branch: phase.branch,
      worktreePath: phase.worktreePath,
      requestId: input.requestId,
    },
  };
}

function acknowledgeOwnerResultEffect(
  action: Extract<EffectAction, { readonly kind: "acknowledge_owner_result" }>,
  context: TranslationContext,
): ProgramEffect | ProgramDriverError {
  const { input, phase, effectId } = context;
  const observed = input.ownerResults.find(
    (candidate) => candidate.ownerResultId === action.ownerResult.ownerResultId,
  );
  if (
    observed === undefined ||
    phase.preparedWorktree === null ||
    phase.preparedWorktree.leaseId !== action.leaseId ||
    phase.preparedWorktree.leaseEpoch !== action.leaseEpoch ||
    phase.preparedWorktree.expiresAt !== action.expiresAt ||
    observed.programId !== input.attachment.programId ||
    observed.phaseId !== phase.phaseId ||
    observed.phaseCoordinatorThreadId !== phase.phaseCoordinatorThreadId ||
    observed.ownerThreadId !== phase.ownerThreadId ||
    observed.attemptId !== phase.activeAttemptId ||
    observed.resultDigest !== action.ownerResult.resultDigest
  ) {
    return new ProgramDriverError({
      reason: "driver OwnerResult identity does not match T3 observation",
    });
  }
  return {
    kind: action.kind,
    effectId,
    identity: {
      requestId: input.requestId,
      ...observed,
      leaseId: action.leaseId,
      leaseEpoch: action.leaseEpoch,
      expiresAt: action.expiresAt,
    },
  };
}

function launchReviewOwnerEffect(
  action: Extract<EffectAction, { readonly kind: "launch_review_owner" }>,
  context: TranslationContext,
): ProgramEffect | ProgramDriverError {
  const { input, projection, phase, effectId } = context;
  const implementationAttempt = projection.attempts.find(
    (candidate) =>
      candidate.attemptId === phase.activeAttemptId &&
      candidate.phaseId === phase.phaseId &&
      candidate.ownerKind === "implementation" &&
      candidate.state === "acknowledged" &&
      candidate.terminalKind === "succeeded" &&
      candidate.ownerResultId === action.implementationOwnerResultId,
  );
  if (
    implementationAttempt === undefined ||
    phase.phaseCoordinatorThreadId === null ||
    phase.preparedWorktree === null ||
    phase.state !== "candidate"
  ) {
    return new ProgramDriverError({
      reason: "driver review does not match the acknowledged immutable candidate",
    });
  }
  return {
    kind: action.kind,
    effectId,
    identity: {
      programId: input.attachment.programId,
      requestId: input.requestId,
      implementationOwnerResultId: action.implementationOwnerResultId,
      phaseId: phase.phaseId,
      phaseCoordinatorThreadId: phase.phaseCoordinatorThreadId,
      attemptId: action.attemptId,
      reviewOwnerThreadId: action.reviewOwnerThreadId,
      candidateId: action.candidateId,
      reviewId: action.reviewId,
      candidateCommit: action.candidateCommit,
      reviewKind: action.reviewKind,
      preparedWorktree: phase.preparedWorktree,
      projectId: phase.projectId,
      title: `Dirtyloops Phase ${phase.phaseId} immutable ${action.reviewKind} review`,
      prompt: action.prompt,
      providerPolicy: {
        modelSelection: phase.modelSelection,
        runtimeMode: "read-only",
        interactionMode: phase.interactionMode,
      },
    },
  };
}

function integrationAdmissionRequestEffect(
  action: Extract<EffectAction, { readonly kind: "deliver_integration_admission_request" }>,
  context: TranslationContext,
): ProgramEffect | ProgramDriverError {
  const { input, projection, phase, effectId } = context;
  const callbackReceipt = projection.receipts.find(
    (receipt) =>
      receipt.kind === "acknowledge_phase_callback" &&
      receipt.status === "succeeded" &&
      receipt.identity.phaseId === phase.phaseId &&
      receipt.identity.programCoordinatorThreadId === action.programCoordinatorThreadId &&
      receipt.identity.phaseCallbackId === action.phaseCallbackId &&
      receipt.identity.nonce === action.phaseCallbackNonce &&
      receipt.identity.candidateCommit === action.candidateCommit,
  );
  if (
    phase.state !== "approved" ||
    phase.preparedWorktree === null ||
    action.programCoordinatorThreadId !== input.attachment.programCoordinatorThreadId ||
    action.integrationCoordinatorThreadId !== input.attachment.integrationCoordinatorThreadId ||
    action.sourceThreadId !== input.attachment.programCoordinatorThreadId ||
    action.expectedParent !== phase.preparedWorktree.expectedIntegrationHead ||
    action.integrationRef !== phase.preparedWorktree.integrationRef ||
    action.leaseId !== phase.preparedWorktree.leaseId ||
    action.leaseEpoch !== phase.preparedWorktree.leaseEpoch ||
    action.expiresAt !== phase.preparedWorktree.expiresAt ||
    callbackReceipt === undefined
  ) {
    return new ProgramDriverError({
      reason: "driver integration Admission request does not match the approved Program boundary",
    });
  }
  const { kind, ...identity } = action;
  return {
    kind,
    effectId,
    identity: {
      programId: input.attachment.programId,
      requestId: input.requestId,
      ...identity,
    },
  };
}

function phaseCallbackEffect(
  action: Extract<
    EffectAction,
    { readonly kind: "deliver_phase_callback" | "acknowledge_phase_callback" }
  >,
  context: TranslationContext,
): ProgramEffect | ProgramDriverError {
  const { input, projection, phase, effectId } = context;
  const reviewReceipt = projection.receipts.find(
    (receipt) =>
      receipt.kind === "acknowledge_owner_result" &&
      receipt.status === "succeeded" &&
      receipt.identity.ownerKind === "review" &&
      receipt.identity.reviewDecision?.candidateCommit === action.candidateCommit,
  );
  if (
    phase.state !== "approved" ||
    phase.phaseCoordinatorThreadId !== action.phaseCoordinatorThreadId ||
    action.sourceThreadId !== action.phaseCoordinatorThreadId ||
    action.programCoordinatorThreadId !== input.attachment.programCoordinatorThreadId ||
    reviewReceipt === undefined
  ) {
    return new ProgramDriverError({
      reason: "driver Phase callback does not match approved review evidence",
    });
  }
  const { kind, ...identity } = action;
  const effectIdentity = {
    programId: input.attachment.programId,
    requestId: input.requestId,
    ...identity,
  };
  return kind === "deliver_phase_callback"
    ? { kind, effectId, identity: effectIdentity }
    : { kind, effectId, identity: effectIdentity };
}

function preparedWorktreeEffect(
  action: Extract<EffectAction, { readonly kind: "bind_prepared_worktree" }>,
  context: TranslationContext,
): ProgramEffect | ProgramDriverError {
  const { input, phase, effectId } = context;
  if (!permitMatches(action, phase, input)) {
    return new ProgramDriverError({
      reason: "driver worktree permit does not match the Program hierarchy",
    });
  }
  if (phase.phaseCoordinatorThreadId === null || phase.ownerThreadId !== null) {
    return new ProgramDriverError({
      reason: "driver proposed an owner bind outside its Phase boundary",
    });
  }
  return {
    kind: action.kind,
    effectId,
    identity: {
      requestId: input.requestId,
      ...action.permit,
      ownerThreadId: action.ownerThreadId,
      projectId: phase.projectId,
      ownerThreadTitle: `Dirtyloops Phase ${phase.phaseId} implementation owner`,
      modelSelection: phase.modelSelection,
      runtimeMode: phase.runtimeMode,
      interactionMode: phase.interactionMode,
    },
  };
}

function ownerAttemptEffect(
  action: Extract<EffectAction, { readonly kind: "launch_owner_attempt" | "cancel_owner_attempt" }>,
  context: TranslationContext,
): ProgramEffect | ProgramDriverError {
  const { input, phase, effectId } = context;
  if (!permitMatches(action, phase, input)) {
    return new ProgramDriverError({
      reason: "driver worktree permit does not match the Program hierarchy",
    });
  }
  if (
    phase.preparedWorktree === null ||
    phase.phaseCoordinatorThreadId === null ||
    phase.ownerThreadId !== action.ownerThreadId ||
    phase.preparedWorktree.leaseId !== action.permit.leaseId ||
    phase.preparedWorktree.leaseEpoch !== action.permit.leaseEpoch ||
    phase.preparedWorktree.expiresAt !== action.permit.expiresAt
  ) {
    return new ProgramDriverError({
      reason: "driver Attempt does not match the bound worktree lease",
    });
  }
  const identity = {
    programId: input.attachment.programId,
    requestId: input.requestId,
    phaseId: phase.phaseId,
    phaseCoordinatorThreadId: phase.phaseCoordinatorThreadId,
    attemptId: action.attemptId,
    ownerThreadId: action.ownerThreadId,
    preparedWorktree: phase.preparedWorktree,
    prompt: action.prompt,
    teamPolicy: action.teamPolicy,
    providerPolicy: {
      modelSelection: phase.modelSelection,
      runtimeMode: phase.runtimeMode,
      interactionMode: phase.interactionMode,
    },
  };
  return action.kind === "launch_owner_attempt"
    ? { kind: "launch_owner_attempt", effectId, identity }
    : { kind: "cancel_owner_attempt", effectId, identity };
}

export function dirtyloopsEffectForAction(
  action: EffectAction,
  input: ReconcileProgramInput,
  projection: ReconcileProgramInput["observedProjection"],
  revision: number,
): ProgramEffect | ProgramDriverError {
  const phase = projection.phases.find((candidate) => candidate.phaseId === action.phaseId);
  if (phase === undefined) {
    return new ProgramDriverError({ reason: "driver action names an unknown Phase" });
  }
  const context: TranslationContext = {
    input,
    projection,
    phase,
    effectId: ProgramEffectId.make(
      `effect:${input.attachment.programId}:${phase.phaseId}:${revision}:${action.kind}`,
    ),
  };
  switch (action.kind) {
    case "launch_phase_coordinator":
      return launchPhaseCoordinatorEffect(action, context);
    case "acknowledge_owner_result":
      return acknowledgeOwnerResultEffect(action, context);
    case "launch_review_owner":
      return launchReviewOwnerEffect(action, context);
    case "deliver_integration_admission_request":
      return integrationAdmissionRequestEffect(action, context);
    case "deliver_phase_callback":
    case "acknowledge_phase_callback":
      return phaseCallbackEffect(action, context);
    case "bind_prepared_worktree":
      return preparedWorktreeEffect(action, context);
    case "launch_owner_attempt":
    case "cancel_owner_attempt":
      return ownerAttemptEffect(action, context);
  }
}
