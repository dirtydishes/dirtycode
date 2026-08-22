import {
  type ProgramDriverDecision,
  type ReconcileProgramInput,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ProgramDriverError extends Schema.TaggedErrorClass<ProgramDriverError>()(
  "ProgramDriverError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `The dirtyloops Program driver failed: ${this.reason}`;
  }
}

export interface DirtyloopsProgramDriver {
  readonly reconcile: (
    input: ReconcileProgramInput,
  ) => Effect.Effect<ProgramDriverDecision, ProgramDriverError>;
}

export type ProgramDriverRegistry = Readonly<
  Record<StartProgramInput["driverKind"], DirtyloopsProgramDriver>
>;
