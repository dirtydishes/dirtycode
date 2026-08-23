import {
  ProgramEventId,
  type ProgramPhaseProjection,
  type ProgramProjection,
  type RuntimeReceipt,
} from "@t3tools/contracts";

import { allowedProgramCommands, appendProgramActivity } from "./ProgramProjectionSupport.ts";

type ReceiptKind = RuntimeReceipt["kind"];
type ReceiptOf<K extends ReceiptKind> = Extract<RuntimeReceipt, { readonly kind: K }>;
type ReceiptHandler<K extends ReceiptKind> = (
  projection: ProgramProjection,
  phase: ProgramPhaseProjection,
  receipt: ReceiptOf<K>,
  retained: ProgramProjection["receipts"],
  now: string,
) => ProgramProjection;

function withReceiptActivity(
  projection: ProgramProjection,
  receipt: RuntimeReceipt,
  retained: ProgramProjection["receipts"],
  now: string,
  message: string,
  additions: Partial<ProgramProjection>,
): ProgramProjection {
  return {
    ...projection,
    ...additions,
    receipts: retained,
    activity: appendProgramActivity(projection.activity, [
      {
        eventId: ProgramEventId.make(`program-event:${receipt.receiptId}`),
        kind: "receipt_recorded",
        message,
        receiptId: receipt.receiptId,
        occurredAt: now,
      },
    ]),
    lastEventAt: now,
  };
}

const projectPhaseCoordinator: ReceiptHandler<"launch_phase_coordinator"> = (
  projection,
  phase,
  receipt,
  retained,
  now,
) => {
  const threadId = receipt.result.phaseCoordinatorThreadId;
  const bindingExists = projection.threadBindings.some(
    (binding) => binding.threadId === threadId && binding.role === "phase_coordinator",
  );
  return withReceiptActivity(
    projection,
    receipt,
    retained,
    now,
    "Phase coordinator launch completed.",
    {
      phases: projection.phases.map((candidate) =>
        candidate.phaseId === phase.phaseId
          ? {
              ...candidate,
              state: "running",
              phaseCoordinatorThreadId: threadId,
              receiptIds: [...candidate.receiptIds, receipt.receiptId],
            }
          : candidate,
      ),
      threadBindings: bindingExists
        ? projection.threadBindings
        : [
            ...projection.threadBindings,
            { threadId, role: "phase_coordinator", phaseId: phase.phaseId, attemptId: null },
          ],
      statusRail: projection.statusRail.map((item) =>
        item.stage === "execute" ? { ...item, receiptId: receipt.receiptId } : item,
      ),
      activeAgentCount: projection.activeAgentCount + 1,
    },
  );
};

const projectPreparedWorktree: ReceiptHandler<"bind_prepared_worktree"> = (
  projection,
  phase,
  receipt,
  retained,
  now,
) => {
  const bindingExists = projection.threadBindings.some(
    (binding) => binding.threadId === receipt.result.ownerThreadId,
  );
  return withReceiptActivity(
    projection,
    receipt,
    retained,
    now,
    "Owner thread bound to the dirtyloops-prepared worktree.",
    {
      phases: projection.phases.map((candidate) =>
        candidate.phaseId === phase.phaseId
          ? {
              ...candidate,
              state: "reserved",
              ownerThreadId: receipt.result.ownerThreadId,
              preparedWorktree: receipt.identity,
              lastLeaseEpoch: receipt.identity.leaseEpoch,
              leaseHeartbeatAt: receipt.result.verifiedAt,
              receiptIds: [...candidate.receiptIds, receipt.receiptId],
            }
          : candidate,
      ),
      threadBindings: bindingExists
        ? projection.threadBindings
        : [
            ...projection.threadBindings,
            {
              threadId: receipt.result.ownerThreadId,
              role: "implementation_owner",
              phaseId: phase.phaseId,
              attemptId: null,
            },
          ],
      activeAgentCount: bindingExists
        ? projection.activeAgentCount
        : projection.activeAgentCount + 1,
    },
  );
};

