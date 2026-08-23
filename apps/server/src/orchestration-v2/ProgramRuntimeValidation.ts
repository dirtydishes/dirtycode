import {
  type ProgramEffect,
  ProgramEffectId,
  type ProgramEvent,
  ProgramId,
  type RuntimeReceipt,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { ProgramEffectExecutorContext } from "./ProgramEffectExecutor.ts";
import { canonicalJson } from "./ProgramIdentity.ts";
import type { ProgramRecord } from "./ProgramStore.ts";

export class ProgramReceiptMismatchError extends Schema.TaggedErrorClass<ProgramReceiptMismatchError>()(
  "ProgramReceiptMismatchError",
  {
    programId: ProgramId,
    effectId: ProgramEffectId,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `T3 rejected the receipt for Program effect ${this.effectId}: ${this.reason}`;
  }
}

export function startIdentityMatches(
  started: Extract<ProgramEvent, { readonly type: "program.started" }>,
  driverKind: ProgramRecord["driverKind"],
  input: StartProgramInput,
): boolean {
  const initial = started.payload.projection;
  const retained = {
    attachment: started.payload.attachment,
    driverKind,
    title: initial.title,
    outcome: initial.outcome,
    phases: initial.phases.map((phase) => ({
      phaseId: phase.phaseId,
      title: phase.title,
      dependencyIds: phase.dependencyIds,
      phaseCoordinatorThreadId: phase.phaseCoordinatorTargetThreadId,
      projectId: phase.projectId,
      threadTitle: phase.threadTitle,
      modelSelection: phase.modelSelection,
      runtimeMode: phase.runtimeMode,
      interactionMode: phase.interactionMode,
      branch: phase.branch,
      worktreePath: phase.worktreePath,
    })),
    attempts: initial.attempts,
  };
  return (
    canonicalJson(retained) ===
    canonicalJson({
      attachment: input.attachment,
      driverKind: input.driverKind,
      title: input.title,
      outcome: input.outcome,
      phases: input.phases,
      attempts: input.attempts,
    })
  );
}

export function validateReceipt(
  effect: ProgramEffect,
  receipt: RuntimeReceipt,
  context: ProgramEffectExecutorContext,
): ProgramReceiptMismatchError | null {
  const mismatch = (reason: string) =>
    new ProgramReceiptMismatchError({
      programId: context.programId,
      effectId: effect.effectId,
      reason,
    });
  if (receipt.programId !== context.programId) return mismatch("programId does not match");
  if (receipt.effectId !== effect.effectId) return mismatch("effectId does not match");
  if (receipt.requestId !== context.requestId) return mismatch("requestId does not match");
  if (receipt.programRevision !== context.programRevision) {
    return mismatch("programRevision does not match");
  }
  if (receipt.kind !== effect.kind) return mismatch("effect kind does not match");
  if (canonicalJson(receipt.identity) !== canonicalJson(effect.identity)) {
    return mismatch("effect identity does not match");
  }
  if (
    receipt.kind === "launch_phase_coordinator" &&
    effect.kind === "launch_phase_coordinator" &&
    receipt.result.phaseCoordinatorThreadId !== effect.identity.phaseCoordinatorThreadId
  ) {
    return mismatch("phase coordinator thread does not match the proposed target");
  }
  return null;
}
