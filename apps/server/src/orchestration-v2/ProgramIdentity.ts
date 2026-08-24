import * as NodeCrypto from "node:crypto";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : item,
  );
}

export function sha256Digest(value: unknown): `sha256:${string}` {
  return `sha256:${NodeCrypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
