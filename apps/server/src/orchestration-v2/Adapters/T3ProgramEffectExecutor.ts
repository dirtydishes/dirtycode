import { createHash } from "node:crypto";

import {
  CommandId,
  ProgramAttemptRequestId,
  type OrchestrationV2ThreadProjection,
  type ProgramAttemptSnapshot,
  type ProgramEffect,
  type RuntimeReceipt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { CommandReceiptStoreV2Shape } from "../CommandReceiptStore.ts";
import {
  ProgramEffectExecutionError,
  type ProgramEffectExecutor,
  type ProgramEffectExecutorContext,
} from "../ProgramEffectExecutor.ts";
import * as ProgramAttemptService from "../ProgramAttemptService.ts";
import { makeProgramOwnerResult } from "../ProgramOwnerResult.ts";
import * as PreparedWorktreeVerifier from "../PreparedWorktreeVerifier.ts";
import * as ThreadLaunchService from "../ThreadLaunchService.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";

const isProgramEffectExecutionError = Schema.is(ProgramEffectExecutionError);
const isProgramAttemptNotFound = Schema.is(ProgramAttemptService.ProgramAttemptNotFoundError);

export interface T3ProgramMutableServices {
  readonly launches: Pick<ThreadLaunchService.ThreadLaunchService["Service"], "launch">;
  readonly preparedWorktrees: Pick<
    PreparedWorktreeVerifier.PreparedWorktreeVerifier["Service"],
    "verify"
  >;
  readonly attempts: Pick<
    ProgramAttemptService.ProgramAttemptService["Service"],
    "launch" | "observe" | "cancel" | "acknowledge"
  >;
}

function executionError(
  effect: ProgramEffect,
  context: ProgramEffectExecutorContext,
  cause: unknown,
) {
  return new ProgramEffectExecutionError({
    programId: context.programId,
    effectId: effect.effectId,
    cause,
  });
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function receiptBase(effect: ProgramEffect, context: ProgramEffectExecutorContext) {
  return {
    receiptId: context.receiptId,
    programId: context.programId,
    programRevision: context.programRevision,
    effectId: effect.effectId,
    requestId: context.requestId,
    status: "succeeded" as const,
    resultDigest: digest({ effectId: effect.effectId, kind: effect.kind }),
    createdAt: context.now,
    acknowledged: false,
  };
}

function phaseReceipt(
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

function bindReceipt(
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

function attemptReceipt(
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

function cancelReceipt(
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

function acknowledgementReceipt(
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

function matchesPhaseThread(
  effect: Extract<ProgramEffect, { readonly kind: "launch_phase_coordinator" }>,
  projection: OrchestrationV2ThreadProjection,
): boolean {
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

function matchesOwnerThread(
  effect: Extract<ProgramEffect, { readonly kind: "bind_prepared_worktree" }>,
  projection: OrchestrationV2ThreadProjection,
): boolean {
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

function checkoutFor(
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
): boolean {
  return (
    left.repositoryRoot === right.repositoryRoot &&
    left.gitCommonDir === right.gitCommonDir &&
    left.worktreePath === right.worktreePath &&
    left.branch === right.branch &&
    left.startingCommit === right.startingCommit
  );
}

type OwnerLifecycleIdentity =
  | Extract<ProgramEffect, { readonly kind: "launch_owner_attempt" }>["identity"]
  | Extract<ProgramEffect, { readonly kind: "cancel_owner_attempt" }>["identity"]
  | Extract<ProgramEffect, { readonly kind: "acknowledge_owner_result" }>["identity"];

function matchesAttemptHierarchy(
  snapshot: ProgramAttemptSnapshot,
  identity: OwnerLifecycleIdentity,
): boolean {
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

function matchesAttemptCheckout(
  snapshot: ProgramAttemptSnapshot,
  effect: Extract<
    ProgramEffect,
    { readonly kind: "launch_owner_attempt" | "cancel_owner_attempt" }
  >,
): boolean {
  return (
    snapshot.projectId === effect.identity.preparedWorktree.projectId &&
    matchesCheckout(snapshot.checkout, checkoutFor(effect.identity.preparedWorktree))
  );
}

function matchesOwnerResult(
  observed: NonNullable<ReturnType<typeof makeProgramOwnerResult>>,
  effect: Extract<ProgramEffect, { readonly kind: "acknowledge_owner_result" }>,
): boolean {
  const expected = effect.identity;
  return (
    observed.ownerResultId === expected.ownerResultId &&
    observed.programId === expected.programId &&
    observed.phaseId === expected.phaseId &&
    observed.phaseCoordinatorThreadId === expected.phaseCoordinatorThreadId &&
    observed.ownerThreadId === expected.ownerThreadId &&
    observed.attemptId === expected.attemptId &&
    observed.ownerKind === expected.ownerKind &&
    observed.terminalKind === expected.terminalKind &&
    observed.resultDigest === expected.resultDigest &&
    observed.evidence.length === expected.evidence.length &&
    observed.evidence.every((item, index) => {
      const candidate = expected.evidence[index];
      return (
        candidate !== undefined &&
        item.kind === candidate.kind &&
        item.id === candidate.id &&
        item.label === candidate.label &&
        item.href === candidate.href &&
        item.digest === candidate.digest
      );
    })
  );
}

function rejectExpiredLease(effect: ProgramEffect, context: ProgramEffectExecutorContext) {
  const expiresAt =
    effect.kind === "bind_prepared_worktree" || effect.kind === "acknowledge_owner_result"
      ? effect.identity.expiresAt
      : effect.kind === "launch_owner_attempt" || effect.kind === "cancel_owner_attempt"
        ? effect.identity.preparedWorktree.expiresAt
        : null;
  if (expiresAt !== null && Date.parse(context.now) >= Date.parse(expiresAt)) {
    return Effect.fail(executionError(effect, context, "The dirtyloops mutation lease expired."));
  }
  return Effect.void;
}

function terminalKindForCancel(status: string) {
  if (status === "cancelled") return "cancelled" as const;
  if (status === "interrupted") return "t3_restart_interrupted" as const;
  if (status === "completed") return "succeeded" as const;
  return "failed" as const;
}

export function makeT3ProgramEffectExecutor(
  threads: Pick<ThreadManagementServiceShape, "dispatch" | "getThreadProjection">,
  commandReceipts: Pick<CommandReceiptStoreV2Shape, "getByCommandId">,
  mutable?: T3ProgramMutableServices,
): ProgramEffectExecutor {
  const observePhase = (
    effect: Extract<ProgramEffect, { readonly kind: "launch_phase_coordinator" }>,
    context: ProgramEffectExecutorContext,
  ) => {
    const commandId = CommandId.make(`command:${effect.effectId}`);
    return commandReceipts.getByCommandId(commandId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none<RuntimeReceipt>()),
          onSome: (receipt) =>
            receipt.status !== "accepted" ||
            receipt.commandType !== "thread.create" ||
            receipt.threadId !== effect.identity.phaseCoordinatorThreadId
              ? Effect.fail(
                  executionError(effect, context, "T3 command receipt identity does not match."),
                )
              : threads
                  .getThreadProjection(effect.identity.phaseCoordinatorThreadId)
                  .pipe(
                    Effect.flatMap((projection) =>
                      matchesPhaseThread(effect, projection)
                        ? Effect.succeed(Option.some(phaseReceipt(effect, context)))
                        : Effect.fail(
                            executionError(
                              effect,
                              context,
                              "Created thread is unavailable or its identity does not match.",
                            ),
                          ),
                    ),
                  ),
        }),
      ),
    );
  };

  const observeBind = (
    effect: Extract<ProgramEffect, { readonly kind: "bind_prepared_worktree" }>,
    context: ProgramEffectExecutorContext,
  ) => {
    const commandId = CommandId.make(`program-effect:${effect.effectId}:bind`);
    return commandReceipts.getByCommandId(commandId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none<RuntimeReceipt>()),
          onSome: (receipt) =>
            receipt.status !== "accepted" ||
            receipt.commandType !== "thread.create" ||
            receipt.threadId !== effect.identity.ownerThreadId
              ? Effect.fail(
                  executionError(effect, context, "Owner thread receipt identity does not match."),
                )
              : threads
                  .getThreadProjection(effect.identity.ownerThreadId)
                  .pipe(
                    Effect.flatMap((projection) =>
                      matchesOwnerThread(effect, projection)
                        ? Effect.succeed(Option.some(bindReceipt(effect, context)))
                        : Effect.fail(
                            executionError(
                              effect,
                              context,
                              "Bound owner thread identity does not match.",
                            ),
                          ),
                    ),
                  ),
        }),
      ),
    );
  };

  const observeAttempt = (
    effect: Extract<ProgramEffect, { readonly kind: "launch_owner_attempt" }>,
    context: ProgramEffectExecutorContext,
  ) =>
    mutable!.attempts.observe(effect.identity.attemptId).pipe(
      Effect.flatMap((snapshot) =>
        matchesAttemptHierarchy(snapshot, effect.identity) &&
        matchesAttemptCheckout(snapshot, effect)
          ? Effect.succeed(Option.some(attemptReceipt(effect, context, snapshot.runId)))
          : Effect.fail(executionError(effect, context, "ProgramAttempt identity does not match.")),
      ),
      Effect.catchIf(isProgramAttemptNotFound, () => Effect.succeed(Option.none())),
    );

  const observeAcknowledgement = (
    effect: Extract<ProgramEffect, { readonly kind: "acknowledge_owner_result" }>,
    context: ProgramEffectExecutorContext,
  ) =>
    mutable!.attempts.observe(effect.identity.attemptId).pipe(
      Effect.flatMap((snapshot) =>
        !matchesAttemptHierarchy(snapshot, effect.identity)
          ? Effect.fail(executionError(effect, context, "ProgramAttempt identity does not match."))
          : snapshot.terminalAcknowledged
            ? Effect.succeed(Option.some(acknowledgementReceipt(effect, context)))
            : Effect.succeed(Option.none()),
      ),
      Effect.catchIf(isProgramAttemptNotFound, () => Effect.succeed(Option.none())),
    );

  const observeCancellation = (
    effect: Extract<ProgramEffect, { readonly kind: "cancel_owner_attempt" }>,
    context: ProgramEffectExecutorContext,
  ) =>
    mutable!.attempts.observe(effect.identity.attemptId).pipe(
      Effect.flatMap((snapshot) =>
        !matchesAttemptHierarchy(snapshot, effect.identity) ||
        !matchesAttemptCheckout(snapshot, effect)
          ? Effect.fail(executionError(effect, context, "ProgramAttempt identity does not match."))
          : Effect.succeed(
              snapshot.terminalResult !== null || snapshot.terminalAcknowledged
                ? Option.some(
                    cancelReceipt(effect, context, terminalKindForCancel(snapshot.runStatus)),
                  )
                : Option.none(),
            ),
      ),
      Effect.catchIf(isProgramAttemptNotFound, () => Effect.succeed(Option.none())),
    );

  const observe: ProgramEffectExecutor["observe"] = (effect, context) => {
    const mapError = (error: unknown) =>
      isProgramEffectExecutionError(error) ? error : executionError(effect, context, error);
    switch (effect.kind) {
      case "launch_phase_coordinator":
        return observePhase(effect, context).pipe(Effect.mapError(mapError));
      case "bind_prepared_worktree":
        return mutable === undefined
          ? Effect.fail(
              executionError(effect, context, "Mutable Program services are unavailable."),
            )
          : observeBind(effect, context).pipe(Effect.mapError(mapError));
      case "launch_owner_attempt":
        return mutable === undefined
          ? Effect.fail(
              executionError(effect, context, "Mutable Program services are unavailable."),
            )
          : observeAttempt(effect, context).pipe(Effect.mapError(mapError));
      case "acknowledge_owner_result":
        return mutable === undefined
          ? Effect.fail(
              executionError(effect, context, "Mutable Program services are unavailable."),
            )
          : observeAcknowledgement(effect, context).pipe(Effect.mapError(mapError));
      case "cancel_owner_attempt":
        return mutable === undefined
          ? Effect.fail(
              executionError(effect, context, "Mutable Program services are unavailable."),
            )
          : observeCancellation(effect, context).pipe(Effect.mapError(mapError));
      case "launch_review_owner":
      case "deliver_phase_callback":
      case "acknowledge_phase_callback":
      case "update_goal":
      case "clear_goal":
        return Effect.succeed(Option.none());
    }
  };

  const execute: ProgramEffectExecutor["execute"] = (effect, context) =>
    Effect.gen(function* () {
      yield* rejectExpiredLease(effect, context);
      switch (effect.kind) {
        case "launch_phase_coordinator":
          return yield* threads
            .dispatch({
              type: "thread.create",
              createdBy: "system",
              creationSource: "server",
              commandId: CommandId.make(`command:${effect.effectId}`),
              threadId: effect.identity.phaseCoordinatorThreadId,
              projectId: effect.identity.projectId,
              title: effect.identity.threadTitle,
              modelSelection: effect.identity.modelSelection,
              runtimeMode: effect.identity.runtimeMode,
              interactionMode: effect.identity.interactionMode,
              branch: effect.identity.branch,
              worktreePath: effect.identity.worktreePath,
            })
            .pipe(
              Effect.flatMap(() => observePhase(effect, context)),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      executionError(
                        effect,
                        context,
                        "Thread create returned without a projection.",
                      ),
                    ),
                  onSome: Effect.succeed,
                }),
              ),
            );
        case "bind_prepared_worktree":
          if (mutable === undefined) {
            return yield* executionError(
              effect,
              context,
              "Mutable Program services are unavailable.",
            );
          }
          return yield* mutable.preparedWorktrees
            .verify(checkoutFor(effect.identity), effect.identity.repositoryRoot)
            .pipe(
              Effect.andThen(
                mutable.launches.launch({
                  commandId: CommandId.make(`program-effect:${effect.effectId}:bind`),
                  threadId: effect.identity.ownerThreadId,
                  projectId: effect.identity.projectId,
                  title: effect.identity.ownerThreadTitle,
                  generateTitle: false,
                  modelSelection: effect.identity.modelSelection,
                  runtimeMode: effect.identity.runtimeMode,
                  interactionMode: effect.identity.interactionMode,
                  workspaceStrategy: {
                    type: "prepared_worktree",
                    ...checkoutFor(effect.identity),
                  },
                  createdBy: "system",
                  creationSource: "server",
                }),
              ),
              Effect.flatMap(() => observeBind(effect, context)),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      executionError(
                        effect,
                        context,
                        "Owner bind returned without a durable receipt.",
                      ),
                    ),
                  onSome: Effect.succeed,
                }),
              ),
            );
        case "launch_owner_attempt":
          if (mutable === undefined) {
            return yield* executionError(
              effect,
              context,
              "Mutable Program services are unavailable.",
            );
          }
          return yield* mutable.attempts
            .launch({
              attemptId: effect.identity.attemptId,
              requestId: ProgramAttemptRequestId.make(`program-effect:${effect.effectId}:launch`),
              threadId: effect.identity.ownerThreadId,
              programId: effect.identity.programId,
              taskId: effect.identity.phaseId,
              attemptKind: "task",
              projectId: effect.identity.preparedWorktree.projectId,
              title: effect.identity.preparedWorktree.ownerThreadTitle,
              prompt: effect.identity.prompt,
              checkout: checkoutFor(effect.identity.preparedWorktree),
              providerPolicy: effect.identity.providerPolicy,
            })
            .pipe(Effect.map((snapshot) => attemptReceipt(effect, context, snapshot.runId)));
        case "cancel_owner_attempt":
          if (mutable === undefined) {
            return yield* executionError(
              effect,
              context,
              "Mutable Program services are unavailable.",
            );
          }
          return yield* Effect.gen(function* () {
            const snapshot = yield* mutable.attempts.observe(effect.identity.attemptId);
            if (
              !matchesAttemptHierarchy(snapshot, effect.identity) ||
              !matchesAttemptCheckout(snapshot, effect)
            ) {
              return yield* executionError(
                effect,
                context,
                "ProgramAttempt identity does not match.",
              );
            }
            const cancelled = yield* mutable.attempts.cancel({
              attemptId: effect.identity.attemptId,
              requestId: ProgramAttemptRequestId.make(`program-effect:${effect.effectId}:cancel`),
              reason: "dirtyloops requested a fenced Program Attempt cancellation.",
            });
            return cancelReceipt(effect, context, terminalKindForCancel(cancelled.runStatus));
          });
        case "acknowledge_owner_result":
          if (mutable === undefined) {
            return yield* executionError(
              effect,
              context,
              "Mutable Program services are unavailable.",
            );
          }
          return yield* Effect.gen(function* () {
            const snapshot = yield* mutable.attempts.observe(effect.identity.attemptId);
            if (!matchesAttemptHierarchy(snapshot, effect.identity)) {
              return yield* executionError(
                effect,
                context,
                "ProgramAttempt identity does not match.",
              );
            }
            const observed = makeProgramOwnerResult({
              programId: effect.identity.programId,
              phaseId: effect.identity.phaseId,
              phaseCoordinatorThreadId: effect.identity.phaseCoordinatorThreadId,
              ownerKind: effect.identity.ownerKind,
              snapshot,
            });
            if (observed === null || !matchesOwnerResult(observed, effect)) {
              return yield* executionError(
                effect,
                context,
                "OwnerResult identity or evidence does not match the retained Attempt result.",
              );
            }
            yield* mutable.attempts.acknowledge({
              attemptId: effect.identity.attemptId,
              requestId: ProgramAttemptRequestId.make(
                `program-effect:${effect.effectId}:acknowledge`,
              ),
            });
            return acknowledgementReceipt(effect, context);
          });
        case "launch_review_owner":
        case "deliver_phase_callback":
        case "acknowledge_phase_callback":
        case "update_goal":
        case "clear_goal":
          return yield* executionError(
            effect,
            context,
            `Slice 3 does not implement ${effect.kind}.`,
          );
      }
    }).pipe(
      Effect.mapError((error) =>
        isProgramEffectExecutionError(error) ? error : executionError(effect, context, error),
      ),
    );

  return { observe, execute };
}
