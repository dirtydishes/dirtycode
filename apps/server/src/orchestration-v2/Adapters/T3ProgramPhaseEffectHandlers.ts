import { CommandId, type RuntimeReceipt } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { CommandReceiptStoreV2Shape } from "../CommandReceiptStore.ts";
import * as ThreadLaunchService from "../ThreadLaunchService.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import * as PreparedWorktreeVerifier from "../PreparedWorktreeVerifier.ts";
import { bindReceipt, phaseReceipt } from "./T3ProgramEffectReceipts.ts";
import { checkoutFor, matchesOwnerThread, matchesPhaseThread } from "./T3ProgramEffectIdentity.ts";
import {
  executionError,
  mapExecutionError,
  rejectExpiredLease,
  type T3ProgramEffectClock,
  type T3ProgramEffectHandler,
} from "./T3ProgramEffectHandlerTypes.ts";

interface PhaseHandlerDependencies {
  readonly threads: Pick<ThreadManagementServiceShape, "dispatch" | "getThreadProjection">;
  readonly commandReceipts: Pick<CommandReceiptStoreV2Shape, "getByCommandId">;
  readonly clock: T3ProgramEffectClock;
}

export function makeLaunchPhaseCoordinatorHandler({
  threads,
  commandReceipts,
  clock,
}: PhaseHandlerDependencies): T3ProgramEffectHandler<"launch_phase_coordinator"> {
  const observe: T3ProgramEffectHandler<"launch_phase_coordinator">["observe"] = (
    effect,
    context,
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
      Effect.mapError((error) => mapExecutionError(effect, context, error)),
    );
  };

  const execute: T3ProgramEffectHandler<"launch_phase_coordinator">["execute"] = (
    effect,
    context,
  ) =>
    Effect.gen(function* () {
      yield* rejectExpiredLease(effect, context, yield* clock.now);
      yield* threads.dispatch({
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
      });
      return yield* observe(effect, context).pipe(
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
    }).pipe(Effect.mapError((error) => mapExecutionError(effect, context, error)));

  return { observe, execute };
}

interface BindHandlerDependencies {
  readonly threads: Pick<ThreadManagementServiceShape, "getThreadProjection">;
  readonly commandReceipts: Pick<CommandReceiptStoreV2Shape, "getByCommandId">;
  readonly launches: Pick<ThreadLaunchService.ThreadLaunchService["Service"], "launch">;
  readonly preparedWorktrees: Pick<
    PreparedWorktreeVerifier.PreparedWorktreeVerifier["Service"],
    "verify"
  >;
  readonly clock: T3ProgramEffectClock;
}

export function makeBindPreparedWorktreeHandler({
  threads,
  commandReceipts,
  launches,
  preparedWorktrees,
  clock,
}: BindHandlerDependencies): T3ProgramEffectHandler<"bind_prepared_worktree"> {
  const observe: T3ProgramEffectHandler<"bind_prepared_worktree">["observe"] = (
    effect,
    context,
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
      Effect.mapError((error) => mapExecutionError(effect, context, error)),
    );
  };

  const execute: T3ProgramEffectHandler<"bind_prepared_worktree">["execute"] = (effect, context) =>
    Effect.gen(function* () {
      yield* rejectExpiredLease(effect, context, yield* clock.now);
      yield* preparedWorktrees.verify(checkoutFor(effect.identity), effect.identity.repositoryRoot);
      yield* launches.launch({
        commandId: CommandId.make(`program-effect:${effect.effectId}:bind`),
        threadId: effect.identity.ownerThreadId,
        projectId: effect.identity.projectId,
        title: effect.identity.ownerThreadTitle,
        generateTitle: false,
        modelSelection: effect.identity.modelSelection,
        runtimeMode: effect.identity.runtimeMode,
        interactionMode: effect.identity.interactionMode,
        workspaceStrategy: { type: "prepared_worktree", ...checkoutFor(effect.identity) },
        createdBy: "system",
        creationSource: "server",
      });
      return yield* observe(effect, context).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                executionError(effect, context, "Owner bind returned without a durable receipt."),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
    }).pipe(Effect.mapError((error) => mapExecutionError(effect, context, error)));

  return { observe, execute };
}
