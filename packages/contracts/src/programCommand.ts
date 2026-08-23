import * as Schema from "effect/Schema";

import { ProgramId, ProgramRequestId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProgramCommand = Schema.Literals([
  "pause",
  "resume",
  "stop",
  "steer",
  "request_replan",
]);
export type ProgramCommand = typeof ProgramCommand.Type;

export const ProgramDecisionCode = Schema.Literals([
  "accepted",
  "already_applied",
  "invalid_state",
  "program_not_found",
  "request_conflict",
  "lease_conflict",
  "unsupported_goal",
  "attachment_mismatch",
]);
export type ProgramDecisionCode = typeof ProgramDecisionCode.Type;

export const ProgramCommandDecision = Schema.Struct({
  status: Schema.Literals(["accepted", "rejected"]),
  code: ProgramDecisionCode,
  message: TrimmedNonEmptyString,
});
export type ProgramCommandDecision = typeof ProgramCommandDecision.Type;

const ProgramMutationInput = Schema.Struct({
  programId: ProgramId,
  requestId: ProgramRequestId,
});

export const PauseProgramInput = ProgramMutationInput;
export type PauseProgramInput = typeof PauseProgramInput.Type;
export const ResumeProgramInput = ProgramMutationInput;
export type ResumeProgramInput = typeof ResumeProgramInput.Type;
export const RequestReplanProgramInput = ProgramMutationInput;
export type RequestReplanProgramInput = typeof RequestReplanProgramInput.Type;
export const StopProgramInput = Schema.Struct({
  ...ProgramMutationInput.fields,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type StopProgramInput = typeof StopProgramInput.Type;
export const ReadProgramInput = Schema.Struct({ programId: ProgramId });
export type ReadProgramInput = typeof ReadProgramInput.Type;

export const AcceptedOperatorIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pause") }),
  Schema.Struct({ kind: Schema.Literal("resume") }),
  Schema.Struct({ kind: Schema.Literal("request_replan") }),
  Schema.Struct({ kind: Schema.Literal("stop"), reason: Schema.optional(TrimmedNonEmptyString) }),
]);
export type AcceptedOperatorIntent = typeof AcceptedOperatorIntent.Type;