const projectOwnerAttempt: ReceiptHandler<"launch_owner_attempt"> = (
  projection,
  phase,
  receipt,
  retained,
  now,
) => {
  const retainedAttempt = projection.attempts.find(
    (attempt) => attempt.attemptId === receipt.identity.attemptId,
  );
  const attempt = {
    attemptId: receipt.identity.attemptId,
    phaseId: phase.phaseId,
    ownerKind: "implementation" as const,
    state: "running" as const,
    threadId: receipt.result.ownerThreadId,
    terminalKind: null,
    ownerResultId: null,
    resultDigest: null,
  };
  return withReceiptActivity(
    projection,
    receipt,
    retained,
    now,
    "Implementation owner ProgramAttempt launched.",
    {
      phases: projection.phases.map((candidate) =>
        candidate.phaseId === phase.phaseId
          ? {
              ...candidate,
              state: "running",
              activeAttemptId: receipt.identity.attemptId,
              ownerThreadId: receipt.result.ownerThreadId,
              preparedWorktree: receipt.identity.preparedWorktree,
              lastLeaseEpoch: receipt.identity.preparedWorktree.leaseEpoch,
              leaseHeartbeatAt: now,
              receiptIds: [...candidate.receiptIds, receipt.receiptId],
            }
          : candidate,
      ),
      attempts:
        retainedAttempt === undefined
          ? [...projection.attempts, attempt]
          : projection.attempts.map((candidate) =>
              candidate.attemptId === attempt.attemptId ? attempt : candidate,
            ),
      threadBindings: projection.threadBindings.map((binding) =>
        binding.threadId === receipt.result.ownerThreadId && binding.role === "implementation_owner"
          ? { ...binding, attemptId: receipt.identity.attemptId }
          : binding,
      ),
    },
  );
};

const projectCancellation: ReceiptHandler<"cancel_owner_attempt"> = (
  projection,
  phase,
  receipt,
  retained,
  now,
) => ({
  ...projection,
  phases: projection.phases.map((candidate) =>
    candidate.phaseId === phase.phaseId
      ? {
          ...candidate,
          state: "cancelled",
          leaseHeartbeatAt: now,
          receiptIds: [...candidate.receiptIds, receipt.receiptId],
        }
      : candidate,
  ),
  attempts: projection.attempts.map((attempt) =>
    attempt.attemptId === receipt.identity.attemptId
      ? { ...attempt, state: "terminal_retained", terminalKind: receipt.result.terminalKind }
      : attempt,
  ),
  receipts: retained,
  lastEventAt: now,
});

const projectOwnerAcknowledgement: ReceiptHandler<"acknowledge_owner_result"> = (
  projection,
  phase,
  receipt,
  retained,
  now,
) => {
  const phaseState =
    receipt.identity.ownerKind === "review"
      ? "reviewing"
      : receipt.identity.terminalKind === "succeeded"
        ? "candidate"
        : receipt.identity.terminalKind === "cancelled"
          ? "cancelled"
          : "failed";
  return withReceiptActivity(
    projection,
    receipt,
    retained,
    now,
    receipt.identity.ownerKind === "review"
      ? "Phase coordinator acknowledged the exact retained review OwnerResult."
      : "Phase coordinator acknowledged the exact retained OwnerResult.",
    {
      phases: projection.phases.map((candidate) =>
        candidate.phaseId === phase.phaseId
          ? {
              ...candidate,
              state: phaseState,
              leaseHeartbeatAt: now,
              receiptIds: [...candidate.receiptIds, receipt.receiptId],
            }
          : candidate,
      ),
      attempts: projection.attempts.map((attempt) =>
        attempt.attemptId === receipt.identity.attemptId
          ? {
              ...attempt,
              state: "acknowledged",
              terminalKind: receipt.identity.terminalKind,
              ownerResultId: receipt.identity.ownerResultId,
              resultDigest: receipt.identity.resultDigest,
            }
          : attempt,
      ),
      statusRail: projection.statusRail.map((item) =>
        receipt.identity.ownerKind === "review"
          ? item.stage === "review"
            ? { ...item, state: "active", receiptId: receipt.receiptId }
            : item.stage === "ci"
              ? { ...item, state: "pending" }
              : item
          : item.stage === "execute"
            ? { ...item, state: "settled", receiptId: receipt.receiptId }
            : item.stage === "review" && phaseState === "candidate"
              ? { ...item, state: "active" }
              : item,
      ),
      activeAgentCount: Math.max(0, projection.activeAgentCount - 1),
    },
  );
};

