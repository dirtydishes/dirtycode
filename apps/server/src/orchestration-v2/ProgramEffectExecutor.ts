import {
  type ProgramEffect,
  ProgramEffectId,
  ProgramId,
  ProgramReceiptId,
  ProgramRequestId,
  type RuntimeReceipt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class ProgramEffectExecutionError extends Schema.TaggedErrorClass<ProgramEffectExecutionError>()(
  "ProgramEffectExecutionError",
  { programId: ProgramId, effectId: ProgramEffectId, cause: Schema.Defect() },
) {
  override get message(): string {
    return `T3 could not execute Program effect ${this.effectId}.`;
  }
}

export interface ProgramEffectExecutorContext {
  readonly programId: ProgramId;
  readonly programRevision: number;
  readonly requestId: ProgramRequestId;
  readonly receiptId: ProgramReceiptId;
  readonly now: string;
}

export interface ProgramEffectExecutor {
  /** Observe and execute must share the durable T3 domain identity. Execute is idempotent by effect ID. */
  readonly observe: (
    effect: ProgramEffect,
    context: ProgramEffectExecutorContext,
  ) => Effect.Effect<Option.Option<RuntimeReceipt>, ProgramEffectExecutionError>;
  readonly execute: (
    effect: ProgramEffect,
    context: ProgramEffectExecutorContext,
  ) => Effect.Effect<RuntimeReceipt, ProgramEffectExecutionError>;
}
