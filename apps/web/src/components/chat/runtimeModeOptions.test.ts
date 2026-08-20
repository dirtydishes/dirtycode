import { describe, expect, it } from "vite-plus/test";

import { runtimeModeConfig, runtimeModeOptions } from "./runtimeModeOptions";

describe("composer runtime mode options", () => {
  it("keeps compact and full composer controls on the complete mode list", () => {
    expect(runtimeModeOptions).toEqual([
      "read-only",
      "approval-required",
      "auto-accept-edits",
      "auto",
      "full-access",
    ]);
    expect(runtimeModeOptions.map((mode) => runtimeModeConfig[mode].label)).toContain("Read only");
    expect(runtimeModeConfig["read-only"].icon).not.toBe(
      runtimeModeConfig["approval-required"].icon,
    );
  });
});
