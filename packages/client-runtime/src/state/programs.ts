import {
  PROGRAM_WS_METHODS,
  type EnvironmentId,
  type PauseProgramInput,
  type ProgramId,
  type ProgramStreamItem,
  type ProgramSummary,
  type ResumeProgramInput,
  type StopProgramInput,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiClient } from "../rpc/http.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export interface ProgramClientState {
  readonly programs: ReadonlyMap<ProgramId, ProgramSummary>;
  readonly synchronized: boolean;
}

export const EMPTY_PROGRAM_CLIENT_STATE: ProgramClientState = {
  programs: new Map(),
  synchronized: false,
};

export function applyProgramStreamItem(
  state: ProgramClientState,
  item: ProgramStreamItem,
): ProgramClientState {
  switch (item.kind) {
    case "snapshot":
      return {
        ...state,
        programs: new Map(item.snapshot.programs.map((program) => [program.programId, program])),
      };
    case "program.updated": {
      const programs = new Map(state.programs);
      programs.set(item.program.programId, item.program);
      return { ...state, programs };
    }
    case "program.removed": {
      const programs = new Map(state.programs);
      programs.delete(item.programId);
      return { ...state, programs };
    }
    case "synchronized":
      return { ...state, synchronized: true };
  }
}

export function projectProgramStreamItem(
  state: ProgramClientState,
  item: ProgramStreamItem,
): readonly [ProgramClientState, ReadonlyArray<ProgramClientState>] {
  const next = applyProgramStreamItem(state, item);
  return [next, [next]];
}

export class ProgramConnectionNotReadyError extends Data.TaggedError(
  "ProgramConnectionNotReadyError",
)<{ readonly message: string }> {}

export type ProgramMutation =
  | { readonly kind: "pause"; readonly input: PauseProgramInput }
  | { readonly kind: "resume"; readonly input: ResumeProgramInput }
  | { readonly kind: "stop"; readonly input: StopProgramInput };

const preparedProgramConnection = Effect.gen(function* () {
  const supervisor = yield* EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared)) {
    return yield* new ProgramConnectionNotReadyError({
      message: "The environment HTTP connection is not ready.",
    });
  }
  const httpClient = yield* Effect.serviceOption(HttpClient.HttpClient);
  if (Option.isNone(httpClient)) {
    return yield* new ProgramConnectionNotReadyError({
      message: "The environment HTTP client is unavailable.",
    });
  }
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  return { prepared: prepared.value, httpClient: httpClient.value, signer } as const;
});

export const loadProgramSnapshot = Effect.fn("clientRuntime.state.programs.load")(function* (
  programId: ProgramId,
) {
  const { prepared, httpClient, signer } = yield* preparedProgramConnection;
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, `/api/programs/${programId}`);
  return yield* Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl);
    const headers = yield* buildEnvironmentAuthHeaders(
      prepared.httpAuthorization,
      "GET",
      requestUrl,
      signer,
    );
    return yield* executeEnvironmentHttpRequest(
      requestUrl,
      6_000,
      withEnvironmentCredentials(
        prepared.httpAuthorization,
        client.programs.read({ params: { programId }, headers }),
      ),
    );
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
});

export const mutateProgram = Effect.fn("clientRuntime.state.programs.mutate")(function* (
  mutation: ProgramMutation,
) {
  const { prepared, httpClient, signer } = yield* preparedProgramConnection;
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, `/api/programs/${mutation.kind}`);
  return yield* Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl);
    const headers = yield* buildEnvironmentAuthHeaders(
      prepared.httpAuthorization,
      "POST",
      requestUrl,
      signer,
    );
    const request =
      mutation.kind === "pause"
        ? client.programs.pause({ payload: mutation.input, headers })
        : mutation.kind === "resume"
          ? client.programs.resume({ payload: mutation.input, headers })
          : client.programs.stop({ payload: mutation.input, headers });
    return yield* executeEnvironmentHttpRequest(
      requestUrl,
      6_000,
      withEnvironmentCredentials(prepared.httpAuthorization, request),
    );
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
});

export function createProgramEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const detail = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:programs:detail",
    staleTimeMs: 0,
    idleTtlMs: 60_000,
    execute: (input: { readonly programId: ProgramId }) => loadProgramSnapshot(input.programId),
  });
  const scheduler = createAtomCommandScheduler();
  const mutate = createEnvironmentCommand(runtime, {
    label: "environment-data:programs:mutate",
    scheduler,
    concurrency: {
      mode: "serial",
      key: ({ environmentId, input }: { environmentId: EnvironmentId; input: ProgramMutation }) =>
        `${environmentId}:${input.input.programId}`,
    },
    execute: (input: ProgramMutation, registry, environmentId) =>
      mutateProgram(input).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            registry.refresh(
              detail({ environmentId, input: { programId: input.input.programId } }),
            );
          }),
        ),
      ),
  });

  return {
    live: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:programs:live",
      tag: PROGRAM_WS_METHODS.subscribe,
      transform: (stream) =>
        stream.pipe(Stream.mapAccum(() => EMPTY_PROGRAM_CLIENT_STATE, projectProgramStreamItem)),
    }),
    detail,
    mutate,
  };
}
