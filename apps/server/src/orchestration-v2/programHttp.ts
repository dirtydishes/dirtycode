import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ProgramRuntime from "./ProgramRuntime.ts";

export const mapProgramRuntimeErrors = <A, R>(
  effect: Effect.Effect<A, ProgramRuntime.ProgramRuntimeError, R>,
) =>
  effect.pipe(
    Effect.catchTags({
      ProgramNotFoundError: () => failEnvironmentNotFound("program_not_found"),
      ProgramDriverError: (error) => failEnvironmentInternal("internal_error", error),
      ProgramEffectExecutionError: (error) => failEnvironmentInternal("internal_error", error),
      ProgramReceiptMismatchError: (error) => failEnvironmentInternal("internal_error", error),
      ProgramRuntimeHookError: (error) => failEnvironmentInternal("internal_error", error),
      ProgramStoreError: (error) => failEnvironmentInternal("internal_error", error),
      ProgramStoreLeaseError: (error) => failEnvironmentInternal("internal_error", error),
    }),
  );

export const programHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "programs",
  Effect.fnUntraced(function* (handlers) {
    const programs = yield* ProgramRuntime.ProgramRuntime;

    return handlers
      .handle(
        "list",
        Effect.fn("environment.programs.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* mapProgramRuntimeErrors(programs.list);
        }),
      )
      .handle(
        "read",
        Effect.fn("environment.programs.read")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* mapProgramRuntimeErrors(programs.read(args.params));
        }),
      )
      .handle(
        "start",
        Effect.fn("environment.programs.start")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramRuntimeErrors(programs.start(args.payload));
        }),
      )
      .handle(
        "wake",
        Effect.fn("environment.programs.wake")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramRuntimeErrors(programs.wake(args.payload));
        }),
      )
      .handle(
        "pause",
        Effect.fn("environment.programs.pause")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramRuntimeErrors(programs.pause(args.payload));
        }),
      )
      .handle(
        "resume",
        Effect.fn("environment.programs.resume")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramRuntimeErrors(programs.resume(args.payload));
        }),
      )
      .handle(
        "requestReplan",
        Effect.fn("environment.programs.requestReplan")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramRuntimeErrors(programs.requestReplan(args.payload));
        }),
      )
      .handle(
        "stop",
        Effect.fn("environment.programs.stop")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramRuntimeErrors(programs.stop(args.payload));
        }),
      )
      .handle(
        "recordDeliberation",
        Effect.fn("environment.programs.recordDeliberation")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramRuntimeErrors(programs.recordDeliberation(args.payload));
        }),
      )
      .handle(
        "recordEvaluation",
        Effect.fn("environment.programs.recordEvaluation")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* mapProgramRuntimeErrors(programs.recordEvaluation(args.payload));
        }),
      );
  }),
);
