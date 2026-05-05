import {
  type ServerBootstrapSshRepoBindingInput,
  type ServerBootstrapSshRepoBindingResult,
  ServerBootstrapSshRepoBindingError,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface SshRepoBootstrapShape {
  readonly bootstrapRepoBinding: (
    input: ServerBootstrapSshRepoBindingInput,
  ) => Effect.Effect<ServerBootstrapSshRepoBindingResult, ServerBootstrapSshRepoBindingError>;
}

export class SshRepoBootstrap extends ServiceMap.Service<SshRepoBootstrap, SshRepoBootstrapShape>()(
  "t3/ssh/SshRepoBootstrap",
) {}
