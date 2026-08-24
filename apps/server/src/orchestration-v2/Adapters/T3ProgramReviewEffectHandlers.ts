import { ProgramAttemptRequestId, type RuntimeReceipt } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProgramAttemptService from "../ProgramAttemptService.ts";
import { reviewReceipt } from "./T3ProgramEffectReceipts.ts";
import { checkoutFor, matchesReviewAttempt } from "./T3ProgramEffectIdentity.ts";
import {
  executionError,
  mapExecutionError,
  type T3ProgramEffectHandler,
} from "./T3ProgramEffectHandlerTypes.ts";

type Attempts = Pick<ProgramAttemptService.ProgramAttemptService["Service"], "launch" | "observe">;

const isProgramAttemptNotFound = Schema.is(ProgramAttemptService.ProgramAttemptNotFoundError);

export function makeLaunchReviewOwnerHandler({
  attempts,
}: {
  readonly attempts: Attempts;
}): T3ProgramEffectHandler<"launch_review_owner"> {
  const observe: T3ProgramEffectHandler<"launch_review_owner">["observe"] = (effect, context) =>
    attempts.observe(effect.identity.attemptId).pipe(
      Effect.flatMap((snapshot) =>
        matchesReviewAttempt(snapshot, effect.identity)
          ? Effect.succeed(
              Option.some<RuntimeReceipt>(reviewReceipt(effect, context, snapshot.runId)),
            )
          : Effect.fail(
              executionError(effect, context, "Review ProgramAttempt identity does not match."),
            ),
      ),
      Effect.catchIf(isProgramAttemptNotFound, () => Effect.succeed(Option.none<RuntimeReceipt>())),
      Effect.mapError((error) => mapExecutionError(effect, context, error)),
    );

  const execute: T3ProgramEffectHandler<"launch_review_owner">["execute"] = (effect, context) =>
    attempts
      .launch({
        attemptId: effect.identity.attemptId,
        requestId: ProgramAttemptRequestId.make(`program-effect:${effect.effectId}:launch`),
        threadId: effect.identity.reviewOwnerThreadId,
        programId: effect.identity.programId,
        taskId: effect.identity.phaseId,
        attemptKind: "review",
        candidateId: effect.identity.candidateId,
        reviewId: effect.identity.reviewId,
        reviewKind: effect.identity.reviewKind,
        projectId: effect.identity.projectId,
        title: effect.identity.title,
        prompt: effect.identity.prompt,
        checkout: checkoutFor(effect.identity.preparedWorktree),
        providerPolicy: effect.identity.providerPolicy,
      })
      .pipe(
        Effect.flatMap((snapshot) =>
          matchesReviewAttempt(snapshot, effect.identity)
            ? Effect.succeed(reviewReceipt(effect, context, snapshot.runId))
            : Effect.fail(
                executionError(
                  effect,
                  context,
                  "Launched review ProgramAttempt identity does not match.",
                ),
              ),
        ),
        Effect.mapError((error) => mapExecutionError(effect, context, error)),
      );

  return { observe, execute };
}
