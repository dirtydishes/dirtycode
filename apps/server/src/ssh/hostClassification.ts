import { isIP } from "node:net";

function normalizeHost(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function isTailnetMagicDnsHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized.length > 0 && normalized.endsWith(".ts.net");
}

export function isTailnetIpv4(host: string): boolean {
  const normalized = normalizeHost(host);
  if (isIP(normalized) !== 4) {
    return false;
  }

  const octets = normalized.split(".").map((value) => Number.parseInt(value, 10));
  const firstOctet = octets[0] ?? -1;
  const secondOctet = octets[1] ?? -1;

  return firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127;
}

export function isTailnetIpv6(host: string): boolean {
  const normalized = normalizeHost(host).split("%")[0] ?? "";
  if (isIP(normalized) !== 6) {
    return false;
  }

  // Tailscale IPv6 addresses are currently allocated from fd7a:115c:a1e0::/48.
  return normalized.startsWith("fd7a:115c:a1e0:") || normalized === "fd7a:115c:a1e0::";
}

export function classifySshHost(host: string): "tailnet" | "standard" {
  return isTailnetMagicDnsHost(host) || isTailnetIpv4(host) || isTailnetIpv6(host)
    ? "tailnet"
    : "standard";
}
