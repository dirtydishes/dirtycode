import { describe, expect, it } from "@effect/vitest";

import vectors from "./fixtures/program-identity-vectors.json" with { type: "json" };
import { canonicalJson, sha256Digest } from "./ProgramIdentity.ts";

describe("ProgramIdentity", () => {
  it("matches the shared dirtyloops canonical identity vectors", () => {
    for (const vector of vectors) {
      expect(canonicalJson(vector.value)).toBe(vector.canonical);
      expect(sha256Digest(vector.value)).toBe(vector.sha256);
    }
  });
});
