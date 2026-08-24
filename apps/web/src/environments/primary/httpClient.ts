import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export type PrimaryEnvironmentHttpClientShape = Effect.Success<
  ReturnType<typeof makeEnvironmentHttpApiClient>
>;

export type PrimaryEnvironmentHttpClient = PrimaryEnvironmentHttpClientShape;

export const PrimaryEnvironmentHttpClient: Context.Service<
  PrimaryEnvironmentHttpClient,
  PrimaryEnvironmentHttpClientShape
> = Context.Service<PrimaryEnvironmentHttpClient, PrimaryEnvironmentHttpClientShape>(
  "@t3tools/web/environments/primary/httpClient/PrimaryEnvironmentHttpClient",
);

const make = Effect.suspend(() =>
  makeEnvironmentHttpApiClient(resolvePrimaryEnvironmentHttpUrl("/")),
);

export const layer: Layer.Layer<
  PrimaryEnvironmentHttpClient,
  never,
  Effect.Services<ReturnType<typeof makeEnvironmentHttpApiClient>>
> = Layer.effect(PrimaryEnvironmentHttpClient, make);
