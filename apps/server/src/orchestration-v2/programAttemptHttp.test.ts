import { assert, it } from "@effect/vitest";
import {
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
  ProgramAttemptId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ProgramAttemptService from "./ProgramAttemptService.ts";
import { mapProgramAttemptErrors } from "./programAttemptHttp.ts";

const attemptId = ProgramAttemptId.make("attempt:http-errors");

it.effect("maps structural Program Attempt errors to their HTTP classes", () =>
  Effect.gen(function* () {
    const conflict = yield* Effect.flip(
      mapProgramAttemptErrors(
        Effect.fail(
          new ProgramAttemptService.ProgramAttemptRequestConflictError({
            attemptId,
            request: "launch",
          }),
        ),
      ),
    );
    const badRequest = yield* Effect.flip(
      mapProgramAttemptErrors(
        Effect.fail(
          new ProgramAttemptService.ProgramAttemptStateError({
            attemptId,
            state: "attempt_not_terminal",
          }),
        ),
      ),
    );

    assert.instanceOf(conflict, EnvironmentHttpConflictError);
    assert.equal(
      conflict.message,
      "This Attempt ID is already bound to a different launch request.",
    );
    assert.instanceOf(badRequest, EnvironmentHttpBadRequestError);
    assert.equal(
      badRequest.message,
      "A Program Attempt can be acknowledged only after it reaches a terminal state.",
    );
  }),
);
