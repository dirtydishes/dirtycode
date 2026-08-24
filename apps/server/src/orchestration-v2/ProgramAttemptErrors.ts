import { ProgramAttemptId, RunId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export class ProgramAttemptNotFoundError extends Schema.TaggedErrorClass<ProgramAttemptNotFoundError>()(
  "ProgramAttemptNotFoundError",
  { attemptId: ProgramAttemptId },
) {
  override get message(): string {
    return `Program Attempt ${this.attemptId} was not found.`;
  }
}

export class ProgramAttemptRequestConflictError extends Schema.TaggedErrorClass<ProgramAttemptRequestConflictError>()(
  "ProgramAttemptRequestConflictError",
  {
    attemptId: ProgramAttemptId,
    request: Schema.Literals(["launch", "cancel", "acknowledge"]),
  },
) {
  override get message(): string {
    return this.request === "launch"
      ? "This Attempt ID is already bound to a different launch request."
      : "This Attempt effect is already bound to a different request.";
  }
}

export class ProgramAttemptStateError extends Schema.TaggedErrorClass<ProgramAttemptStateError>()(
  "ProgramAttemptStateError",
  {
    attemptId: ProgramAttemptId,
    state: Schema.Literals([
      "launch_receipt_missing",
      "cancel_run_missing",
      "cancel_not_terminal",
      "run_missing",
      "run_not_terminal",
      "attempt_not_terminal",
    ]),
    runId: Schema.optional(RunId),
  },
) {
  override get message(): string {
    switch (this.state) {
      case "launch_receipt_missing":
        return "The launch intent exists but the thread and run receipt are not recorded yet.";
      case "cancel_run_missing":
        return "The Attempt has no run to cancel.";
      case "cancel_not_terminal":
        return "T3 did not acknowledge a terminal run before the cancellation wait ended.";
      case "run_missing":
        return this.runId === undefined
          ? "T3 accepted the Program Attempt without a durable run."
          : `Run ${this.runId} is missing from the thread.`;
      case "run_not_terminal":
        return `Run ${this.runId} is not terminal.`;
      case "attempt_not_terminal":
        return "A Program Attempt can be acknowledged only after it reaches a terminal state.";
    }
  }
}

export class ProgramAttemptPersistenceError extends Schema.TaggedErrorClass<ProgramAttemptPersistenceError>()(
  "ProgramAttemptPersistenceError",
  {
    attemptId: ProgramAttemptId,
    operation: Schema.Literals([
      "load",
      "load_for_thread",
      "load_live",
      "persist_terminal",
      "persist_launch_intent",
      "persist_launch_receipt",
      "persist_effect_intent",
      "scan_terminal_outbox",
      "acknowledge",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "load":
        return "Could not load the Program Attempt.";
      case "load_for_thread":
        return "Could not load the Program Attempt for this thread.";
      case "load_live":
        return "Could not load live Program Attempts.";
      case "persist_terminal":
        return "Could not retain the terminal result.";
      case "persist_launch_intent":
        return "Could not persist the launch intent.";
      case "persist_launch_receipt":
        return "Could not persist the launch receipt.";
      case "persist_effect_intent":
        return "Could not persist the effect intent.";
      case "scan_terminal_outbox":
        return "Could not scan retained terminal results.";
      case "acknowledge":
        return "Could not acknowledge the terminal result.";
    }
  }
}

export class ProgramAttemptOperationError extends Schema.TaggedErrorClass<ProgramAttemptOperationError>()(
  "ProgramAttemptOperationError",
  {
    attemptId: ProgramAttemptId,
    operation: Schema.Literals(["launch", "projection", "recovery_projection", "cancel"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "launch":
        return "T3 could not launch the Program Attempt.";
      case "projection":
        return "Could not load the Attempt thread.";
      case "recovery_projection":
        return "Could not load a live Program Attempt before process recovery.";
      case "cancel":
        return "T3 could not cancel the Program Attempt.";
    }
  }
}

export class ProgramAttemptInvalidRecordError extends Schema.TaggedErrorClass<ProgramAttemptInvalidRecordError>()(
  "ProgramAttemptInvalidRecordError",
  {
    attemptId: ProgramAttemptId,
    operation: Schema.Literals([
      "encode_terminal",
      "decode_launch",
      "decode_terminal",
      "encode_launch",
      "launch_receipt_mismatch",
      "encode_cancel",
      "encode_acknowledgement",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "encode_terminal":
        return "Could not encode the terminal result.";
      case "decode_launch":
        return "The retained launch request is invalid.";
      case "decode_terminal":
        return "The retained terminal result is invalid.";
      case "encode_launch":
        return "Could not encode the launch request.";
      case "launch_receipt_mismatch":
        return "The durable launch receipt does not match T3's idempotent launch receipt.";
      case "encode_cancel":
        return "Could not encode the cancel request.";
      case "encode_acknowledgement":
        return "Could not encode the acknowledgement request.";
    }
  }
}

export type ProgramAttemptError =
  | ProgramAttemptNotFoundError
  | ProgramAttemptRequestConflictError
  | ProgramAttemptStateError
  | ProgramAttemptPersistenceError
  | ProgramAttemptOperationError
  | ProgramAttemptInvalidRecordError;
