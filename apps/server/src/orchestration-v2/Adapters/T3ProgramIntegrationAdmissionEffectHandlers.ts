import {
  CommandId,
  IntegrationAdmissionAcknowledgement,
  IntegrationAdmissionRequest,
  MessageId,
  type OrchestrationV2ThreadProjection,
  type RuntimeReceipt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import { integrationAdmissionReceipt } from "./T3ProgramEffectReceipts.ts";
import {
  executionError,
  mapExecutionError,
  type EffectOf,
  type T3ProgramEffectHandler,
} from "./T3ProgramEffectHandlerTypes.ts";

type IntegrationAdmissionEffect = EffectOf<"deliver_integration_admission_request">;
type Threads = Pick<
  ThreadManagementServiceShape,
  "getThreadProjection" | "sendToThread" | "waitForThread"
>;

const encodeRequest = Schema.encodeSync(Schema.fromJsonString(IntegrationAdmissionRequest));
const decodeAcknowledgement = Schema.decodeUnknownEffect(
  Schema.fromJsonString(IntegrationAdmissionAcknowledgement),
);

function matchesAcknowledgement(
  acknowledgement: IntegrationAdmissionAcknowledgement,
  effect: IntegrationAdmissionEffect,
) {
  const identity = effect.identity;
  return (
    acknowledgement.programId === identity.programId &&
    acknowledgement.requestId === identity.requestId &&
    acknowledgement.integrationAdmissionRequestId === identity.integrationAdmissionRequestId &&
    acknowledgement.phaseId === identity.phaseId &&
    acknowledgement.programCoordinatorThreadId === identity.programCoordinatorThreadId &&
    acknowledgement.integrationCoordinatorThreadId === identity.integrationCoordinatorThreadId &&
    acknowledgement.sourceThreadId === identity.sourceThreadId &&
    acknowledgement.phaseCallbackId === identity.phaseCallbackId &&
    acknowledgement.phaseCallbackNonce === identity.phaseCallbackNonce &&
    acknowledgement.candidateCommit === identity.candidateCommit &&
    acknowledgement.expectedParent === identity.expectedParent &&
    acknowledgement.integrationRef === identity.integrationRef &&
    acknowledgement.leaseId === identity.leaseId &&
    acknowledgement.leaseEpoch === identity.leaseEpoch &&
    acknowledgement.expiresAt === identity.expiresAt &&
    acknowledgement.integrationAdmissionNonce === identity.integrationAdmissionNonce &&
    acknowledgement.accepted
  );
}

const findAcknowledgement = Effect.fn(
  "T3ProgramIntegrationAdmissionEffectHandlers.findAcknowledgement",
)(function* (
  projection: OrchestrationV2ThreadProjection,
  effect: IntegrationAdmissionEffect,
  context: ProgramEffectExecutorContext,
  runId?: string,
) {
  if (projection.thread.id !== effect.identity.integrationCoordinatorThreadId) {
    return yield* executionError(
      effect,
      context,
      "Integration coordinator thread identity does not match.",
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
  return Option.none<IntegrationAdmissionAcknowledgement>();
});

export function makeIntegrationAdmissionRequestHandler(
  threads: Threads,
): T3ProgramEffectHandler<"deliver_integration_admission_request"> {
  const observe: T3ProgramEffectHandler<"deliver_integration_admission_request">["observe"] = (
    effect,
    context,
  ) =>
    threads.getThreadProjection(effect.identity.integrationCoordinatorThreadId).pipe(
      Effect.flatMap((projection) => findAcknowledgement(projection, effect, context)),
      Effect.map(Option.map(() => integrationAdmissionReceipt(effect, context) as RuntimeReceipt)),
      Effect.mapError((error) => mapExecutionError(effect, context, error)),
    );

  const execute: T3ProgramEffectHandler<"deliver_integration_admission_request">["execute"] = (
    effect,
    context,
  ) =>
    Effect.gen(function* () {
      const coordinator = yield* threads.getThreadProjection(
        effect.identity.integrationCoordinatorThreadId,
      );
      const sent = yield* threads.sendToThread({
        projectId: coordinator.thread.projectId,
        commandId: CommandId.make(`program-effect:${effect.effectId}:integration-admission`),
        threadId: effect.identity.integrationCoordinatorThreadId,
        messageId: MessageId.make(`program-effect:${effect.effectId}:integration-admission`),
        text: encodeRequest({ kind: "integration_admission_request", ...effect.identity }),
        attachments: [],
        mode: "auto",
        createdBy: "system",
        creationSource: "server",
      });
      const waited = yield* threads.waitForThread({
        projectId: coordinator.thread.projectId,
        threadId: effect.identity.integrationCoordinatorThreadId,
        runId: sent.run.id,
        timeoutMs: 120_000,
      });
      if (waited.timedOut || waited.run === null || waited.run.status !== "completed") {
        return yield* executionError(
          effect,
          context,
          "Integration coordinator acknowledgement run did not complete.",
        );
      }
      const settled = yield* threads.getThreadProjection(
        effect.identity.integrationCoordinatorThreadId,
      );
      const acknowledgement = yield* findAcknowledgement(settled, effect, context, sent.run.id);
      if (Option.isNone(acknowledgement)) {
        return yield* executionError(
          effect,
          context,
          "Integration coordinator did not return the exact typed acknowledgement.",
        );
      }
      return integrationAdmissionReceipt(effect, context);
    }).pipe(Effect.mapError((error) => mapExecutionError(effect, context, error)));

  return { observe, execute };
}
