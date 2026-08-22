import { describe, expect, it } from "@effect/vitest";
import { ProgramId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { GoalDriverUnavailableError, makeUnsupportedGoalDriver } from "./GoalDriver.ts";

const ref = {
  goalThreadId: ThreadId.make("thread:program-owner"),
  codexThreadId: "codex-thread:program-owner",
  programId: ProgramId.make("program:slice-1"),
  adapterGeneration: "unsupported:v1",
};

describe("UnsupportedGoalDriver", () => {
  it.effect("reports the unsupported capability without emulating a goal", () =>
    Effect.gen(function* () {
      const driver = makeUnsupportedGoalDriver("Codex goal methods have not passed certification.");
      expect(yield* driver.capabilities()).toEqual({
        available: false,
        adapter: "unsupported",
        reason: "Codex goal methods have not passed certification.",
      });

      const readError = yield* Effect.flip(driver.read(ref));
      expect(Schema.is(GoalDriverUnavailableError)(readError)).toBe(true);
      expect(readError.operation).toBe("read");

      const setError = yield* Effect.flip(
        driver.set({ ref, objective: "Keep the Program alive." }),
      );
      expect(Schema.is(GoalDriverUnavailableError)(setError)).toBe(true);
      expect(setError.operation).toBe("set");

      const clearError = yield* Effect.flip(driver.clear(ref));
      expect(Schema.is(GoalDriverUnavailableError)(clearError)).toBe(true);
      expect(clearError.operation).toBe("clear");
    }),
  );
});
