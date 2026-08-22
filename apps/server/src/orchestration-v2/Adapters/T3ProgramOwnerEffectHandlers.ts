import {
  CommandId,
  MessageId,
  OwnerResult as OwnerResultSchema,
  ProgramAttemptRequestId,
  type OwnerResult,
  type ProgramEffect,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProgramAttemptService from "../ProgramAttemptService.ts";
import { makeProgramOwnerResult } from "../ProgramOwnerResult.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import {
  acknowledgementReceipt,
  attemptReceipt,
  cancelReceipt,
} from "./T3ProgramEffectReceipts.ts";
import {
  checkoutFor,
  matchesAttemptCheckout,
  matchesAttemptHierarchy,
  readCoordinatorAcknowledgement,
} from "./T3ProgramEffectIdentity.ts";
import {
  executionError,
  mapExecutionError,
  rejectExpiredLease,
  type T3ProgramEffectClock,
  type T3ProgramEffectHandler,
} from "./T3ProgramEffectHandlerTypes.ts";

type Attempts = Pick<
  ProgramAttemptService.ProgramAttemptService["Service"],
  "launch" | "observe" | "cancel" | "acknowledge"
>;

const isProgramAttemptNotFound = Schema.is(ProgramAttemptService.ProgramAttemptNotFoundError);
const encodeOwnerResult = Schema.encodeSync(Schema.fromJsonString(OwnerResultSchema));

function terminalKindForCancel(status: string) {
  if (status === "cancelled") return "cancelled" as const;
  if (status === "interrupted") return "t3_restart_interrupted" as const;
  if (status === "completed") return "succeeded" as const;
  return "failed" as const;
}

export function makeLaunchOwnerAttemptHandler({
  attempts,
  clock,
}: {
  readonly attempts: Attempts;
  readonly clock: T3ProgramEffectClock;
}): T3ProgramEffectHandler<"launch_owner_attempt"> {
  const observe: T3ProgramEffectHandler<"launch_owner_attempt">["observe"] = (effect, context) =>
    attempts.observe(effect.identity.attemptId).pipe(
      Effect.flatMap((snapshot) =>
        matchesAttemptHierarchy(snapshot, effect.identity) &&
        matchesAttemptCheckout(snapshot, effect)
          ? Effect.succeed(Option.some(attemptReceipt(effect, context, snapshot.runId)))
          : Effect.fail(executionError(effect, context, "ProgramAttempt identity does not match.")),
      ),
      Effect.catchIf(isProgramAttemptNotFound, () => Effect.succeed(Option.none())),
      Effect.mapError((error) => mapExecutionError(effect, context, error)),
    );

  const execute: T3ProgramEffectHandler<"launch_owner_attempt">["execute"] = (effect, context) =>
    Effect.gen(function* () {
      yield* rejectExpiredLease(effect, context, yield* clock.now);
      const snapshot = yield* attempts.launch({
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
      });
      return attemptReceipt(effect, context, snapshot.runId);
    }).pipe(Effect.mapError((error) => mapExecutionError(effect, context, error)));

  return { observe, execute };
}

export function makeCancelOwnerAttemptHandler({
  attempts,
}: {
  readonly attempts: Attempts;
}): T3ProgramEffectHandler<"cancel_owner_attempt"> {
  const observe: T3ProgramEffectHandler<"cancel_owner_attempt">["observe"] = (effect, context) =>
    attempts.observe(effect.identity.attemptId).pipe(
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
      Effect.mapError((error) => mapExecutionError(effect, context, error)),
    );

  const execute: T3ProgramEffectHandler<"cancel_owner_attempt">["execute"] = (effect, context) =>
    Effect.gen(function* () {
      const snapshot = yield* attempts.observe(effect.identity.attemptId);
      if (
        !matchesAttemptHierarchy(snapshot, effect.identity) ||
        !matchesAttemptCheckout(snapshot, effect)
      ) {
        return yield* executionError(effect, context, "ProgramAttempt identity does not match.");
      }
      const cancelled = yield* attempts.cancel({
        attemptId: effect.identity.attemptId,
        requestId: ProgramAttemptRequestId.make(`program-effect:${effect.effectId}:cancel`),
        reason: "dirtyloops requested a fenced Program Attempt cancellation.",
      });
      return cancelReceipt(effect, context, terminalKindForCancel(cancelled.runStatus));
    }).pipe(Effect.mapError((error) => mapExecutionError(effect, context, error)));

  return { observe, execute };
}

