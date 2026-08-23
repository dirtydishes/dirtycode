import { type ProgramEffect, type RuntimeReceipt } from "@t3tools/contracts";

import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import { sha256Digest } from "../ProgramIdentity.ts";

function receiptBase(effect: ProgramEffect, context: ProgramEffectExecutorContext) {
  return {
    receiptId: context.receiptId,
    programId: context.programId,
    programRevision: context.programRevision,
    effectId: effect.effectId,
    requestId: context.requestId,
    status: "succeeded" as const,
    resultDigest: sha256Digest({ effectId: effect.effectId, kind: effect.kind }),
    createdAt: context.now,
    acknowledged: false,
  };
}

export function phaseReceipt(
  effect: Extract<ProgramEffect, { readonly kind: "launch_phase_coordinator" }>,
  context: ProgramEffectExecutorContext,
): RuntimeReceipt {
  return {
    ...receiptBase(effect, context),
    kind: effect.kind,
    evidence: [{ kind: "thread", id: effect.identity.phaseCoordinatorThreadId }],
    identity: effect.identity,
    result: { phaseCoordinatorThreadId: effect.identity.phaseCoordinatorThreadId },
  };
}

export function bindReceipt(
  effect: Extract<ProgramEffect, { readonly kind: "bind_prepared_worktree" }>,
  context: ProgramEffectExecutorContext,
): RuntimeReceipt {
  return {
    ...receiptBase(effect, context),
    kind: effect.kind,
    evidence: [
      { kind: "thread", id: effect.identity.ownerThreadId },
      { kind: "commit", id: effect.identity.startingCommit },
    ],
    identity: effect.identity,
    result: { ownerThreadId: effect.identity.ownerThreadId, verifiedAt: context.now },
  };
}

export function attemptReceipt(
  effect: Extract<ProgramEffect, { readonly kind: "launch_owner_attempt" }>,
  context: ProgramEffectExecutorContext,
  providerRunId: string,
): RuntimeReceipt {
  return {
    ...receiptBase(effect, context),
    kind: effect.kind,
    evidence: [
      { kind: "thread", id: effect.identity.ownerThreadId },
      { kind: "log", id: providerRunId, label: "ProgramAttempt provider run" },
    ],
    identity: effect.identity,
    result: { ownerThreadId: effect.identity.ownerThreadId, providerRunId },
  };
}

export function cancelReceipt(
  effect: Extract<ProgramEffect, { readonly kind: "cancel_owner_attempt" }>,
  context: ProgramEffectExecutorContext,
  terminalKind: Extract<
    RuntimeReceipt,
    { readonly kind: "cancel_owner_attempt" }
  >["result"]["terminalKind"],
): RuntimeReceipt {
  return {
    ...receiptBase(effect, context),
    kind: effect.kind,
    evidence: [{ kind: "thread", id: effect.identity.ownerThreadId }],
    identity: effect.identity,
    result: { terminalKind },
  };
}

export function acknowledgementReceipt(
  effect: Extract<ProgramEffect, { readonly kind: "acknowledge_owner_result" }>,
  context: ProgramEffectExecutorContext,
): RuntimeReceipt {
  return {
    ...receiptBase(effect, context),
    kind: effect.kind,
    evidence: effect.identity.evidence,
    identity: effect.identity,
    result: { ownerResultId: effect.identity.ownerResultId },
  };
}

export function reviewReceipt(
  effect: Extract<ProgramEffect, { readonly kind: "launch_review_owner" }>,
  context: ProgramEffectExecutorContext,
  providerRunId: string,
): RuntimeReceipt {
  return {
    ...receiptBase(effect, context),
    kind: effect.kind,
    evidence: [
      { kind: "thread", id: effect.identity.reviewOwnerThreadId },
      { kind: "commit", id: effect.identity.candidateCommit },
      { kind: "log", id: providerRunId, label: "Candidate review provider run" },
    ],
    identity: effect.identity,
    result: {
      reviewOwnerThreadId: effect.identity.reviewOwnerThreadId,
      providerRunId,
    },
  };
}

export function callbackReceipt(
  effect: Extract<
    ProgramEffect,
    { readonly kind: "deliver_phase_callback" | "acknowledge_phase_callback" }
  >,
  context: ProgramEffectExecutorContext,
): RuntimeReceipt {
  return {
    ...receiptBase(effect, context),
    kind: effect.kind,
    evidence: effect.identity.evidence,
    identity: effect.identity,
    result: {
      phaseCallbackId: effect.identity.phaseCallbackId,
      nonce: effect.identity.nonce,
    },
  };
}
