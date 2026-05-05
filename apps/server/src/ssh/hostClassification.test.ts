import { describe, expect, it } from "vitest";

import {
  classifySshHost,
  isTailnetIpv4,
  isTailnetIpv6,
  isTailnetMagicDnsHost,
} from "./hostClassification";

describe("hostClassification", () => {
  it("classifies *.ts.net hosts as tailnet", () => {
    expect(isTailnetMagicDnsHost("mybox.tail123.ts.net")).toBe(true);
    expect(classifySshHost("mybox.tail123.ts.net")).toBe("tailnet");
  });

  it("classifies 100.64.0.0/10 ipv4 addresses as tailnet", () => {
    expect(isTailnetIpv4("100.101.102.103")).toBe(true);
    expect(classifySshHost("100.101.102.103")).toBe("tailnet");
    expect(isTailnetIpv4("100.128.1.2")).toBe(false);
  });

  it("classifies tailscale ipv6 addresses as tailnet", () => {
    expect(isTailnetIpv6("fd7a:115c:a1e0::1")).toBe(true);
    expect(classifySshHost("[fd7a:115c:a1e0::1]")).toBe("tailnet");
  });

  it("classifies non-tailnet hosts as standard", () => {
    expect(classifySshHost("example.com")).toBe("standard");
    expect(classifySshHost("203.0.113.9")).toBe("standard");
  });
});
