import { describe, expect, it } from "@effect/vitest";
import { EnvironmentResourceNotFoundError, ProgramId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProgramNotFoundError } from "./ProgramRuntime.ts";
import { mapProgramRuntimeErrors } from "./programHttp.ts";

const isEnvironmentResourceNotFoundError = Schema.is(EnvironmentResourceNotFoundError);

describe("Program HTTP errors", () => {
  it.effect("keeps a missing Program distinct from an internal runtime failure", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        mapProgramRuntimeErrors(
          Effect.fail(new ProgramNotFoundError({ programId: ProgramId.make("program:missing") })),
        ),
      );

      expect(isEnvironmentResourceNotFoundError(error)).toBe(true);
      expect(error.reason).toBe("program_not_found");
    }),
  );
});