function ownerResultForDelivery(
  effect: Extract<ProgramEffect, { readonly kind: "acknowledge_owner_result" }>,
): OwnerResult {
  return {
    ownerResultId: effect.identity.ownerResultId,
    programId: effect.identity.programId,
    phaseId: effect.identity.phaseId,
    phaseCoordinatorThreadId: effect.identity.phaseCoordinatorThreadId,
    ownerThreadId: effect.identity.ownerThreadId,
    attemptId: effect.identity.attemptId,
    ownerKind: effect.identity.ownerKind,
    terminalKind: effect.identity.terminalKind,
    resultDigest: effect.identity.resultDigest,
    evidence: effect.identity.evidence,
  };
}

function matchesOwnerResult(
  observed: NonNullable<ReturnType<typeof makeProgramOwnerResult>>,
  effect: Extract<ProgramEffect, { readonly kind: "acknowledge_owner_result" }>,
) {
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

export function makeAcknowledgeOwnerResultHandler({
  threads,
  attempts,
}: {
  readonly threads: Pick<
    ThreadManagementServiceShape,
    "getThreadProjection" | "sendToThread" | "waitForThread"
  >;
  readonly attempts: Attempts;
}): T3ProgramEffectHandler<"acknowledge_owner_result"> {
  const observe: T3ProgramEffectHandler<"acknowledge_owner_result">["observe"] = (
    effect,
    context,
  ) =>
    attempts.observe(effect.identity.attemptId).pipe(
      Effect.flatMap((snapshot) =>
        !matchesAttemptHierarchy(snapshot, effect.identity)
          ? Effect.fail(executionError(effect, context, "ProgramAttempt identity does not match."))
          : snapshot.terminalAcknowledged
            ? Effect.succeed(Option.some(acknowledgementReceipt(effect, context)))
            : Effect.succeed(Option.none()),
      ),
      Effect.catchIf(isProgramAttemptNotFound, () => Effect.succeed(Option.none())),
      Effect.mapError((error) => mapExecutionError(effect, context, error)),
    );

  const execute: T3ProgramEffectHandler<"acknowledge_owner_result">["execute"] = (
    effect,
    context,
  ) =>
    Effect.gen(function* () {
      const snapshot = yield* attempts.observe(effect.identity.attemptId);
      if (!matchesAttemptHierarchy(snapshot, effect.identity)) {
        return yield* executionError(effect, context, "ProgramAttempt identity does not match.");
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
      const coordinator = yield* threads.getThreadProjection(
        effect.identity.phaseCoordinatorThreadId,
      );
      const sent = yield* threads.sendToThread({
        projectId: coordinator.thread.projectId,
        commandId: CommandId.make(`program-effect:${effect.effectId}:coordinator-ack`),
        threadId: effect.identity.phaseCoordinatorThreadId,
        messageId: MessageId.make(`program-effect:${effect.effectId}:owner-result`),
        text: encodeOwnerResult(ownerResultForDelivery(effect)),
        attachments: [],
        mode: "auto",
        createdBy: "system",
        creationSource: "server",
      });
      const waited = yield* threads.waitForThread({
        projectId: coordinator.thread.projectId,
        threadId: effect.identity.phaseCoordinatorThreadId,
        runId: sent.run.id,
        timeoutMs: 120_000,
      });
      if (waited.timedOut || waited.run === null || waited.run.status !== "completed") {
        return yield* executionError(
          effect,
          context,
          "Phase coordinator acknowledgement run did not complete.",
        );
      }
      const settledCoordinator = yield* threads.getThreadProjection(
        effect.identity.phaseCoordinatorThreadId,
      );
      yield* readCoordinatorAcknowledgement(settledCoordinator, sent.run.id, effect, context);
      yield* attempts.acknowledge({
        attemptId: effect.identity.attemptId,
        requestId: ProgramAttemptRequestId.make(`program-effect:${effect.effectId}:acknowledge`),
      });
      return acknowledgementReceipt(effect, context);
    }).pipe(Effect.mapError((error) => mapExecutionError(effect, context, error)));

  return { observe, execute };
}
