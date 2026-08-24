import { describe, expect, it } from "@effect/vitest";

import { programStatePresentation } from "./programPresentation.ts";

describe("Program presentation", () => {
  it("uses one semantic Program status vocabulary across clients", () => {
    expect(programStatePresentation("running")).toEqual({
      label: "Running",
      tone: "success",
      busy: true,
    });
    expect(programStatePresentation("attention_required")).toEqual({
      label: "Needs attention",
      tone: "danger",
      busy: false,
    });
    expect(programStatePresentation("completed")).toEqual({
      label: "Completed",
      tone: "success",
      busy: false,
    });
  });
});
