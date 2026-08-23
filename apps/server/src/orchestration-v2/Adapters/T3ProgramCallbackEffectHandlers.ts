import {
  CommandId,
  MessageId,
  PhaseCallback,
  PhaseCallbackAcknowledgement,
  type OrchestrationV2ThreadProjection,
  type RuntimeReceipt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import { callbackReceipt } from "./T3ProgramEffectReceipts.ts";
import {
  executionError,
  mapExecutionError,
  type EffectOf,
  type T3ProgramEffectHandler,
} from "./T3ProgramEffectHandlerTypes.ts";

type CallbackKind = "deliver_phase_callback" | "acknowledge_phase_callback";
type CallbackEffect = EffectOf<"deliver_phase_callback"> | EffectOf<"acknowledge_phase_callback">;
type Threads = Pick<
  ThreadManagementServiceShape,
  "getThreadProjection" | "sendToThread" | "waitForThread"
>;

const encodeCallback = Schema.encodeSync(Schema.fromJsonString(PhaseCallback));
const decodeAcknowledgement = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PhaseCallbackAcknowledgement),
);

function matchesAcknowledgement(
  acknowledgement: PhaseCallbackAcknowledgement,
  effect: CallbackEffect,
) {
  const identity = effect.identity;
  return (
    acknowledgement.programId === identity.programId &&
    acknowledgement.phaseId === identity.phaseId &&
    acknowledgement.phaseCoordinatorThreadId === identity.phaseCoordinatorThreadId &&
    acknowledgement.programCoordinatorThreadId === identity.programCoordinatorThreadId &&
    acknowledgement.sourceThreadId === identity.sourceThreadId &&
    acknowledgement.phaseCallbackId === identity.phaseCallbackId &&
    acknowledgement.nonce === identity.nonce &&
    acknowledgement.candidateCommit === identity.candidateCommit &&
    acknowledgement.disposition === identity.disposition &&
    acknowledgement.accepted
  );
}

const findAcknowledgement = Effect.fn("T3ProgramCallbackEffectHandlers.findAcknowledgement")(
  function* (
    projection: OrchestrationV2ThreadProjection,
    effect: CallbackEffect,
    context: ProgramEffectExecutorContext,
    runId?: string,
  ) {
    if (projection.thread.id !== effect.identity.programCoordinatorThreadId) {
      return yield* executionError(
        effect,
        context,
        "Program coordinator thread identity does not match.",
      );
    }
    const candidates = projection.turnItems
      .filter(
        (item) =>
          item.type === "assistant_message" &&
          item.status === "completed" &&
          (runId === undefined || item.runId === runId),
      )
      .toSorted((left, right) => right.ordinal - left.ordinal);
    for (const candidate of candidates) {
      if (candidate.type !== "assistant_message") continue;
      const decoded = yield* decodeAcknowledgement(candidate.text).pipe(Effect.option);
      if (Option.isSome(decoded) && matchesAcknowledgement(decoded.value, effect)) {
        return Option.some(decoded.value);
      }
    }
    return Option.none<PhaseCallbackAcknowledgement>();
  },
);

const requireAcknowledgement = Effect.fn("T3ProgramCallbackEffectHandlers.requireAcknowledgement")(
  function* (
    projection: OrchestrationV2ThreadProjection,
    effect: CallbackEffect,
    context: ProgramEffectExecutorContext,
    runId?: string,
  ) {
    const acknowledgement = yield* findAcknowledgement(projection, effect, context, runId);
    if (Option.isNone(acknowledgement)) {
      return yield* executionError(
        effect,
        context,
        "Program coordinator did not return the exact typed Phase callback acknowledgement.",
      );
    }
    return acknowledgement.value;
  },
);

export function makePhaseCallbackHandler<K extends CallbackKind>(
  kind: K,
  threads: Threads,
): T3ProgramEffectHandler<K> {
  const observe: T3ProgramEffectHandler<K>["observe"] = (effect, context) => {
    const callbackEffect = effect as CallbackEffect;
    return threads.getThreadProjection(callbackEffect.identity.programCoordinatorThreadId).pipe(
      Effect.flatMap((projection) => findAcknowledgement(projection, callbackEffect, context)),
      Effect.map(Option.map(() => callbackReceipt(effect, context) as RuntimeReceipt)),
      Effect.mapError((error) => mapExecutionError(effect, context, error)),
    );
  };

  const execute: T3ProgramEffectHandler<K>["execute"] = (effect, context) => {
    const callbackEffect = effect as CallbackEffect;
    return kind === "acknowledge_phase_callback"
      ? threads.getThreadProjection(callbackEffect.identity.programCoordinatorThreadId).pipe(
          Effect.flatMap((projection) =>
            requireAcknowledgement(projection, callbackEffect, context),
          ),
          Effect.as(callbackReceipt(effect, context)),
          Effect.mapError((error) => mapExecutionError(effect, context, error)),
        )
      : Effect.gen(function* () {
          const coordinator = yield* threads.getThreadProjection(
            callbackEffect.identity.programCoordinatorThreadId,
          );
          const sent = yield* threads.sendToThread({
            projectId: coordinator.thread.projectId,
            commandId: CommandId.make(`program-effect:${callbackEffect.effectId}:phase-callback`),
            threadId: callbackEffect.identity.programCoordinatorThreadId,
            messageId: MessageId.make(`program-effect:${callbackEffect.effectId}:phase-callback`),
            text: encodeCallback({ kind: "phase_callback", ...callbackEffect.identity }),
            attachments: [],
            mode: "auto",
            createdBy: "system",
            creationSource: "server",
          });
          const waited = yield* threads.waitForThread({
            projectId: coordinator.thread.projectId,
            threadId: callbackEffect.identity.programCoordinatorThreadId,
            runId: sent.run.id,
            timeoutMs: 120_000,
          });
          if (waited.timedOut || waited.run === null || waited.run.status !== "completed") {
            return yield* executionError(
              effect,
              context,
              "Program coordinator callback acknowledgement run did not complete.",
            );
          }
          const settled = yield* threads.getThreadProjection(
            callbackEffect.identity.programCoordinatorThreadId,
          );
          yield* requireAcknowledgement(settled, callbackEffect, context, sent.run.id);
          return callbackReceipt(effect, context);
        }).pipe(Effect.mapError((error) => mapExecutionError(effect, context, error)));
  };

  return { observe, execute };
}
