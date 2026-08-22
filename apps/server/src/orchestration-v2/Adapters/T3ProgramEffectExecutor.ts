import {
  CommandId,
  type OrchestrationV2ThreadProjection,
  type ProgramEffect,
  type RuntimeReceipt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  ProgramEffectExecutionError,
  type ProgramEffectExecutor,
  type ProgramEffectExecutorContext,
} from "../ProgramEffectExecutor.ts";
import type { CommandReceiptStoreV2Shape } from "../CommandReceiptStore.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";

const isProgramEffectExecutionError = Schema.is(ProgramEffectExecutionError);

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

function receiptFor(
  effect: Extract<ProgramEffect, { readonly kind: "launch_phase_coordinator" }>,
  context: ProgramEffectExecutorContext,
): RuntimeReceipt {
  return {
    receiptId: context.receiptId,
    programId: context.programId,
    programRevision: context.programRevision,
    effectId: effect.effectId,
    requestId: context.requestId,
    kind: effect.kind,
    status: "succeeded",
    resultDigest: `sha256:${effect.effectId}`,
    evidence: [{ kind: "thread", id: effect.identity.phaseCoordinatorThreadId }],
    createdAt: context.now,
    acknowledged: false,
    identity: effect.identity,
    result: { phaseCoordinatorThreadId: effect.identity.phaseCoordinatorThreadId },
  };
}

function matchesThreadIdentity(
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

export function makeT3ProgramEffectExecutor(
  threads: Pick<ThreadManagementServiceShape, "dispatch" | "getThreadProjection">,
  commandReceipts: Pick<CommandReceiptStoreV2Shape, "getByCommandId">,
): ProgramEffectExecutor {
  const observe: ProgramEffectExecutor["observe"] = (effect, context) => {
    if (effect.kind !== "launch_phase_coordinator") return Effect.succeed(Option.none());
    const commandId = CommandId.make(`command:${effect.effectId}`);
    return commandReceipts.getByCommandId(commandId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none()),
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
                      matchesThreadIdentity(effect, projection)
                        ? Effect.succeed(Option.some(receiptFor(effect, context)))
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
      Effect.mapError((error) =>
        isProgramEffectExecutionError(error) ? error : executionError(effect, context, error),
      ),
    );
  };

  return {
    observe,
    execute: (effect, context) => {
      if (effect.kind !== "launch_phase_coordinator") {
        return Effect.fail(
          executionError(effect, context, `Slice 1 does not implement ${effect.kind}.`),
        );
      }
      return threads
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
          Effect.mapError((error) => executionError(effect, context, error)),
          Effect.flatMap(() => observe(effect, context)),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  executionError(effect, context, "Thread create returned without a projection."),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );
    },
  };
}
