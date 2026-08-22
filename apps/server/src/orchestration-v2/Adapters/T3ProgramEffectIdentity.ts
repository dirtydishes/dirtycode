import {
  OwnerResultAcknowledgement,
  type OrchestrationV2ThreadProjection,
  type ProgramAttemptSnapshot,
  type ProgramEffect,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import { executionError } from "./T3ProgramEffectHandlerTypes.ts";

const decodeOwnerResultAcknowledgement = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OwnerResultAcknowledgement),
);

export function checkoutFor(
  identity: Extract<ProgramEffect, { readonly kind: "bind_prepared_worktree" }>["identity"],
) {
  return {
    repositoryRoot: identity.repositoryRoot,
    gitCommonDir: identity.gitCommonDir,
    worktreePath: identity.realPath,
    branch: identity.symbolicBranch,
    startingCommit: identity.startingCommit,
  };
}

function matchesCheckout(
  left: ReturnType<typeof checkoutFor>,
  right: ReturnType<typeof checkoutFor>,
) {
  return (
    left.repositoryRoot === right.repositoryRoot &&
    left.gitCommonDir === right.gitCommonDir &&
    left.worktreePath === right.worktreePath &&
    left.branch === right.branch &&
    left.startingCommit === right.startingCommit
  );
}

export function matchesPhaseThread(
  effect: Extract<ProgramEffect, { readonly kind: "launch_phase_coordinator" }>,
  projection: OrchestrationV2ThreadProjection,
) {
  const thread = projection.thread;
  return (
    thread.id === effect.identity.phaseCoordinatorThreadId &&
    thread.projectId === effect.identity.projectId &&
    thread.title === effect.identity.threadTitle &&
    thread.modelSelection.instanceId === effect.identity.modelSelection.instanceId &&
    thread.modelSelection.model === effect.identity.modelSelection.model &&
    thread.runtimeMode === effect.identity.runtimeMode &&
    thread.interactionMode === effect.identity.interactionMode &&
    thread.branch === effect.identity.branch &&
    thread.worktreePath === effect.identity.worktreePath &&
    thread.archivedAt === null &&
    thread.deletedAt === null
  );
}

export function matchesOwnerThread(
  effect: Extract<ProgramEffect, { readonly kind: "bind_prepared_worktree" }>,
  projection: OrchestrationV2ThreadProjection,
) {
  const thread = projection.thread;
  return (
    thread.id === effect.identity.ownerThreadId &&
    thread.projectId === effect.identity.projectId &&
    thread.title === effect.identity.ownerThreadTitle &&
    thread.modelSelection.instanceId === effect.identity.modelSelection.instanceId &&
    thread.modelSelection.model === effect.identity.modelSelection.model &&
    thread.runtimeMode === effect.identity.runtimeMode &&
    thread.interactionMode === effect.identity.interactionMode &&
    thread.branch === effect.identity.symbolicBranch &&
    thread.worktreePath === effect.identity.realPath &&
    thread.archivedAt === null &&
    thread.deletedAt === null
  );
}

type OwnerLifecycleIdentity = Extract<
  ProgramEffect,
  { readonly kind: "launch_owner_attempt" | "cancel_owner_attempt" | "acknowledge_owner_result" }
>["identity"];

export function matchesAttemptHierarchy(
  snapshot: ProgramAttemptSnapshot,
  identity: OwnerLifecycleIdentity,
) {
  const expectedAttemptKind =
    "ownerKind" in identity && identity.ownerKind === "review" ? "review" : "task";
  return (
    snapshot.attemptId === identity.attemptId &&
    snapshot.programId === identity.programId &&
    snapshot.taskId === identity.phaseId &&
    snapshot.attemptKind === expectedAttemptKind &&
    snapshot.threadId === identity.ownerThreadId
  );
}

export function matchesAttemptCheckout(
  snapshot: ProgramAttemptSnapshot,
  effect: Extract<
    ProgramEffect,
    { readonly kind: "launch_owner_attempt" | "cancel_owner_attempt" }
  >,
) {
  return (
    snapshot.projectId === effect.identity.preparedWorktree.projectId &&
    matchesCheckout(snapshot.checkout, checkoutFor(effect.identity.preparedWorktree))
  );
}

function matchesOwnerResultAcknowledgement(
  acknowledgement: OwnerResultAcknowledgement,
  effect: Extract<ProgramEffect, { readonly kind: "acknowledge_owner_result" }>,
) {
  return (
    acknowledgement.ownerResultId === effect.identity.ownerResultId &&
    acknowledgement.programId === effect.identity.programId &&
    acknowledgement.phaseId === effect.identity.phaseId &&
    acknowledgement.phaseCoordinatorThreadId === effect.identity.phaseCoordinatorThreadId &&
    acknowledgement.ownerThreadId === effect.identity.ownerThreadId &&
    acknowledgement.attemptId === effect.identity.attemptId &&
    acknowledgement.resultDigest === effect.identity.resultDigest &&
    acknowledgement.leaseId === effect.identity.leaseId &&
    acknowledgement.leaseEpoch === effect.identity.leaseEpoch &&
    acknowledgement.accepted
  );
}

export function readCoordinatorAcknowledgement(
  projection: OrchestrationV2ThreadProjection,
  runId: string,
  effect: Extract<ProgramEffect, { readonly kind: "acknowledge_owner_result" }>,
  context: ProgramEffectExecutorContext,
) {
  if (projection.thread.id !== effect.identity.phaseCoordinatorThreadId) {
    return Effect.fail(
      executionError(effect, context, "Phase coordinator thread identity does not match."),
    );
  }
  const candidates = projection.turnItems
    .filter(
      (item) =>
        item.type === "assistant_message" && item.status === "completed" && item.runId === runId,
    )
    .toSorted((left, right) => right.ordinal - left.ordinal);
  return Effect.gen(function* () {
    for (const candidate of candidates) {
      if (candidate.type !== "assistant_message") continue;
      const decoded = yield* decodeOwnerResultAcknowledgement(candidate.text).pipe(Effect.option);
      if (Option.isSome(decoded) && matchesOwnerResultAcknowledgement(decoded.value, effect))
        return decoded.value;
    }
    return yield* executionError(
      effect,
      context,
      "Phase coordinator did not return the exact typed OwnerResult acknowledgement.",
    );
  });
}