const projectReviewOwner: ReceiptHandler<"launch_review_owner"> = (
  projection,
  phase,
  receipt,
  retained,
  now,
) => {
  const attempt = {
    attemptId: receipt.identity.attemptId,
    phaseId: phase.phaseId,
    ownerKind: "review" as const,
    state: "running" as const,
    threadId: receipt.result.reviewOwnerThreadId,
    terminalKind: null,
    ownerResultId: null,
    resultDigest: null,
  };
  const retainedAttempt = projection.attempts.some(
    (candidate) => candidate.attemptId === attempt.attemptId,
  );
  const bindingExists = projection.threadBindings.some(
    (binding) =>
      binding.threadId === receipt.result.reviewOwnerThreadId && binding.role === "review_owner",
  );
  return withReceiptActivity(
    projection,
    receipt,
    retained,
    now,
    "Immutable candidate review ProgramAttempt launched.",
    {
      phases: projection.phases.map((candidate) =>
        candidate.phaseId === phase.phaseId
          ? {
              ...candidate,
              state: "reviewing",
              activeAttemptId: attempt.attemptId,
              ownerThreadId: receipt.result.reviewOwnerThreadId,
              receiptIds: [...candidate.receiptIds, receipt.receiptId],
            }
          : candidate,
      ),
      attempts: retainedAttempt
        ? projection.attempts.map((candidate) =>
            candidate.attemptId === attempt.attemptId ? attempt : candidate,
          )
        : [...projection.attempts, attempt],
      threadBindings: bindingExists
        ? projection.threadBindings
        : [
            ...projection.threadBindings,
            {
              threadId: receipt.result.reviewOwnerThreadId,
              role: "review_owner",
              phaseId: phase.phaseId,
              attemptId: attempt.attemptId,
            },
          ],
      statusRail: projection.statusRail.map((item) =>
        item.stage === "review" ? { ...item, state: "active", receiptId: receipt.receiptId } : item,
      ),
      activeAgentCount: bindingExists
        ? projection.activeAgentCount
        : projection.activeAgentCount + 1,
    },
  );
};

interface ErasedReceiptHandler {
  readonly apply: (
    projection: ProgramProjection,
    phase: ProgramPhaseProjection,
    receipt: RuntimeReceipt,
    retained: ProgramProjection["receipts"],
    now: string,
  ) => ProgramProjection;
}

function eraseReceiptHandler<K extends ReceiptKind>(
  kind: K,
  handler: ReceiptHandler<K>,
): ErasedReceiptHandler {
  return {
    apply: (projection, phase, receipt, retained, now) => {
      if (receipt.kind !== kind) throw new Error(`Program receipt registry mismatch for ${kind}.`);
      return handler(projection, phase, receipt as ReceiptOf<K>, retained, now);
    },
  };
}

const handlers = new Map<ReceiptKind, ErasedReceiptHandler>([
  [
    "launch_phase_coordinator",
    eraseReceiptHandler("launch_phase_coordinator", projectPhaseCoordinator),
  ],
  [
    "bind_prepared_worktree",
    eraseReceiptHandler("bind_prepared_worktree", projectPreparedWorktree),
  ],
  ["launch_owner_attempt", eraseReceiptHandler("launch_owner_attempt", projectOwnerAttempt)],
  ["cancel_owner_attempt", eraseReceiptHandler("cancel_owner_attempt", projectCancellation)],
  ["launch_review_owner", eraseReceiptHandler("launch_review_owner", projectReviewOwner)],
  [
    "acknowledge_owner_result",
    eraseReceiptHandler("acknowledge_owner_result", projectOwnerAcknowledgement),
  ],
]);

export function applyProgramReceipt(
  projection: ProgramProjection,
  receipt: RuntimeReceipt,
  now: string,
): ProgramProjection {
  if (projection.receipts.some((candidate) => candidate.effectId === receipt.effectId))
    return projection;
  const retained = [...projection.receipts, receipt];
  const phaseId = "phaseId" in receipt.identity ? receipt.identity.phaseId : null;
  if (phaseId === null) return { ...projection, receipts: retained, lastEventAt: now };
  const phase = projection.phases.find((candidate) => candidate.phaseId === phaseId);
  if (phase === undefined) return { ...projection, receipts: retained, lastEventAt: now };
  if (receipt.status !== "succeeded") {
    const attentionReason = `${receipt.kind} ${receipt.status} for ${phase.phaseId}.`;
    return withReceiptActivity(projection, receipt, retained, now, attentionReason, {
      state: "attention_required",
      terminal: false,
      attentionReason,
      allowedCommands: allowedProgramCommands("attention_required"),
      phases: projection.phases.map((candidate) =>
        candidate.phaseId === phase.phaseId
          ? {
              ...candidate,
              state: "attention_required",
              receiptIds: [...candidate.receiptIds, receipt.receiptId],
            }
          : candidate,
      ),
    });
  }
  const handler = handlers.get(receipt.kind);
  return handler === undefined
    ? { ...projection, receipts: retained, lastEventAt: now }
    : handler.apply(projection, phase, receipt, retained, now);
}
