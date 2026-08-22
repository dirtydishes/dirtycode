import { type ProgramEffect } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { CommandReceiptStoreV2Shape } from "../CommandReceiptStore.ts";
import {
  ProgramEffectExecutionError,
  type ProgramEffectExecutor,
} from "../ProgramEffectExecutor.ts";
import * as ProgramAttemptService from "../ProgramAttemptService.ts";
import * as PreparedWorktreeVerifier from "../PreparedWorktreeVerifier.ts";
import * as ThreadLaunchService from "../ThreadLaunchService.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import {
  makeAcknowledgeOwnerResultHandler,
  makeCancelOwnerAttemptHandler,
  makeLaunchOwnerAttemptHandler,
} from "./T3ProgramOwnerEffectHandlers.ts";
import {
  makeBindPreparedWorktreeHandler,
  makeLaunchPhaseCoordinatorHandler,
} from "./T3ProgramPhaseEffectHandlers.ts";
import {
  executionError,
  type EffectOf,
  type ProgramEffectKind,
  type T3ProgramEffectClock,
  type T3ProgramEffectHandler,
} from "./T3ProgramEffectHandlerTypes.ts";

const isProgramEffectExecutionError = Schema.is(ProgramEffectExecutionError);

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

export { type T3ProgramEffectClock } from "./T3ProgramEffectHandlerTypes.ts";

const systemClock: T3ProgramEffectClock = {
  now: DateTime.now.pipe(Effect.map(DateTime.formatIso)),
};

type CoreThreads = Pick<ThreadManagementServiceShape, "dispatch" | "getThreadProjection">;
type Threads = Pick<
  ThreadManagementServiceShape,
  "dispatch" | "getThreadProjection" | "sendToThread" | "waitForThread"
>;

interface ErasedHandler {
  readonly observe: ProgramEffectExecutor["observe"];
  readonly execute: ProgramEffectExecutor["execute"];
}

function eraseHandler<K extends ProgramEffectKind>(
  kind: K,
  handler: T3ProgramEffectHandler<K>,
): ErasedHandler {
  const narrow = (effect: ProgramEffect): EffectOf<K> => {
    if (effect.kind !== kind) throw new Error(`Program effect registry mismatch for ${kind}.`);
    return effect as EffectOf<K>;
  };
  return {
    observe: (effect, context) => handler.observe(narrow(effect), context),
    execute: (effect, context) => handler.execute(narrow(effect), context),
  };
}

const unsupportedKinds = new Set<ProgramEffectKind>([
  "launch_review_owner",
  "deliver_phase_callback",
  "acknowledge_phase_callback",
  "update_goal",
  "clear_goal",
]);

export function makeT3ProgramEffectExecutor(
  threads: CoreThreads,
  commandReceipts: Pick<CommandReceiptStoreV2Shape, "getByCommandId">,
  mutable?: undefined,
  clock?: T3ProgramEffectClock,
): ProgramEffectExecutor;
export function makeT3ProgramEffectExecutor(
  threads: Threads,
  commandReceipts: Pick<CommandReceiptStoreV2Shape, "getByCommandId">,
  mutable: T3ProgramMutableServices,
  clock?: T3ProgramEffectClock,
): ProgramEffectExecutor;
export function makeT3ProgramEffectExecutor(
  threads: CoreThreads & Partial<Pick<Threads, "sendToThread" | "waitForThread">>,
  commandReceipts: Pick<CommandReceiptStoreV2Shape, "getByCommandId">,
  mutable?: T3ProgramMutableServices,
  clock: T3ProgramEffectClock = systemClock,
): ProgramEffectExecutor {
  const handlers = new Map<ProgramEffectKind, ErasedHandler>();
  handlers.set(
    "launch_phase_coordinator",
    eraseHandler(
      "launch_phase_coordinator",
      makeLaunchPhaseCoordinatorHandler({ threads, commandReceipts, clock }),
    ),
  );
  if (mutable !== undefined) {
    if (threads.sendToThread === undefined || threads.waitForThread === undefined) {
      throw new Error("Mutable Program execution requires coordinator delivery services.");
    }
    const mutableThreads: Threads = {
      ...threads,
      sendToThread: threads.sendToThread,
      waitForThread: threads.waitForThread,
    };
    handlers.set(
      "bind_prepared_worktree",
      eraseHandler(
        "bind_prepared_worktree",
        makeBindPreparedWorktreeHandler({
          threads,
          commandReceipts,
          launches: mutable.launches,
          preparedWorktrees: mutable.preparedWorktrees,
          clock,
        }),
      ),
    );
    handlers.set(
      "launch_owner_attempt",
      eraseHandler(
        "launch_owner_attempt",
        makeLaunchOwnerAttemptHandler({ attempts: mutable.attempts, clock }),
      ),
    );
    handlers.set(
      "cancel_owner_attempt",
      eraseHandler(
        "cancel_owner_attempt",
        makeCancelOwnerAttemptHandler({ attempts: mutable.attempts }),
      ),
    );
    handlers.set(
      "acknowledge_owner_result",
      eraseHandler(
        "acknowledge_owner_result",
        makeAcknowledgeOwnerResultHandler({ threads: mutableThreads, attempts: mutable.attempts }),
      ),
    );
  }

  const handlerFor = (effect: ProgramEffect): Effect.Effect<ErasedHandler, string> => {
    const handler = handlers.get(effect.kind);
    if (handler !== undefined) return Effect.succeed(handler);
    if (unsupportedKinds.has(effect.kind)) {
      return Effect.succeed({
        observe: () => Effect.succeed(Option.none()),
        execute: (_effect, context) =>
          Effect.fail(
            executionError(effect, context, `Slice 3 does not implement ${effect.kind}.`),
          ),
      });
    }
    return Effect.fail("Mutable Program services are unavailable.");
  };

  const observe: ProgramEffectExecutor["observe"] = (effect, context) =>
    handlerFor(effect).pipe(
      Effect.flatMap((handler) => handler.observe(effect, context)),
      Effect.mapError((error) =>
        isProgramEffectExecutionError(error) ? error : executionError(effect, context, error),
      ),
    );

  const execute: ProgramEffectExecutor["execute"] = (effect, context) =>
    handlerFor(effect).pipe(
      Effect.flatMap((handler) => handler.execute(effect, context)),
      Effect.mapError((error) =>
        isProgramEffectExecutionError(error) ? error : executionError(effect, context, error),
      ),
    );

  return { observe, execute };
}
