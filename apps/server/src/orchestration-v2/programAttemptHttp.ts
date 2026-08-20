import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ProgramAttemptService from "./ProgramAttemptService.ts";

export const mapProgramAttemptErrors = <A, R>(
  effect: Effect.Effect<A, ProgramAttemptService.ProgramAttemptError, R>,
) =>
  effect.pipe(
    Effect.catchTags({
      ProgramAttemptNotFoundError: () => failEnvironmentNotFound("program_attempt_not_found"),
      ProgramAttemptRequestConflictError: (error) =>
        new EnvironmentHttpConflictError({ message: error.message }),
      ProgramAttemptStateError: (error) =>
        new EnvironmentHttpBadRequestError({ message: error.message }),
      ProgramAttemptPersistenceError: (error) => failEnvironmentInternal("internal_error", error),
      ProgramAttemptOperationError: (error) => failEnvironmentInternal("internal_error", error),
      ProgramAttemptInvalidRecordError: (error) => failEnvironmentInternal("internal_error", error),
    }),
  );

export const programAttemptHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "programAttempts",
  Effect.fnUntraced(function* (handlers) {
    const attempts = yield* ProgramAttemptService.ProgramAttemptService;

    return handlers
      .handle(
        "launch",
        Effect.fn("environment.programAttempts.launch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramAttemptErrors(attempts.launch(args.payload));
        }),
      )
      .handle(
        "observe",
        Effect.fn("environment.programAttempts.observe")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* mapProgramAttemptErrors(attempts.observe(args.payload.attemptId));
        }),
      )
      .handle(
        "observeThread",
        Effect.fn("environment.programAttempts.observeThread")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* mapProgramAttemptErrors(attempts.observeThread(args.params.threadId));
        }),
      )
      .handle(
        "cancel",
        Effect.fn("environment.programAttempts.cancel")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramAttemptErrors(attempts.cancel(args.payload));
        }),
      )
      .handle(
        "acknowledge",
        Effect.fn("environment.programAttempts.acknowledge")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramAttemptErrors(attempts.acknowledge(args.payload));
        }),
      );
  }),
);
