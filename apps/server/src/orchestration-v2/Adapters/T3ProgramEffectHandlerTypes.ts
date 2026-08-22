import type { ProgramEffect, RuntimeReceipt } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  ProgramEffectExecutionError,
  type ProgramEffectExecutorContext,
} from "../ProgramEffectExecutor.ts";

export type ProgramEffectKind = ProgramEffect["kind"];
export type EffectOf<K extends ProgramEffectKind> = Extract<ProgramEffect, { readonly kind: K }>;

export interface T3ProgramEffectHandler<K extends ProgramEffectKind> {
  readonly observe: (
    effect: EffectOf<K>,
    context: ProgramEffectExecutorContext,
  ) => Effect.Effect<Option.Option<RuntimeReceipt>, ProgramEffectExecutionError>;
  readonly execute: (
    effect: EffectOf<K>,
    context: ProgramEffectExecutorContext,
  ) => Effect.Effect<RuntimeReceipt, ProgramEffectExecutionError>;
}

export interface T3ProgramEffectClock {
  readonly now: Effect.Effect<string>;
}

export function executionError(
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

const isProgramEffectExecutionError = Schema.is(ProgramEffectExecutionError);

export function mapExecutionError(
  effect: ProgramEffect,
  context: ProgramEffectExecutorContext,
  error: unknown,
) {
  return isProgramEffectExecutionError(error) ? error : executionError(effect, context, error);
}

export function rejectExpiredLease(
  effect: ProgramEffect,
  context: ProgramEffectExecutorContext,
  currentTime: string,
) {
  const expiresAt =
    effect.kind === "bind_prepared_worktree"
      ? effect.identity.expiresAt
      : effect.kind === "launch_owner_attempt"
        ? effect.identity.preparedWorktree.expiresAt
        : null;
  return expiresAt !== null && Date.parse(currentTime) >= Date.parse(expiresAt)
    ? Effect.fail(executionError(effect, context, "The dirtyloops mutation lease expired."))
    : Effect.void;
}
