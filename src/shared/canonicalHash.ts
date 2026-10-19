// src/shared/canonicalHash.ts
// RFC 8785 (JCS) deterministic JSON canonicalization and SHA-256 hashing.
import { createHash } from "node:crypto";

/**
 * Serializes any JSON value into a deterministic string with lexicographically sorted keys
 * and zero whitespace so SHA-256 digests are identical across any runtime or OS.
 */
export function toCanonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Cannot canonicalize non-finite number: ${String(value)}`);
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const elements = value.map((item) => toCanonicalJson(item === undefined ? null : item));
    return `[${elements.join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const pairs = sortedKeys.map(
      (key) => `${JSON.stringify(key)}:${toCanonicalJson(record[key])}`,
    );
    return `{${pairs.join(",")}}`;
  }

  throw new TypeError(`Unsupported value type for canonical JSON: ${typeof value}`);
}

export interface CanonicalDigestResult {
  readonly canonicalJson: string;
  readonly sha256: string;
}

/**
 * Computes both the canonical JSON string and its 64-character lowercase hex SHA-256 digest.
 */
export function computeCanonicalSha256(value: unknown): CanonicalDigestResult {
  const canonicalJson = toCanonicalJson(value);
  const sha256 = createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  return { canonicalJson, sha256 };
}
