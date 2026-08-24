import { describe, expect, it } from "@effect/vitest";

import { programStatePresentation } from "./programPresentation.ts";

describe("Program presentation", () => {
  it("lets reduced-motion users disable the quiet running pulse", () => {
    const running = programStatePresentation("running");

    expect(running.indicatorClass).toContain("animate-pulse");
    expect(running.indicatorClass).toContain("motion-reduce:animate-none");
    expect(running.label).toBe("Running");
  });

  it("does not animate settled Program states", () => {
    expect(programStatePresentation("paused").indicatorClass).not.toContain("animate-pulse");
    expect(programStatePresentation("completed").indicatorClass).not.toContain("animate-pulse");
  });
});
