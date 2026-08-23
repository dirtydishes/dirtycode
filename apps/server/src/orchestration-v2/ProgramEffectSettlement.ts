import type { ProgramEffect, RuntimeReceipt } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type {
  ProgramEffectExecutor,
  ProgramEffectExecutorContext,
} from "./ProgramEffectExecutor.ts";
import type { ClaimedProgramWake, ProgramStoreShape } from "./ProgramStore.ts";
import { validateReceipt } from "./ProgramRuntimeValidation.ts";

export interface SettleProgramEffectInput<HookError> {
  readonly store: ProgramStoreShape;
  readonly executor: ProgramEffectExecutor;
  readonly lease: ClaimedProgramWake;
  readonly effect: ProgramEffect;
  readonly context: ProgramEffectExecutorContext;
  readonly afterEffectExecuted?: (receipt: RuntimeReceipt) => Effect.Effect<void, HookError>;
  readonly afterReceiptPersisted?: (receipt: RuntimeReceipt) => Effect.Effect<void, HookError>;
}

/**
 * Settles one durable Program effect through the only allowed receipt path.
 *
 * A retained receipt wins. Otherwise the executor first observes the external
 * boundary, then executes only while the wake lease still fences this worker.
 * Every result is identity-checked before the store accepts it.
 */
export const settleProgramEffect = Effect.fn("ProgramEffectSettlement.settle")(function* <
  HookError,
>(input: SettleProgramEffectInput<HookError>) {
  const retained = yield* input.store.receiptByEffect(input.effect.effectId);
  const observed = Option.isSome(retained)
    ? retained
    : yield* input.executor.observe(input.effect, input.context);
  const receipt = Option.isSome(observed)
    ? observed.value
    : yield* Effect.gen(function* () {
        yield* input.store.assertLease({
          lease: input.lease,
          now: DateTime.formatIso(yield* DateTime.now),
        });
        return yield* input.executor
          .execute(input.effect, input.context)
          .pipe(Effect.tap((executed) => input.afterEffectExecuted?.(executed) ?? Effect.void));
      });
  const mismatch = validateReceipt(input.effect, receipt, input.context);
  if (mismatch !== null) return yield* mismatch;
  const persisted = yield* input.store.saveReceipt({
    lease: input.lease,
    receipt,
    now: DateTime.formatIso(yield* DateTime.now),
  });
  yield* input.afterReceiptPersisted?.(persisted) ?? Effect.void;
  return persisted;
});
